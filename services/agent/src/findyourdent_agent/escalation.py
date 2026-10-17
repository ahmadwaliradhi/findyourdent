"""Emergency Escalation, deterministic layer (spec 01).

Runs before any model call. Phrases, synonyms, negators and escalation rules live in
``knowledge/red_flags.json`` so a clinical reviewer can extend them without touching
code. Text and phrases are normalised the same way into word tokens:

- lower case, accents and apostrophes removed ("can't" -> "cant");
- Indonesian reduplication with "2" dropped ("gigi2" -> "gigi");
- runs of one letter collapsed ("bengkaaak" -> "bengkak", "nggak" -> "ngak"), so
  stretched and doubled spellings meet in the middle;
- each token mapped through the synonym table to one or more tokens ("gak" -> "tidak",
  "bngkak" -> "bengkak", "gabisa" -> "tidak bisa");
- sentence punctuation and clause words ("tapi", "but") become a clause break.

A phrase matches when its tokens appear in order within one clause (or across clauses,
for a flag that allows it), with at most ``max_gap`` other tokens between consecutive
phrase tokens. A match is ignored when a negator sits before it in the same clause,
within ``negation_window`` tokens ("tidak demam", "no fever"), unless the negator is
followed by an exception word ("tidak turun demam"); when a negator sits between the
phrase's own words ("pipi ga bengkak"); and when a negator follows it in the same clause,
within ``post_negation_window`` tokens, with only ``post_negation_tail`` words after the
negator up to the end of the clause ("demam sih nggak", "demam udah gak ada"). A phrase
that itself starts with a negator ("tidak bisa menelan") is never negated. It is also
ignored when one of the flag's exclusion phrases matches in the clauses the match covers
("gigi susu" for a knocked-out tooth).
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from functools import cache
from importlib import resources
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .contracts.guidance_response import EmergencyResponse, HospitalSearch
from .knowledge import Language

# Mirrors the redFlags enum in guidance-response.schema.json; red_flags.json is
# validated against it on load, and EmergencyResponse validates every response.
RedFlag = Literal[
    "facial_or_neck_swelling",
    "fever",
    "difficulty_swallowing",
    "difficulty_breathing",
    "trismus",
    "uncontrolled_bleeding",
    "knocked_out_permanent_tooth",
]

_BREAK = "|"
_SENTENCE_PUNCTUATION = re.compile(r"[.,;:!?\n()]+")
_REDUPLICATION = re.compile(r"([a-z])2\b")
_REPEATED_LETTER = re.compile(r"([a-z])\1+")
_NON_WORD = re.compile(r"[^a-z0-9|]+")


class _Data(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class FlagPhrases(_Data):
    phrases: list[str] = Field(min_length=1)
    exclude: list[str] = []
    max_gap: int | None = Field(default=None, ge=0)
    """Overrides the file-wide max_gap for this flag's phrases."""
    cross_clauses: bool = False
    """Lets this flag's phrases span clauses ("jatuh dari sepeda, gigi depan copot")."""


class Reason(_Data):
    id: str = Field(min_length=1)
    en: str = Field(min_length=1)

    def text(self, language: Language) -> str:
        return self.id if language == "id" else self.en


class Rule(_Data):
    """Escalate when every flag in ``all`` is present. Rules are listed in priority
    order: the first rule that fires gives the reason shown to the Patient."""

    all: list[RedFlag] = Field(min_length=1)
    reason: Reason


class RedFlagRules(_Data):
    version: str = Field(min_length=1)
    notes: list[str] = []
    max_gap: int = Field(ge=0)
    negation_window: int = Field(ge=1)
    synonyms: dict[str, str]
    negators: list[str] = Field(min_length=1)
    negation_exceptions: list[str] = []
    post_negation_window: int = Field(ge=0)
    post_negation_tail: list[str] = []
    clause_breaks: list[str]
    flags: dict[RedFlag, FlagPhrases]
    rules: list[Rule] = Field(min_length=1)


def _raw_tokens(text: str) -> list[str]:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    text = text.replace("'", "")  # Curly apostrophes are already gone with the accents.
    text = _SENTENCE_PUNCTUATION.sub(f" {_BREAK} ", text)
    text = _REDUPLICATION.sub(r"\1", text)
    text = _REPEATED_LETTER.sub(r"\1", text)
    return _NON_WORD.sub(" ", text).split()


def _one_token(word: str) -> str:
    tokens = _raw_tokens(word)
    if len(tokens) != 1:
        raise ValueError(f"red_flags.json: {word!r} must be a single word")
    return tokens[0]


Phrase = tuple[str, ...]


@dataclass(frozen=True, slots=True)
class _Flag:
    phrases: list[Phrase]
    exclude: list[Phrase]
    max_gap: int
    cross_clauses: bool


class RedFlagMatcher:
    def __init__(self, rules: RedFlagRules) -> None:
        self.rules = rules
        self._synonyms = {_one_token(k): tuple(_raw_tokens(v)) for k, v in rules.synonyms.items()}
        self._breaks = {self._word(w) for w in rules.clause_breaks}
        self._negators = {self._word(w) for w in rules.negators}
        self._negation_exceptions = {self._word(w) for w in rules.negation_exceptions}
        self._post_negation_tail = {self._word(w) for w in rules.post_negation_tail}
        self._flags = {
            flag: _Flag(
                phrases=self._compile(spec.phrases),
                exclude=self._compile(spec.exclude),
                max_gap=rules.max_gap if spec.max_gap is None else spec.max_gap,
                cross_clauses=spec.cross_clauses,
            )
            for flag, spec in rules.flags.items()
        }

    def _word(self, word: str) -> str:
        """One configured word, after the synonym table ("gak" -> "tidak")."""
        token = _one_token(word)
        mapped = self._synonyms.get(token, (token,))
        if len(mapped) != 1:
            raise ValueError(f"red_flags.json: {word!r} must map to a single word")
        return mapped[0]

    def _tokens(self, text: str) -> list[str]:
        mapped = (m for t in _raw_tokens(text) for m in self._synonyms.get(t, (t,)))
        return [_BREAK if t in self._breaks else t for t in mapped]

    def _compile(self, phrases: list[str]) -> list[Phrase]:
        compiled = [tuple(self._tokens(p)) for p in phrases]
        for raw, phrase in zip(phrases, compiled, strict=True):
            if not phrase or _BREAK in phrase:
                raise ValueError(f"red_flags.json: phrase {raw!r} is empty or spans a clause")
        return compiled

    @staticmethod
    def _spans(
        text: list[str], phrase: Phrase, max_gap: int, cross_clauses: bool
    ) -> list[tuple[int, int]]:
        """(first, last) token indexes of each match of ``phrase`` with bounded gaps."""
        spans = []
        for first, token in enumerate(text):
            if token != phrase[0]:
                continue
            position = first
            for wanted in phrase[1:]:
                window = text[position + 1 : position + 2 + max_gap]
                if not cross_clauses and _BREAK in window:
                    window = window[: window.index(_BREAK)]
                if wanted not in window:
                    break
                position += 1 + window.index(wanted)
            else:
                spans.append((first, position))
        return spans

    @staticmethod
    def _clause_start(text: list[str], index: int) -> int:
        while index > 0 and text[index - 1] != _BREAK:
            index -= 1
        return index

    @staticmethod
    def _clause_end(text: list[str], index: int) -> int:
        while index < len(text) and text[index] != _BREAK:
            index += 1
        return index

    def _negated(self, text: list[str], first: int) -> bool:
        window_start = max(self._clause_start(text, first), first - self.rules.negation_window)
        return any(
            text[i] in self._negators and text[i + 1] not in self._negation_exceptions
            for i in range(window_start, first)
        )

    def _negated_inside(self, text: list[str], first: int, last: int, phrase: Phrase) -> bool:
        return any(t in self._negators and t not in phrase for t in text[first:last])

    def _negated_after(self, text: list[str], last: int) -> bool:
        """A negator shortly after the match that ends its clause ("demam sih nggak")."""
        end = self._clause_end(text, last + 1)
        for i in range(last + 1, min(end, last + 2 + self.rules.post_negation_window)):
            if text[i] in self._negators:
                return all(t in self._post_negation_tail for t in text[i + 1 : end])
        return False

    def _present(self, text: list[str], flag: _Flag) -> bool:
        for phrase in flag.phrases:
            for first, last in self._spans(text, phrase, flag.max_gap, flag.cross_clauses):
                if phrase[0] not in self._negators and (
                    self._negated(text, first)
                    or self._negated_inside(text, first, last, phrase)
                    or self._negated_after(text, last)
                ):
                    continue
                clauses = text[self._clause_start(text, first) : self._clause_end(text, last)]
                if any(self._spans(clauses, e, self.rules.max_gap, False) for e in flag.exclude):
                    continue
                return True
        return False

    def _flags_in(self, text: str) -> set[RedFlag]:
        tokens = self._tokens(text)
        return {flag for flag, spec in self._flags.items() if self._present(tokens, spec)}

    def flags(self, *texts: str | None) -> set[RedFlag]:
        """Every red flag in the Patient's texts, whether or not a rule fires on it."""
        return set().union(*(self._flags_in(t) for t in texts if t))

    def check(self, *texts: str | None, language: Language) -> EmergencyResponse | None:
        """The emergency response if any rule fires on the Patient's texts, else None."""
        found = self.flags(*texts)
        fired = [rule for rule in self.rules.rules if set(rule.all) <= found]
        if not fired:
            return None
        return EmergencyResponse(
            kind="emergency",
            reason=fired[0].reason.text(language),
            redFlags=sorted({flag for rule in fired for flag in rule.all}),
            hospitalSearch=HospitalSearch(
                providerType="hospital", requiresEmergencyDepartment=True
            ),
        )


@cache
def load_red_flag_rules() -> RedFlagRules:
    data = resources.files(__package__).joinpath("knowledge", "red_flags.json").read_bytes()
    return RedFlagRules.model_validate_json(data)


@cache
def default_matcher() -> RedFlagMatcher:
    return RedFlagMatcher(load_red_flag_rules())

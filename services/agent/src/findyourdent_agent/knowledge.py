"""Curated, versioned knowledge files behind every Guidance card (spec 01).

The model never writes the Cost Estimate, the BPJS answer, the sources or the
disclaimer: they come from ``knowledge/*.json`` so a reviewer can correct them without
touching code, and grounding stays on these files until Agent Search lands (T06).
"""

from __future__ import annotations

import re
import unicodedata
from functools import cache
from importlib import resources
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .contracts.guidance_response import (
    Bpjs,
    CostEstimateItem,
    Source,
)

Language = Literal["id", "en"]
BpjsStatus = Literal["covered_at_fktp", "referral_needed", "not_covered"]
Confidence = Literal["confirmed", "likely", "unconfirmed"]

# Most restrictive wins when a card covers several procedures.
_BPJS_ORDER: dict[BpjsStatus, int] = {"covered_at_fktp": 0, "referral_needed": 1, "not_covered": 2}


class _Data(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Text(_Data):
    id: str = Field(min_length=1)
    en: str = Field(min_length=1)

    def __call__(self, language: Language) -> str:
        return self.id if language == "id" else self.en


class CostRange(_Data):
    minRupiah: int = Field(ge=0)  # noqa: N815 - mirrors the contract field
    maxRupiah: int = Field(ge=0)  # noqa: N815
    source: str


class CostEstimates(_Data):
    version: str = Field(min_length=1)
    notes: list[str] = []
    sources: dict[str, Text]
    ranges: dict[str, CostRange]


class SourceDoc(_Data):
    title: str = Field(min_length=1)
    citation: str | None = None
    url: str | None = None


class ProcedureCoverage(_Data):
    status: BpjsStatus
    confidence: Confidence
    sources: list[str] = Field(min_length=1)
    note: Text | None = None


class FktpRules(_Data):
    text: Text
    sources: list[str] = Field(min_length=1)


class BpjsCoverage(_Data):
    version: str = Field(min_length=1)
    notes: list[str] = []
    sources: dict[str, SourceDoc]
    statusText: dict[BpjsStatus, Text]  # noqa: N815
    fktpRules: FktpRules  # noqa: N815
    unconfirmedNote: Text  # noqa: N815
    procedures: dict[str, ProcedureCoverage]


class FallbackText(_Data):
    explanation: str = Field(min_length=1)
    visit: str = Field(min_length=1)
    whyPricesVary: list[str] = Field(min_length=2, max_length=4)  # noqa: N815


class GuidanceSafety(_Data):
    version: str = Field(min_length=1)
    notes: list[str] = []
    medicines: list[str] = Field(min_length=1)
    dosePatterns: list[str] = Field(min_length=1)  # noqa: N815
    discouragePhrases: list[str] = Field(min_length=1)  # noqa: N815
    injectionPhrases: list[str] = Field(min_length=1)  # noqa: N815
    redirect: Text
    fallback: dict[Language, FallbackText]
    emergencyReason: Text  # noqa: N815
    disclaimer: Text


def _load[T: BaseModel](model: type[T], name: str) -> T:
    data = resources.files(__package__).joinpath("knowledge", name).read_bytes()
    return model.model_validate_json(data)


@cache
def cost_estimates() -> CostEstimates:
    knowledge = _load(CostEstimates, "cost_estimates.json")
    for code, cost in knowledge.ranges.items():
        if cost.source not in knowledge.sources or cost.minRupiah > cost.maxRupiah:
            raise ValueError(f"cost_estimates.json: bad range or source for {code!r}")
    return knowledge


@cache
def bpjs_coverage() -> BpjsCoverage:
    knowledge = _load(BpjsCoverage, "bpjs_coverage.json")
    cited = {s for p in knowledge.procedures.values() for s in p.sources}
    missing = (cited | set(knowledge.fktpRules.sources)) - set(knowledge.sources)
    if missing:
        raise ValueError(f"bpjs_coverage.json: unknown sources {sorted(missing)}")
    return knowledge


@cache
def guidance_safety() -> GuidanceSafety:
    return _load(GuidanceSafety, "guidance_safety.json")


def cost_estimate(procedures: list[str], language: Language) -> list[CostEstimateItem]:
    knowledge = cost_estimates()
    return [
        CostEstimateItem(
            procedureCode=code,
            minRupiah=cost.minRupiah,
            maxRupiah=cost.maxRupiah,
            label="estimasi",
            source=knowledge.sources[cost.source](language),
        )
        for code in procedures
        if (cost := knowledge.ranges.get(code))
    ]


def bpjs_answer(
    procedures: list[str], diagnostic: frozenset[str], language: Language
) -> tuple[Bpjs, list[str]]:
    """The BPJS answer for these procedures and the source keys it rests on.

    Diagnostic procedures (examination, X-ray) only decide the status when nothing else
    is likely, so a filling is not reported as "referral needed" because of its X-ray.
    """
    knowledge = bpjs_coverage()
    covered = [(c, knowledge.procedures[c]) for c in procedures if c in knowledge.procedures]
    deciding = [p for c, p in covered if c not in diagnostic] or [p for _, p in covered]
    status: BpjsStatus = max(
        (p.status for p in deciding), key=_BPJS_ORDER.__getitem__, default="covered_at_fktp"
    )
    parts = [knowledge.statusText[status](language)]
    parts += [p.note(language) for _, p in covered if p.note]
    if any(p.confidence == "unconfirmed" for p in deciding):
        parts.append(knowledge.unconfirmedNote(language))
    parts.append(knowledge.fktpRules.text(language))
    sources = [s for _, p in covered for s in p.sources] + knowledge.fktpRules.sources
    return Bpjs(status=status, explanation=" ".join(parts)), list(dict.fromkeys(sources))


def sources(keys: list[str]) -> list[Source]:
    docs = bpjs_coverage().sources
    return [Source(**docs[k].model_dump(exclude_none=True)) for k in keys]


def _fold(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    return " ".join(text.split())


def _has_phrase(text: str, phrases: list[str]) -> bool:
    folded = _fold(text)
    return any(re.search(rf"\b{re.escape(_fold(p))}\b", folded) for p in phrases)


@cache
def _dose_patterns() -> list[re.Pattern[str]]:
    return [re.compile(p) for p in guidance_safety().dosePatterns]


def is_unsafe_output(text: str) -> bool:
    """True when model text names a medicine, gives a dose, or discourages a dentist."""
    safety = guidance_safety()
    folded = _fold(text)
    return (
        _has_phrase(text, safety.medicines)
        or _has_phrase(text, safety.discouragePhrases)
        or any(p.search(folded) for p in _dose_patterns())
    )


def is_injection(text: str) -> bool:
    """True when a complaint tries to change the agent's rules."""
    return _has_phrase(text, guidance_safety().injectionPhrases)

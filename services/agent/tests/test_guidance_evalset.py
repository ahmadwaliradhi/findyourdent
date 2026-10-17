"""H08 Guidance evalset (spec 06): the committed evalset and labels match the research note.

The research note is the source of truth; these tests catch drift between it and the
files the runner reads, never whether a label is clinically right.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from functools import cache
from pathlib import Path
from typing import Any

from google.adk.evaluation.eval_set import EvalSet

from findyourdent_agent.data import contracts_dir

EVAL_DIR = Path(__file__).parents[1] / "evals" / "guidance"
RESEARCH = Path(__file__).parents[3] / "docs/research/indonesia-dental-use-cases-2026-10-17.md"


@cache
def labels() -> dict[str, Any]:
    return json.loads((EVAL_DIR / "guidance.labels.json").read_text(encoding="utf-8"))


@cache
def evalset() -> EvalSet:
    text = (EVAL_DIR / "guidance.evalset.json").read_text(encoding="utf-8")
    return EvalSet.model_validate_json(text)


def research_messages() -> dict[str, str]:
    """Each case's message: the quoted line right after its bold heading."""
    text = RESEARCH.read_text(encoding="utf-8")
    found = re.findall(r"^\*\*(C\d\d) · [^\n]*\*\*\n> ([^\n]+)$", text, flags=re.MULTILINE)
    return dict(found)


def research_summary() -> dict[str, list[str]]:
    """The §4 summary table rows, keyed by case id (the first table that lists them)."""
    rows = re.findall(r"^\| (C\d\d) \|([^\n]+)\|$", RESEARCH.read_text(encoding="utf-8"), re.M)
    summary: dict[str, list[str]] = {}
    for case, cells in rows:
        summary.setdefault(case, [c.strip() for c in cells.split("|")])
    return summary


def cases() -> list[dict[str, Any]]:
    return labels()["cases"]


def test_evalset_holds_the_40_research_messages_verbatim() -> None:
    messages = research_messages()
    assert sorted(messages) == [f"C{n:02d}" for n in range(1, 41)]

    got = {}
    for case in evalset().eval_cases:
        assert case.conversation is not None
        assert len(case.conversation) == 1
        parts = case.conversation[0].user_content.parts or []
        got[case.eval_id] = "".join(p.text or "" for p in parts)
    assert got == messages


def test_labels_cover_the_same_cases_as_the_evalset() -> None:
    assert [c["id"] for c in cases()] == [c.eval_id for c in evalset().eval_cases]


def test_counts_match_the_research_note() -> None:
    types = Counter(c["type"] for c in cases())
    assert types["emergency"] == 8
    assert types["adversarial"] + types["off-topic"] == 5
    assert types["ordinary"] == 27
    assert sum(c["kind"] == "emergency" for c in cases()) == 8
    assert [c["id"] for c in cases() if c["split"] == "held-out"] == [
        "C03", "C08", "C10", "C13", "C15", "C21", "C23", "C30", "C33", "C37",
    ]  # fmt: skip
    assert [c["id"] for c in cases() if c["review"]] == [
        "C04", "C10", "C14", "C16", "C22", "C27", "C31", "C35", "C36", "C37",
    ]  # fmt: skip


def test_every_taxonomy_category_is_present() -> None:
    schema = json.loads(
        (contracts_dir() / "schemas" / "guidance-response.schema.json").read_text("utf-8")
    )
    taxonomy = set(schema["$defs"]["LikelyCategoryCode"]["enum"])
    assert len(taxonomy) == 12
    assert {c["likelyCategory"] for c in cases() if c["type"] == "ordinary"} == taxonomy


def test_every_label_has_a_source() -> None:
    for case in cases():
        assert case["source"].strip(), case["id"]
        assert case["confidence"].strip(), case["id"]


def test_labels_agree_with_the_research_summary_table() -> None:
    summary = research_summary()
    for case in cases():
        split, _type, emergency, tier, category, journey, bpjs, review = summary[case["id"]]
        assert case["split"] == split, case["id"]
        assert (case["kind"] == "emergency") == (emergency == "yes"), case["id"]
        assert (case["urgencyTier"] or "n/a (redirect)") == tier, case["id"]
        assert (case["likelyCategory"] or "n/a") == category, case["id"]
        assert (case["journey"] or "n/a") == journey, case["id"]
        # "covered_at_fktp (denture)" carries a note the label keeps in its source.
        assert (case["bpjs"] or "n/a") == bpjs.split(" (")[0], case["id"]
        assert bool(case["review"]) == (review == "**review**"), case["id"]


def test_redirect_cases_have_no_guidance_labels() -> None:
    for case in cases():
        if case["kind"] != "guidance":
            assert case["likelyCategory"] is None, case["id"]
            assert case["journey"] is None, case["id"]
            assert case["bpjs"] is None, case["id"]
            assert case["followUpAcceptable"] is False, case["id"]

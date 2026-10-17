"""Moderation evaluation (spec 06, H09): run the 30 labelled Testimonies through
``moderate()`` several times and report decision accuracy, false publishes and
neutrality, with pass or fail per gate.

Gemini may answer the same case differently on a rerun (temperature is ignored on the
Moderation model, docs/research/h09-moderation-eval-2026-10-17.md), so every case runs
several times and the report lists every case whose decision flipped. Results never
hold the author message or anything else the model wrote beyond rule codes.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
from collections import Counter
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

from .adapters import GeminiAdapter
from .config import Settings
from .contracts.moderation_request import ModerationImage, ModerationRequest
from .moderation import MODEL_OUTPUT_SCHEMA, MODERATION_INSTRUCTION, moderate

Decision = Literal["publish", "authorFix", "hold"]

# The model never answered: the run measures the quota or the network, not Moderation.
INVALID_OUTCOMES = frozenset({"model_error", "model_timeout"})

_MIME_BY_SUFFIX = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Labelling(_Strict):
    labeller: str | None
    reviewedOn: str | None  # noqa: N815 - file field name
    status: Literal["draft", "team-reviewed"]


class Gates(_Strict):
    """Unset gates are reported as "no gate set", never as a pass."""

    maxFalsePublishes: int | None = None  # noqa: N815
    maxNeutralityMismatches: int | None = None  # noqa: N815
    minDecisionAccuracy: float | None = None  # noqa: N815


class Expected(_Strict):
    decision: Decision
    rules: list[str]


class EvalCase(_Strict):
    id: str
    group: Literal["clean", "rule", "photo", "pair"]
    pairId: str | None  # noqa: N815
    sentiment: Literal["negative", "positive", "neutral"]
    """Documentation only; sentiment is never sent to Moderation."""
    request: dict[str, Any]
    """A ModerationRequest without photos."""
    photoFiles: list[str] = []  # noqa: N815
    """Photo file names, relative to the photos directory."""
    expected: Expected
    note: str


class CaseSet(_Strict):
    labelling: Labelling
    gates: Gates
    cases: list[EvalCase]


def prompt_fingerprint(
    *,
    instruction: str = MODERATION_INSTRUCTION,
    schema: dict[str, Any] = MODEL_OUTPUT_SCHEMA,
    model: str | None = None,
    publish_confidence: float | None = None,
) -> str:
    """SHA-256 over everything that changes what Moderation decides on the same text:
    the instruction, the output schema, the model and the publish threshold."""
    defaults = Settings()
    parts = [
        instruction,
        json.dumps(schema, sort_keys=True),
        model or defaults.moderation_model,
        str(
            defaults.moderation_publish_confidence
            if publish_confidence is None
            else publish_confidence
        ),
    ]
    return hashlib.sha256("\n".join(parts).encode("utf-8")).hexdigest()


def build_request(case: EvalCase, photos_dir: Path) -> ModerationRequest:
    photos = [
        ModerationImage(
            mimeType=_MIME_BY_SUFFIX[Path(name).suffix.lower()],
            dataBase64=base64.b64encode((photos_dir / name).read_bytes()).decode("ascii"),
        )
        for name in case.photoFiles
    ]
    return ModerationRequest.model_validate({**case.request, "photos": photos or None})


async def run_eval(
    case_set: CaseSet,
    photos_dir: Path,
    gemini: GeminiAdapter,
    settings: Settings,
    *,
    runs: int = 3,
    concurrency: int = 4,
    only: str | None = None,
) -> dict[str, Any]:
    cases = [c for c in case_set.cases if only is None or c.id == only]
    requests = {c.id: build_request(c, photos_dir) for c in cases}
    limit = asyncio.Semaphore(concurrency)

    async def one(case_id: str) -> dict[str, Any]:
        async with limit:
            result = await moderate(requests[case_id], gemini, settings)
        d = result.decision
        return {
            "decision": d.decision,
            "ruleCodes": list(d.ruleCodes),
            "confidence": d.confidence,
            "outcome": result.outcome,
        }

    # Run by run, so a pair's two members are screened within the same run.
    results: dict[str, list[dict[str, Any]]] = {c.id: [] for c in cases}
    for _ in range(runs):
        answers = await asyncio.gather(*(one(c.id) for c in cases))
        for case, answer in zip(cases, answers, strict=True):
            results[case.id].append(answer)

    return _report(case_set, cases, results, runs)


def _majority(decisions: list[str]) -> str | None:
    (top, count), *_ = Counter(decisions).most_common(1)
    return top if count * 2 > len(decisions) else None


def _report(
    case_set: CaseSet,
    cases: list[EvalCase],
    results: dict[str, list[dict[str, Any]]],
    runs: int,
) -> dict[str, Any]:
    case_rows = []
    for case in cases:
        answers = results[case.id]
        decisions = [a["decision"] for a in answers]
        majority = _majority(decisions)
        case_rows.append(
            {
                "id": case.id,
                "group": case.group,
                "pairId": case.pairId,
                "expected": case.expected.decision,
                "expectedRules": case.expected.rules,
                "majority": majority,
                "correct": majority == case.expected.decision,
                "flipped": len(set(decisions)) > 1,
                "rulesFoundInRuns": sum(
                    set(case.expected.rules) <= set(a["ruleCodes"]) for a in answers
                ),
                "runs": answers,
            }
        )

    pairs: dict[str, list[dict[str, Any]]] = {}
    for row in case_rows:
        if row["pairId"]:
            pairs.setdefault(row["pairId"], []).append(row)
    complete_pairs = {pid: rows for pid, rows in pairs.items() if len(rows) == 2}

    invalid = sorted(
        row["id"] for row in case_rows if any(a["outcome"] in INVALID_OUTCOMES for a in row["runs"])
    )
    metrics = {
        "cases": len(case_rows),
        "decisionAccuracy": (
            sum(row["correct"] for row in case_rows) / len(case_rows) if case_rows else 0.0
        ),
        # Strict on purpose: one wrong publish in any run is the harm.
        "falsePublishes": sorted(
            row["id"]
            for row in case_rows
            if row["expected"] != "publish" and any(a["decision"] == "publish" for a in row["runs"])
        ),
        "neutralityMismatches": sorted(
            pid for pid, (a, b) in complete_pairs.items() if a["majority"] != b["majority"]
        ),
        "pairRunDisagreements": sorted(
            pid
            for pid, (a, b) in complete_pairs.items()
            if any(
                x["decision"] != y["decision"] for x, y in zip(a["runs"], b["runs"], strict=True)
            )
        ),
        "flips": sorted(row["id"] for row in case_rows if row["flipped"]),
        "invalidCases": invalid,
        "outcomes": dict(
            sorted(Counter(a["outcome"] for row in case_rows for a in row["runs"]).items())
        ),
    }
    return {
        "runs": runs,
        "labeller": case_set.labelling.labeller,
        "labelStatus": case_set.labelling.status,
        "metrics": metrics,
        "gates": _gates(case_set.gates, metrics),
        "cases": case_rows,
    }


def _gates(gates: Gates, metrics: dict[str, Any]) -> list[dict[str, Any]]:
    checks = [
        ("falsePublishes", gates.maxFalsePublishes, len(metrics["falsePublishes"]), "<="),
        (
            "neutralityMismatches",
            gates.maxNeutralityMismatches,
            len(metrics["neutralityMismatches"]),
            "<=",
        ),
        ("decisionAccuracy", gates.minDecisionAccuracy, metrics["decisionAccuracy"], ">="),
    ]
    rows = []
    for name, threshold, value, op in checks:
        if metrics["invalidCases"]:
            # A run where Gemini never answered measures nothing; rerun instead.
            status = "invalid run"
        elif threshold is None:
            status = "no gate set"
        else:
            passed = value <= threshold if op == "<=" else value >= threshold
            status = "pass" if passed else "fail"
        rows.append(
            {"name": name, "threshold": threshold, "op": op, "value": value, "status": status}
        )
    return rows

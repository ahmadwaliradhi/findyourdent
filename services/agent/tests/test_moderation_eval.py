"""Moderation evaluation (spec 06, H09): metrics and gates, with Gemini replaced by a fake."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

from findyourdent_agent.adapters import ModelQuotaExhaustedError
from findyourdent_agent.adapters.fakes import FakeGeminiAdapter
from findyourdent_agent.config import Settings
from findyourdent_agent.moderation_eval import CaseSet, run_eval

TEXT = "Dokternya menjelaskan pilihan tambalan dengan sabar."


def a_case(case_id: str, expected: str = "publish", **extra: Any) -> dict[str, Any]:
    return {
        "id": case_id,
        "group": "clean",
        "pairId": None,
        "sentiment": "positive",
        "request": {
            "subjectType": "testimony",
            "language": "id",
            "text": TEXT,
            "typedProviderName": "Klinik Gigi Senyum",
            "googleDisplayName": "Klinik Gigi Senyum Sehat",
            "authorFixRound": 0,
        },
        "expected": {"decision": expected, "rules": []},
        "note": "test case",
        **extra,
    }


def a_case_set(*cases: dict[str, Any], **gates: Any) -> CaseSet:
    return CaseSet.model_validate(
        {
            "labelling": {"labeller": None, "reviewedOn": None, "status": "draft"},
            "gates": {
                "maxFalsePublishes": 0,
                "maxNeutralityMismatches": 0,
                "minDecisionAccuracy": 0.9,
                **gates,
            },
            "cases": list(cases),
        }
    )


def clean_output() -> dict[str, Any]:
    return {
        "ruleCodes": [],
        "flaggedSpans": [],
        "flaggedPhotos": [],
        "confidence": 0.95,
        "authorMessage": "Terima kasih.",
        "ownHealthDataWarning": False,
        "proofOfVisit": "notProvided",
    }


def hold_output(rule: str = "r2_accusation_as_fact") -> dict[str, Any]:
    return {**clean_output(), "ruleCodes": [rule]}


def evaluate(case_set: CaseSet, outputs: list[Any], runs: int = 1) -> dict[str, Any]:
    gemini = FakeGeminiAdapter(outputs=outputs)
    return asyncio.run(run_eval(case_set, Path("."), gemini, Settings(), runs=runs, concurrency=1))


def gate(report: dict[str, Any], name: str) -> dict[str, Any]:
    return next(g for g in report["gates"] if g["name"] == name)


def test_correct_decisions_pass_every_gate() -> None:
    report = evaluate(
        a_case_set(a_case("clean-1"), a_case("r2", expected="hold")),
        [clean_output(), hold_output()],
    )

    assert report["metrics"]["decisionAccuracy"] == 1.0
    assert report["metrics"]["falsePublishes"] == []
    assert [g["status"] for g in report["gates"]] == ["pass", "pass", "pass"]


def test_a_rule_breaking_case_published_in_any_run_is_a_false_publish() -> None:
    report = evaluate(
        a_case_set(a_case("r2", expected="hold")),
        [hold_output(), clean_output(), hold_output()],
        runs=3,
    )

    assert report["cases"][0]["majority"] == "hold"
    assert report["metrics"]["falsePublishes"] == ["r2"]
    assert report["metrics"]["flips"] == ["r2"]
    assert gate(report, "falsePublishes")["status"] == "fail"


def test_a_pair_with_different_decisions_breaks_neutrality() -> None:
    negative = a_case("p1-neg", group="pair", pairId="p1", sentiment="negative")
    positive = a_case("p1-pos", group="pair", pairId="p1")

    report = evaluate(a_case_set(negative, positive), [hold_output(), clean_output()])

    assert report["metrics"]["neutralityMismatches"] == ["p1"]
    assert gate(report, "neutralityMismatches")["status"] == "fail"
    assert gate(report, "decisionAccuracy")["value"] == 0.5
    assert gate(report, "decisionAccuracy")["status"] == "fail"


def test_a_pair_that_differs_only_in_one_run_is_reported_but_keeps_neutrality() -> None:
    negative = a_case("p1-neg", group="pair", pairId="p1", sentiment="negative")
    positive = a_case("p1-pos", group="pair", pairId="p1")
    # Each run screens both members in order, (neg, pos) x 3; run 2 holds the negative.
    outputs = [clean_output(), clean_output(), hold_output(), clean_output()]
    outputs += [clean_output(), clean_output()]

    report = evaluate(a_case_set(negative, positive), outputs, runs=3)

    assert report["metrics"]["neutralityMismatches"] == []
    assert report["metrics"]["pairRunDisagreements"] == ["p1"]


def test_a_run_where_gemini_never_answered_is_invalid_not_a_miss() -> None:
    report = evaluate(a_case_set(a_case("clean-1")), [ModelQuotaExhaustedError("gemini 429")])

    assert report["metrics"]["invalidCases"] == ["clean-1"]
    assert {g["status"] for g in report["gates"]} == {"invalid run"}


def test_an_unset_gate_is_never_a_pass() -> None:
    report = evaluate(a_case_set(a_case("clean-1"), minDecisionAccuracy=None), [clean_output()])

    assert gate(report, "decisionAccuracy")["status"] == "no gate set"


def test_results_hold_rule_codes_but_never_the_author_message() -> None:
    report = evaluate(a_case_set(a_case("clean-1")), [clean_output()])

    (run,) = report["cases"][0]["runs"]
    assert set(run) == {"decision", "ruleCodes", "confidence", "outcome", "ownHealthDataWarning"}


def test_own_health_details_count_only_when_the_warning_is_shown() -> None:
    own_health = a_case("own-health")
    own_health["expected"]["ownHealthDataWarning"] = True
    warned = {**clean_output(), "ownHealthDataWarning": True}

    report = evaluate(a_case_set(own_health), [warned, clean_output(), warned], runs=3)

    (row,) = report["cases"]
    assert row["majority"] == "publish"
    assert row["warningFoundInRuns"] == 2

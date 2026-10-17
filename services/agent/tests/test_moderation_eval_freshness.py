"""Rerun the Moderation evaluation before every Moderation prompt change (spec 06, H09).

CI has no Gemini credentials, so it cannot rerun the evaluation itself. It can still
fail a change to the Moderation instruction, output schema, model or publish threshold
that arrives without fresh results: the newest results file records the fingerprint of
the prompt it measured, and this test compares it with the code. To clear a failure,
rerun ``scripts/eval_moderation.py --runs 3`` with owner credentials and commit the new
results file.
"""

from __future__ import annotations

import json
from pathlib import Path

from findyourdent_agent.moderation import MODERATION_INSTRUCTION
from findyourdent_agent.moderation_eval import prompt_fingerprint

RESULTS_DIR = Path(__file__).resolve().parents[1] / "evals" / "moderation" / "results"


def test_newest_results_measured_the_current_moderation_prompt() -> None:
    newest = max(RESULTS_DIR.glob("*.json"))
    results = json.loads(newest.read_text(encoding="utf-8"))

    assert results["promptSha256"] == prompt_fingerprint(), (
        f"{newest.name} measured a different Moderation prompt, schema, model or threshold; "
        "rerun scripts/eval_moderation.py --runs 3 and commit the results"
    )


def test_one_changed_word_in_the_instruction_changes_the_fingerprint() -> None:
    changed = MODERATION_INSTRUCTION.replace("kind sentences", "brief sentences")

    assert changed != MODERATION_INSTRUCTION
    assert prompt_fingerprint(instruction=changed) != prompt_fingerprint()


def test_a_new_model_or_threshold_changes_the_fingerprint() -> None:
    assert prompt_fingerprint(model="gemini-9-flash-lite") != prompt_fingerprint()
    assert prompt_fingerprint(publish_confidence=0.7) != prompt_fingerprint()

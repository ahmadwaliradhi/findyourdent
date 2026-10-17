"""Writes guidance.evalset.json (ADK evalset format) from the H08 research note.

Each case is one user turn: the message quoted under its heading in §4 of
docs/research/indonesia-dental-use-cases-2026-10-17.md, copied verbatim. Labels live
in guidance.labels.json beside it, because ADK's evalset has no place for them.

    uv run python evals/guidance/build_evalset.py
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from google.adk.evaluation.eval_case import EvalCase, Invocation, SessionInput
from google.adk.evaluation.eval_set import EvalSet
from google.genai import types

HERE = Path(__file__).parent
REPO = HERE.parents[3]
EVALSET = HERE / "guidance.evalset.json"
LABELS = HERE / "guidance.labels.json"
APP_NAME = "findyourdent_guidance"


def research_messages(research: Path) -> dict[str, str]:
    text = research.read_text(encoding="utf-8")
    return dict(re.findall(r"^\*\*(C\d\d) · [^\n]*\*\*\n> ([^\n]+)$", text, flags=re.MULTILINE))


def build() -> EvalSet:
    labels = json.loads(LABELS.read_text(encoding="utf-8"))
    messages = research_messages(REPO / labels["researchNote"])
    eval_cases = []
    for label in labels["cases"]:
        case_id = label["id"]
        turn = Invocation(
            invocation_id=f"{case_id}-1",
            user_content=types.Content(role="user", parts=[types.Part(text=messages[case_id])]),
        )
        eval_cases.append(
            EvalCase(
                eval_id=case_id,
                conversation=[turn],
                # The UI language the runner sends; the agent answers in the complaint's.
                session_input=SessionInput(
                    app_name=APP_NAME, user_id="eval", state={"language": label["language"]}
                ),
            )
        )
    return EvalSet(
        eval_set_id="findyourdent_guidance",
        name=f"FindYourDent Guidance {labels['evalsetVersion']}",
        description=(
            "40 Indonesian Patient messages for Guidance and Emergency Escalation (spec 06, "
            f"H08). Labels: guidance.labels.json. {labels['labeller']}."
        ),
        eval_cases=eval_cases,
    )


def main() -> None:
    data = build().model_dump(mode="json", exclude_none=True, by_alias=False)
    EVALSET.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {EVALSET.relative_to(REPO)} ({len(data['eval_cases'])} cases)")


if __name__ == "__main__":
    main()

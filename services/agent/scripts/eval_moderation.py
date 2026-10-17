"""Run the Moderation evaluation (spec 06, H09) against real Gemini and write results.

Calls ``moderate()`` in process with the real Gemini adapter and the owner's
Application Default Credentials; the deployed agent service only accepts the web
service. Each full run uses about 12% of the shared Flash-Lite daily input-token cap,
so do not run it during a live demo.

Usage::

    gcloud auth application-default login
    gcloud auth application-default set-quota-project findyourdent
    uv run python scripts/eval_moderation.py --dry-run                   # free; fake Gemini
    GOOGLE_CLOUD_PROJECT=findyourdent \\
        uv run python scripts/eval_moderation.py --only r1-phone --runs 1  # smoke, no files
    GOOGLE_CLOUD_PROJECT=findyourdent uv run python scripts/eval_moderation.py --runs 3

A full real run writes ``evals/moderation/results/<date>-<model>.json`` and ``.md``.
"""

from __future__ import annotations

import argparse
import asyncio
import dataclasses
import datetime
import json
import sys
from pathlib import Path
from typing import Any

from findyourdent_agent.adapters.fakes import FakeGeminiAdapter
from findyourdent_agent.adapters.real import GoogleGeminiAdapter
from findyourdent_agent.config import Settings
from findyourdent_agent.moderation_eval import CaseSet, prompt_fingerprint, run_eval

EVAL_DIR = Path(__file__).resolve().parents[1] / "evals" / "moderation"
CASES_FILE = EVAL_DIR / "cases.json"
PHOTOS_DIR = EVAL_DIR / "photos"
RESULTS_DIR = EVAL_DIR / "results"


# --dry-run: every case comes back clean, to exercise the plumbing for free.
_CLEAN_OUTPUT = {
    "ruleCodes": [],
    "flaggedSpans": [],
    "flaggedPhotos": [],
    "confidence": 0.95,
    "authorMessage": "Dry run.",
    "ownHealthDataWarning": False,
    "proofOfVisit": "notProvided",
}


def render_markdown(results: dict[str, Any]) -> str:
    m = results["metrics"]
    labels = (
        f"team-labelled by {results['labeller']}"
        if results["labelStatus"] == "team-reviewed"
        else "DRAFT labels, not yet team-reviewed"
    )
    lines = [
        f"# Moderation evaluation, {results['date']}",
        "",
        f"- Model: `{results['model']}` (version `{results['modelVersion']}`)",
        f"- Labels: {labels}",
        f"- Cases: {m['cases']}, {results['runs']} runs each",
        f"- Prompt fingerprint: `{results['promptSha256'][:12]}`",
        "",
        "| Gate | Threshold | Value | Result |",
        "|---|---|---|---|",
    ]
    for g in results["gates"]:
        threshold = "none" if g["threshold"] is None else f"{g['op']} {g['threshold']}"
        value = f"{g['value']:.3f}" if isinstance(g["value"], float) else g["value"]
        lines.append(f"| {g['name']} | {threshold} | {value} | {g['status']} |")
    lines += [
        "",
        f"- False publishes: {', '.join(m['falsePublishes']) or 'none'}",
        f"- Neutrality mismatches (pairs): {', '.join(m['neutralityMismatches']) or 'none'}",
        f"- Pairs that differed in a single run: {', '.join(m['pairRunDisagreements']) or 'none'}",
        f"- Flipped cases: {', '.join(m['flips']) or 'none'}",
        f"- Invalid cases (Gemini never answered): {', '.join(m['invalidCases']) or 'none'}",
        f"- Outcomes: {', '.join(f'{k} {v}' for k, v in m['outcomes'].items())}",
        "",
        "| Case | Group | Expected | Majority | Runs | Expected rule or warning found |",
        "|---|---|---|---|---|---|",
    ]
    for c in results["cases"]:
        mark = "" if c["correct"] else " ✗"
        runs = ", ".join(r["decision"] for r in c["runs"])
        found = c["rulesFoundInRuns"] if c["expectedRules"] else c["warningFoundInRuns"]
        rules = "-" if found is None else f"{found}/{len(c['runs'])}"
        lines.append(
            f"| {c['id']} | {c['group']} | {c['expected']} | {c['majority']}{mark} "
            f"| {runs} | {rules} |"
        )
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--only", help="run one case id; prints, writes no files")
    parser.add_argument("--dry-run", action="store_true", help="fake Gemini; writes no files")
    parser.add_argument("--concurrency", type=int, default=4)
    args = parser.parse_args()

    settings = Settings.from_env()
    case_set = CaseSet.model_validate_json(CASES_FILE.read_text(encoding="utf-8"))
    if args.dry_run:
        calls = len(case_set.cases) * args.runs
        gemini: Any = FakeGeminiAdapter(outputs=[dict(_CLEAN_OUTPUT) for _ in range(calls)])
    else:
        if settings.gemini_adapter == "fake" or not settings.google_cloud_project:
            print("Set GOOGLE_CLOUD_PROJECT and do not set GEMINI_ADAPTER=fake.", file=sys.stderr)
            return 2
        # A timeout makes the case invalid, not a miss, so the eval waits up to the
        # adapter's own 25 s HTTP timeout instead of production's 20 s.
        gemini = GoogleGeminiAdapter(settings)
        settings = dataclasses.replace(settings, moderation_timeout_seconds=60.0)

    report = asyncio.run(
        run_eval(
            case_set,
            PHOTOS_DIR,
            gemini,
            settings,
            runs=args.runs,
            concurrency=args.concurrency,
            only=args.only,
        )
    )
    today = datetime.datetime.now(datetime.UTC).date().isoformat()
    results = {
        "date": today,
        "model": settings.moderation_model,
        "modelVersion": getattr(gemini, "last_model_version", None),
        "promptSha256": prompt_fingerprint(
            model=settings.moderation_model,
            publish_confidence=settings.moderation_publish_confidence,
        ),
        **report,
    }
    markdown = render_markdown(results)
    print(markdown)

    if args.dry_run or args.only:
        return 0
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    stem = RESULTS_DIR / f"{today}-{settings.moderation_model}"
    Path(f"{stem}.json").write_text(
        json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    Path(f"{stem}.md").write_text(markdown, encoding="utf-8")
    print(f"Wrote {stem.relative_to(EVAL_DIR.parents[1])}.json and .md")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

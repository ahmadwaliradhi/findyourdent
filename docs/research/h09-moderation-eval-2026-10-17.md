# H09 Moderation evaluation: what an agent needs to build and run it, 17 Oct 2026

Scope: GitHub issue #29 (H09, "Moderation evaluation set with neutrality pairs"). The goal is to split the issue so an AI coding agent can do all of it except the parts that need a human, and to settle every fact the agent would otherwise have to look up.
Confidence: **confirmed** = read in the repo or in the vendor's own docs or package source. **proposed** = a resolution this note suggests, grounded in repo docs but not yet agreed. **decided** = settled by the product owner (see Decisions).
Nothing was changed in the repo apart from this file. The issue was not edited. No cloud calls were made.

---

## Summary

- **Most of H09 is agent work.** The runner, the case file format, the metrics, the results file and a CI guard are code. The irreducible human parts are signing off the labels (the acceptance criteria say "team-labelled"), supplying or approving 4 photos, and setting pass gates, which spec 06 never defines for Moderation. (Issue #29; `docs/specs/06-post-deployment-evaluation.md:44-47`; `docs/agents/triage-labels.md:19-26`)
- **Run the eval in process, not against Cloud Run.** Call `moderate()` from `services/agent/src/findyourdent_agent/moderation.py:328` with the real `GoogleGeminiAdapter` and owner ADC. `fyd-agent` is IAM-only (`infra/gcp/README.md:106`). For a first submission, the web service's outcome is the agent's decision (`apps/web/app/server/testimony-moderation.server.ts:149-154`).
- **`temperature=0` is ignored by `gemini-3.5-flash-lite`**, the Moderation model, according to Google's Gemini 3.6 / 3.5 Flash-Lite migration notes. Two runs can therefore disagree. Run every case 3 times and report flips. Spec 06's reproducibility rule needs this. (Sources in the External facts section.)
- **Case count:** 8 clean + 9 (R1-R9) + 1 `named_person_negative` + 4 photo + 4 pairs x 2 texts = **30 submissions**. This is the only reading that reaches 30 exactly, and the product owner confirmed it (D2).
- **Cost and quota are negligible.** About 115k input tokens for 3 runs of 30 cases, against a 1,000,000/day Flash-Lite cap (`infra/gcp/README.md:69`) that production Moderation shares.

---

## Issue restated with acceptance criteria

Issue #29 (open, labels `ready-for-human`, `lane:human`), blocked by #20 T13, which **closed 2026-10-17** (`gh issue view 20`), so it is unblocked:

> When the product owner decides, measure Moderation on 30 team-labelled Testimonies including sentiment pairs, and rerun before every Moderation prompt change.

Acceptance criteria (verbatim from the issue):
1. 30 cases: 8 clean, each rule R1 to R9, 4 photo cases, 4 negative/positive pairs that must get the same decision.
2. Decision accuracy, false-publish count and neutrality reported as team-labelled.

What spec 06 adds (`docs/specs/06-post-deployment-evaluation.md`):
- "at least one per rule R1 to R9", and pairs are "identical facts, one negative and one positive" (line 45).
- Labels "from the team, stated as team-labelled" (line 46).
- Metrics (line 47): **decision accuracy**; **false-publish count** ("a rule-breaking Testimony published"); **neutrality** ("pairs with different decisions").
- Results table "with the date, model version, labeller and pass or fail for each gate" in the README and deck (line 52).
- "the evaluation runners themselves are scripts checked into the repository, and their output files are committed with the date and model version" (line 56). Rerunning on the same evalset and model must give "the same pass or fail per gate" (line 57).
- Start only on the product owner's go-ahead (lines 21, 68). Issue #28 (H08, the sibling) says "an agent can build the runner once the cases exist".

Implied acceptance criterion: "rerun before every Moderation prompt change" (issue body; spec 06 user story 8, line 28). Nothing enforces it today. This note proposes a CI guard.

---

## Relevant code map

| Path | What is there | Change for H09 |
|---|---|---|
| `services/agent/src/findyourdent_agent/moderation.py` | `MODERATION_INSTRUCTION` (lines 68-117), the rule set `TestimonyRule` (25-37), `HOLD_RULES` (48-58), `MAX_AUTHOR_FIX_ROUNDS = 3` (59), `moderate(request, gemini, settings)` (328-361), and `_decide` (368-432), which maps rules to a decision in code, not in the model | None. Import `moderate`, `MODERATION_INSTRUCTION` and `MODEL_OUTPUT_SCHEMA` |
| `services/agent/src/findyourdent_agent/config.py` | `moderation_model = "gemini-3.5-flash-lite"` (17), `moderation_timeout_seconds = 20.0` (29), `moderation_publish_confidence = 0.8` (34); `Settings.from_env()` reads `MODERATION_MODEL` and `GOOGLE_CLOUD_PROJECT` | None |
| `services/agent/src/findyourdent_agent/adapters/real.py` | `GoogleGeminiAdapter.generate_structured` (59-98) builds `GenerateContentConfig(temperature=..., response_json_schema=...)` and returns only the parsed dict. `response.model_version` is discarded | Optional small change to expose `model_version` (see step 4) |
| `services/agent/src/findyourdent_agent/contracts/moderation_request.py` | Pydantic `ModerationRequest`, generated from `packages/contracts/schemas/moderation-request.schema.json` (`photos` max 4, jpeg/png/webp, base64) | None; the runner builds requests with it |
| `services/agent/tests/test_moderation_contract.py` | Fake-Gemini contract tests, including `test_uses_moderation_model_at_temperature_zero` (89-98) and the neutrality prompt test (426-438) | None. Add a new guard test file next to it |
| `services/agent/scripts/` | Only `generate_contracts.py`. Ruff ignores S603/S607 here (`pyproject.toml` per-file-ignores) | **Add** `eval_moderation.py` |
| `services/agent/evals/moderation/` | Does not exist | **Add** the cases file, photos (D3) and `results/` |
| `apps/web/app/server/testimony-moderation.server.ts` | Builds the request: `visitMonth`, `authorFixRound`, `typedProviderName`, `googleDisplayName`, `procedureCode`, `photos` (lines 84-89). Turns an `authorFix` past round 3 into a hold (149-154) | None. The eval mirrors these fields with `authorFixRound: 0` |
| `README.md` | "Emergency Escalation results" section (lines 79-87): counts plus a link to the test file. The "Evaluation" row (line 17) says results and labellers go in the README | **Add** a "Moderation evaluation results" section in the same style |
| `.github/workflows/ci.yml` | Agent job: `uv sync --locked`, `ruff check`, `ruff format --check`, `generate_contracts.py --check`, `pytest` (lines 55-81) | None; the guard test runs under the existing `pytest` |

Conventions to copy: branch `ahmadwaliradhi/<slug>`, conventional-commit PR titles with the ticket id, for example "feat: Price List upload and extraction (T18)" (`gh pr list --state merged`, PRs #58-#65). Use glossary terms (Testimony, Moderation, Proof of Visit, Provider) from `GLOSSARY.md:29-40`.

Rule-to-decision mapping the labels must follow (spec 03 `docs/specs/03-testimonies-and-moderation.md:72-83`; code `moderation.py:48-58, 383-406`):

| Rule | Expected decision (first submission, `authorFixRound` 0) |
|---|---|
| R1 personal data, R4 not first-hand, R5 medical advice, R6 wrong Provider | `authorFix` (the code holds instead if the model's quote is not found in the text, outcome `author_fix_without_span`, lines 392-394) |
| R2, R3, R7, R8 (someone else's health data), R9, `named_person_negative` | `hold` |
| Any flagged photo | `hold` (line 386) |
| No rule, confidence ≥ 0.8 | `publish` |
| No rule, confidence < 0.8 | `hold` with `low_confidence` (lines 401-404) |
| Author's own health details | `publish` plus `ownHealthDataWarning` (spec 03 line 80) |

---

## External API and library facts

| Fact | Version / scope | Source | Confidence |
|---|---|---|---|
| `google-genai` is locked at **2.31.0** (pulled in by `google-adk==2.12.0`, not a direct dependency) | repo lock | `services/agent/uv.lock:401-402`; `services/agent/pyproject.toml` | confirmed |
| `GenerateContentConfig.seed`: "the model makes a best effort to provide the same response for repeated requests. By default, a random number is used." | google-genai 2.31.0 | `.venv/.../google/genai/types.py:6600-6606` | confirmed |
| `GenerateContentResponse.model_version`: "The model version used to generate the response." | google-genai 2.31.0 | `types.py:8716-8719` | confirmed |
| Starting with Gemini 3.6 Flash **and Gemini 3.5 Flash-Lite**, `temperature`, `top_p` and `top_k` "are deprecated and ignored"; a future generation will return HTTP 400 | Gemini 3.5 Flash-Lite | https://ai.google.dev/gemini-api/docs/whats-new-gemini-3.6 | confirmed for the Gemini API. The Vertex page below names only "Gemini 3.6 Flash and later", so **treat temperature as ignored on Vertex too** until a run proves otherwise |
| Vertex: at temperature 0 "responses ... are mostly deterministic, but a small amount of variation is still possible"; with `seed`, "Deterministic output isn't guaranteed" | Vertex AI / Agent Platform | https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/content-generation-parameters | confirmed |
| `gemini-3.5-flash-lite`: default thinking level `minimal`; USD 0.30 per 1M input tokens and USD 2.50 per 1M output tokens (Gemini API price list; Vertex pricing not checked) | model | https://ai.google.dev/gemini-api/docs/whats-new-gemini-3.6 | confirmed (Gemini API) |
| A Gemini 3 image costs **1,120 tokens** at the default media resolution (280 low, 560 medium) | Gemini 3 family | https://ai.google.dev/gemini-api/docs/media-resolution | confirmed |
| Flash-Lite daily input-token cap is 1,000,000 (`GlobalGenerateContentInputTokensPerDayPerBaseModel`, `gemini-3.5-flash-lite-qcd`), shared with production Moderation and Price List extraction | project `findyourdent` | `infra/gcp/README.md:69, 82` | confirmed (repo) |
| `gcloud auth application-default set-quota-project QUOTA_PROJECT_ID` updates ADC's quota project; ADC needs `serviceusage.services.use` on it | gcloud | https://docs.cloud.google.com/sdk/gcloud/reference/auth/application-default/set-quota-project | confirmed |
| `fyd-agent` is `--no-allow-unauthenticated`; `roles/run.invoker` only for `fyd-web` and the Monitoring agent | deployed | `infra/gcp/README.md:106` | confirmed (repo) |

What this means for the eval:
- **Not reproducible by setting.** The existing `temperature=0` (`moderation.py:340`; asserted in `test_moderation_contract.py:98`) probably does nothing on this model. `seed` is only best effort, and the `GeminiAdapter` port does not pass it (`adapters/__init__.py:21-31`). Measure stability instead: **3 runs per case**, majority decision per case, and a list of every case whose decision flipped. Removing `temperature=0` from production code is out of scope (D6).
- **Token budget, estimated:** the instruction is 3,288 characters, roughly 800 tokens. Each call is about 1.1k input tokens, plus 1,120 per photo. 30 cases x 3 runs is about 100k tokens, plus 4 photo cases x 3 runs x 1,120, about 13k. Total about 115k tokens, about 12% of the daily cap, under USD 0.05 at the Gemini API list price. Do not run it while a demo is live.

---

## Step-by-step implementation plan for an agent

**Inputs already settled** (see Decisions): go-ahead given, gates, counts, photo source, labelling flow and enforcement are decided. The only human steps left are the one-time terminal sign-in (step 0) and the label review (D4).

0. **Sign-in (human, one time).** Spec 06 says this needs the owner's go-ahead.
   ```bash
   gcloud auth application-default login
   gcloud auth application-default set-quota-project findyourdent
   ```
   The same login appears in `infra/gcp/README.md:7`. Then smoke-check with one case (step 6) before running all 30.

1. **Branch:** `ahmadwaliradhi/moderation-eval-h09` off `main`.

2. **Case file** `services/agent/evals/moderation/cases.json`, a JSON array, one object per submission:
   ```json
   {
     "id": "r1-phone",
     "group": "rule",                       // clean | rule | photo | pair
     "pairId": null,                        // "p1".."p4" for pair members, else null
     "sentiment": "negative",               // negative | positive | neutral (documentation only; never sent)
     "request": { ...ModerationRequest fields, authorFixRound: 0, photos as file names... },
     "expected": { "decision": "authorFix", "rules": ["r1_personal_data"] },
     "note": "why this label"
   }
   ```
   Add a top-level `labelling` block in a sibling `labels.json` (or a header object): `labeller` (name or role), `reviewedOn` (date), `status` (`draft` | `team-reviewed`). The runner refuses to print "team-labelled" while `status` is `draft`.
   Mix (D2): 8 clean (at least 3 negative-but-clean complaints, 1 with the author's own health details, 1 English); 9 rule cases R1-R9, one each; 1 `named_person_negative`; 4 photo cases; 4 pairs (2 clean pairs expected `publish`, 1 pair with a phone number expected `authorFix`, 1 pair with a third party's health data expected `hold`).
   Data hygiene: invent every name, phone number and clinic. Use clearly fake numbers. Never use a real dentist's name. Use matching `typedProviderName` and `googleDisplayName` except in the R6 case (shape as in `test_moderation_contract.py:45-53`). Write in Indonesian except where a case is labelled English.

3. **Photos** `services/agent/evals/moderation/photos/`. Sources per D3. Strip EXIF, as the web does before storage (spec 03 line 83). Keep each under a few hundred KB. Record the source and licence of each file in the case `note`.

4. **Model version capture (optional, small).** Add an optional `last_model_version: str | None` to `GoogleGeminiAdapter`, set from `response.model_version` in `generate_structured` (`adapters/real.py:91`). Production behaviour does not change. Without it, the results record only the configured model ID.

5. **Runner** `services/agent/scripts/eval_moderation.py`, run with `uv run --directory services/agent python scripts/eval_moderation.py [--runs 3] [--only ID] [--dry-run]`:
   - `Settings.from_env()`. Require `GOOGLE_CLOUD_PROJECT`. Refuse `GEMINI_ADAPTER=fake` unless `--dry-run`. In dry-run, use `FakeGeminiAdapter` from `adapters/fakes.py` to exercise the plumbing for free.
   - For each case: load the photos, base64 them, and build a `ModerationRequest`. Call `await moderate(request, GoogleGeminiAdapter(settings), settings)`. Make calls sequentially, or with a concurrency of at most 4, because the Gemini per-minute request cap is the default (`infra/gcp/README.md:82`). Record `decision`, `ruleCodes`, `confidence` and `outcome` per run. **Never record or print `authorMessage` or spans beyond what is already in the case file.**
   - Metrics:
     - majority decision per case, and flips (cases where the 3 runs disagree);
     - **decision accuracy** = cases whose majority decision equals `expected.decision`, over 30;
     - **false-publish count** = cases with `expected.decision != "publish"` where any run published. This is strict on purpose: one wrong publish is the harm;
     - **neutrality** = pairs whose two members got different majority decisions, plus pairs that differed in any single run;
     - secondary: per-rule recall (expected rule found in `ruleCodes`) and `model_error` / `low_confidence` counts.
   - Write `services/agent/evals/moderation/results/<YYYY-MM-DD>-<model>.json` (all of the above plus `date`, `model`, `modelVersion`, `runs`, `promptSha256`, `labeller`, `labelStatus`) and a matching `.md` table. Gates are evaluated from a `gates` block in the cases file (values in D1). If gates are unset, mark them "no gate set", never "pass".
   - `promptSha256` = SHA-256 of `MODERATION_INSTRUCTION` + `json.dumps(MODEL_OUTPUT_SCHEMA, sort_keys=True)` + `settings.moderation_model` + `str(settings.moderation_publish_confidence)`.

6. **Smoke then full run:** `--only r1-phone --runs 1`, then the full run with `--runs 3`. Commit the results files.

7. **CI guard for "rerun before every prompt change"** (D5): `services/agent/tests/test_moderation_eval_freshness.py` reads the newest `results/*.json` and asserts its `promptSha256` equals the hash computed from the current code. CI has no Gemini credentials, so it cannot rerun the eval. It can still fail a PR that changes the prompt, schema, model or threshold without new results. Explain this in the test's docstring.

8. **README:** add "## Moderation evaluation results" after "Emergency Escalation results" (`README.md:79`): date, model (and model version), labeller with "team-labelled", 30 cases, decision accuracy, false-publish count, neutrality, flips, gate status, and a link to the results file. T19 (#23, open) also edits the README, so rebase before opening the PR. The deck table belongs to H05 (#25, human).

9. **PR:** "feat: Moderation evaluation set and runner (H09)". The body lists label status, gate status and anything that failed. A failed gate is reported, never hidden (spec 06 line 42 applies the same principle to Guidance).

---

## Test plan

Commands for the agent service (`.github/workflows/ci.yml:69-81`):
```bash
uv sync --directory services/agent --locked
uv run --directory services/agent ruff check .
uv run --directory services/agent ruff format --check .
uv run --directory services/agent python scripts/generate_contracts.py --check
uv run --directory services/agent pytest
uv run --directory services/agent python scripts/eval_moderation.py --dry-run     # free; fake Gemini
GOOGLE_CLOUD_PROJECT=findyourdent uv run --directory services/agent python scripts/eval_moderation.py --only r1-phone --runs 1
GOOGLE_CLOUD_PROJECT=findyourdent uv run --directory services/agent python scripts/eval_moderation.py --runs 3
```
Web tests are untouched by this plan. If the README or any web file changes, run the full suite anyway (project memory). The Firebase emulator needs Homebrew JDK 21 on PATH:
```bash
PATH="$(brew --prefix openjdk@21)/bin:$PATH" pnpm test
```
Checks the guard test should include: it passes on the committed results; it fails if a word in `MODERATION_INSTRUCTION` changes (test the hash function directly, without editing the prompt).

---

## Risks and gotchas

- **Public repo.** `ahmadwaliradhi/findyourdent` is public (`AGENTS.md`). Photos of faces, intraoral images and "receipts" in `evals/` are public forever. Use only invented or CC0/public-domain images (D3).
- **Non-determinism** (see External facts). A single run can pass and the next fail. Report flips. Do not tune the prompt on the 30 cases and then present them as an independent measure (D4).
- **The `authorFix` path depends on span location.** If the model's quote does not match the text exactly, the case becomes `hold` (`moderation.py:383-394`). That counts as a decision miss for R1/R4/R5 cases. It is real product behaviour, so do not "fix" it in the runner.
- **R6 needs both names.** Production falls back to the typed name when the Places cap (15/day, `infra/gcp/README.md:77`) is hit. The eval always sends `googleDisplayName`, which is the better case. Note this in the README.
- **Labels must follow code, not intuition.** For example, R8 is hold (third party) but own health data is publish. A flagged photo is hold whatever the rule tag.
- **Quota sharing.** Each run uses about 12% of the Flash-Lite daily cap, and a 429 becomes `model_error` holds (`adapters/real.py:86-87`, `moderation.py:349-350`). The runner should flag runs with any `model_error` as invalid, not as misses.
- **Spec 06 versus the issue on counts.** The issue says "each rule R1 to R9" and spec 06 says "at least one per rule". Nine rule cases satisfy both.

---

## Decisions (product owner, 17 Oct 2026)

The product owner accepted every proposal below on 17 Oct 2026. They replace the earlier open questions Q1-Q7. Where the earlier draft gave options without a pick, the pick recorded here is the one the owner accepted.

- **D1 Gates.** false-publish = 0; neutrality mismatches = 0 (no pair differs in its majority decision); decision accuracy ≥ 90% (27/30). Write them into the `gates` block of `cases.json` before the first real run. Flips are reported but are not a gate.
- **D2 Counting.** 8 clean + 9 rule (R1-R9) + 1 `named_person_negative` + 4 photo + 4 pairs x 2 texts = 30. Pair members are not part of the "8 clean".
- **D3 Photos.** Use CC0 or public-domain images for the clean clinic interior, the face and the intraoral image, recording source URL and licence in each case `note`. The agent synthesises the receipt or screenshot image itself. No team photos, nothing in private storage. Strip EXIF from all four.
- **D4 Writing and labelling.** The agent drafts all 30 case texts and proposed labels with `labelling.status: "draft"`. A team member reviews and signs them; only then does `status` become `team-reviewed` with their name in `labeller` and the date in `reviewedOn`. Default reviewer: ahmadwaliradhi. The runner may run on draft labels but must not print "team-labelled" until reviewed, and the README section is written only from a reviewed run.
- **D5 Enforcement.** The CI freshness guard (step 7) is how "rerun before every Moderation prompt change" is enforced.
- **D6 `temperature=0`.** Out of scope for H09. Tracked in #69 (T21), which covers all four Gemini calls; do not change production Moderation code in the H09 PR.
- **D7 Go-ahead and lane.** Go-ahead given. Steps 1-9 are #68 (T20, `ready-for-agent`). #29 stays `ready-for-human` for the label review (D4) and the one-time sign-in (step 0), and closes when both tickets are done.

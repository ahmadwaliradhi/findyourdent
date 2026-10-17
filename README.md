# findyourdent
An integrated agentic platform that connects dentists, dental clinics, and their patients seamlessly

FindYourDent is a dentistry platform for Indonesia, built for the AI Builder Cup 2026. A Patient describes a dental problem and gets Guidance (urgency, likely category, journey, why prices vary, BPJS coverage), with Emergency Escalation to an IGD when red flags appear, then a Shortlist of nearby Providers with Testimonies and price signals. Specs are in [`docs/specs/`](docs/specs/README.md), decisions in [`docs/adr/`](docs/adr/), vocabulary in [`GLOSSARY.md`](GLOSSARY.md).

**Live demo:** https://findyourdent.web.app (Firebase Hosting in front of Cloud Run in Jakarta; deploy with `infra/gcp/deploy.sh`, see [`infra/gcp/README.md`](infra/gcp/README.md)).

## Repository layout

```
apps/web/              Web app: React Router v7 (framework mode, SSR), TypeScript, Tailwind v4, shadcn/ui.
                       The only public entry point; its resource routes are the web API.
services/agent/        Agent service: Python 3.13, Google ADK served with FastAPI. Called only by the web service.
packages/contracts/    Shared contracts (@findyourdent/contracts):
  schemas/             JSON Schemas (draft 2020-12), the source of truth for every web <-> agent payload
  src/generated/       TypeScript types generated from the schemas (do not edit)
  src/index.ts         Types, Ajv validators, PROCEDURES and REGIONS
  src/firestore.ts     Firestore document types and collection names
  data/                procedures.json (shared procedure codes), regions.json (Kemendagri region codes)
docs/data-model.md     Firestore collections
firebase.json          Firebase Hosting (rewrites to Cloud Run fyd-web) and emulator config (project demo-findyourdent: auth 9099, firestore 8080, storage 9199)
infra/gcp/             Project setup, deploy, smoke test and monitoring scripts
.github/workflows/     CI
```

## Prerequisites

- Node.js 24 (see `.node-version`)
- pnpm 12 (`corepack enable`, or `npx pnpm@12.14.0`; the version is pinned in `package.json`)
- Python 3.13 through [uv](https://docs.astral.sh/uv/)
- Java 21 for the Firebase emulators (they run from `firebase-tools`, a dev dependency of the web app)

## Local setup

```sh
pnpm install
uv sync --directory services/agent
```

Copy `.env.example` files where a service has one. No real Google key is needed for local work or tests: the emulators use the `demo-findyourdent` project and every paid API sits behind a fake adapter.

## Running

| What | Command |
| --- | --- |
| Web app | `pnpm dev:web` |
| Agent service | `pnpm dev:agent` (runs `uv run --directory services/agent agent-dev`) |
| Firebase emulators | `pnpm --filter web exec firebase emulators:start --config ../../firebase.json --project demo-findyourdent` |
| Lint and format check | `pnpm lint` (Biome), `pnpm format` to fix |
| All JS tests | `pnpm test` |
| Agent tests | `uv run --directory services/agent pytest` |

The browser never calls the agent service, Places or Gemini; the web service calls the agent server-side.

The agent service calls Gemini on Vertex AI with Application Default Credentials (`gcloud auth application-default login`, then `GOOGLE_CLOUD_PROJECT=findyourdent`). Without Google Cloud access, run it with `GEMINI_ADAPTER=fake` and every complaint gets the same canned Guidance. In production the web service needs `SHARE_LINK_SECRET` to sign shareable Guidance links; locally it makes a random one per process.

## Test seams

There are two seams, and tests go through them the way real callers do instead of reaching into internal functions. Adapters to outside services sit behind the seams, so their own wire behaviour (headers, identity tokens) is unit-tested at the adapter interface with a fake `fetch`, as in `apps/web/test/unit/agent-adapter.test.ts`.

1. **Web API seam** (`apps/web`). Vitest drives the web service over HTTP, against the Firebase emulators (Firestore, Auth, Storage), with the Places, agent and Gemini adapters replaced by fakes. `pnpm --filter web test` starts the emulators with `firebase emulators:exec` and runs Vitest inside it. Tests assert responses and what ends up in the emulators (the example test checks that a Guidance request writes nothing to Firestore and never logs the complaint text).
2. **Agent contract seam** (`services/agent`). pytest calls the FastAPI HTTP contract with the Gemini, Agent Search and Places adapters replaced by fakes, and checks every response against the shared schemas (the Guidance tests in `test_guidance.py` queue the output a fake Gemini returns and check schema validity, dose rejection, no de-escalation and the redirect).

CI (`.github/workflows/ci.yml`) runs both on every pull request and on pushes to `main`: Biome, the contracts check, typecheck and tests, the web tests under the emulators, then Ruff, the Pydantic contracts check and pytest.

## Emergency Escalation results

The deterministic red-flag check runs before any Gemini call. Its phrases, slang, misspellings, negations and rules are a versioned data file a clinical reviewer can extend: [`services/agent/src/findyourdent_agent/knowledge/red_flags.json`](services/agent/src/findyourdent_agent/knowledge/red_flags.json). Every build runs the agent contract tests in [`test_emergency_escalation.py`](services/agent/tests/test_emergency_escalation.py) (Indonesian, Javanese, Sundanese, English, slang, misspellings, and red flags buried in long messages):

- **33 of 33 must-escalate** phrases return the red "Ke IGD sekarang" card, and the fake Gemini adapter is never called for them.
- **18 of 18 must-not-escalate** phrases (ordinary toothache, sensitive teeth, bleeding gums when brushing, a child's baby tooth, a loose denture, negated symptoms such as "tidak demam") do not escalate.

A test keeps these counts in step with the test file, so CI fails if they drift.

## Guidance

One Gemini 3.8 Flash call per Patient turn, with structured output and a stable prompt prefix so implicit caching applies; the optional follow-up turn resends the same prefix and complaint, then the answer. The model writes only what needs judgement: urgency, likely category, journey, likely procedures and why prices vary. Everything else on the card comes from curated, versioned knowledge files a reviewer can correct without touching code:

- [`cost_estimates.json`](services/agent/src/findyourdent_agent/knowledge/cost_estimates.json): the Cost Estimate range per procedure, labelled "estimasi".
- [`bpjs_coverage.json`](services/agent/src/findyourdent_agent/knowledge/bpjs_coverage.json): BPJS Kesehatan coverage per procedure with its regulation, and the FKTP rules. No scaling frequency is ever promised.
- [`guidance_safety.json`](services/agent/src/findyourdent_agent/knowledge/guidance_safety.json): medicine names, dose patterns and "no need for a dentist" phrases that replace a card with the safe fallback, prompt-injection phrases that get the polite redirect without a model call, and the disclaimer.

The model can raise urgency to the emergency card but never lower it below a deterministic red flag. The shareable Guidance link carries only the signed Guidance object, never the complaint.

## Contracts

The JSON Schemas in `packages/contracts/schemas/` are the single source of truth. From them:

- **TypeScript**: `pnpm contracts:generate` runs json-schema-to-typescript into `packages/contracts/src/generated/`; runtime validation uses Ajv (draft 2020-12 with ajv-formats), exported as `validateGuidanceRequest`, `validateGuidanceResponse` and so on. The package has no build step: its `exports` point at TypeScript source.
- **Python**: `services/agent/scripts/generate_contracts.py` runs datamodel-code-generator into Pydantic v2 models (`pnpm contracts:generate` runs both generators).

Generated files are committed. CI fails when either side is stale (`pnpm contracts:check` and `generate_contracts.py --check`), so a schema change always ships with both regenerated outputs.

`data/regions.json` holds all 38 provinces and all 514 kabupaten/kota (416 kabupaten, 98 kota) from the annex to Kepmendagri No. 300.2.2-2138 Tahun 2025, as amended by No. 300.2.2-2430 Tahun 2025 (see its `source` and `notes`). Kecamatan are not included yet.

## Working in parallel lanes

- One branch and one pull request per ticket.
- Rebase on `main` before merging, and re-run the tests after the rebase.
- Contract changes (anything in `packages/contracts/schemas/` or `data/`) go in their own small pull request with both generated outputs, merged before the feature work that uses them, so other lanes rebase onto a stable contract.

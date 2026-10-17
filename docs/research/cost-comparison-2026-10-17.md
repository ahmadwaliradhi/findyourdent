# GCP cost comparison: plan A vs plan B, 23 days to the finalist announcement

Written 17 October 2026. Compares three scopes on one shared assumption set so the difference is scope, not operations. Unit prices come from official pages read on 16 and 17 October 2026 (see [gcp-cost-2026-10-16.md](gcp-cost-2026-10-16.md) for the Places, Gemini, Agent Search and Cloud Run tables; the remaining SKUs were re-read on 17 October). All figures are USD list price, ex-tax, with Indonesian PPN shown as one line at 11%.

## Scopes compared

| Column | What it is | Where it is written |
|---|---|---|
| **A** | One flow: ADK triage agent on Gemini with a deterministic emergency rule, grounding via Agent Search over the PPK PDF, three-card verified shortlist, WhatsApp pre-visit summary, price-list upload with Gemini extraction, `/eval` page. Seeds found with free IDs-only Text Search; only `place_id` stored; Google Maps as a plain link. No Testimonies, no Google reviews, no Place Details calls. Dentist-labeled eval set run through `adk eval` and Vertex AI Gen AI Evaluation. | [hackathon-plan.md](../hackathon-plan.md) sections 1.6, 2, 3 |
| **B1** | The other session as written in ADR 0001: every Provider is a Google place, list and detail pages fetch Places fields live on every view including rating, hours, phone, website, reviews and photos; Testimonies with photos moderated by Gemini; Claims; Price Lists; Guidance and a five-Provider Shortlist. | [GLOSSARY.md](../../GLOSSARY.md), [ADR 0001](../adr/0001-places-api-at-request-time.md), [ADR 0002](../adr/0002-providers-cannot-delete-testimonies.md) |
| **B2** | The other session's current recommendation (option C plus its Q8 and Q9): own Provider database in Firestore seeded through a Gemini-assisted "Daftarkan Provider" flow, `place_id` only, Google rating loaded only when a Patient taps it, admin-placed OpenStreetMap pin, pages indexable, Testimonies kept with Flash-Lite moderation, prompt caching and two agent calls per session, warm instance during judging only. | Grilling round in session "FindYourDent AI Builder Cup submission", 17 October |

## Shared assumptions (agreed 17 October)

1. Window: 23 days, 16 October to 7 November inclusive, ending at the published finalist announcement. The window spans two calendar months (16 days in October, 7 in November), so every monthly free cap applies twice. Per-day run rates below extend the table to any later date.
2. Traffic: headline column is judges and testers only, 300 agent sessions between 19 October and 7 November (65% in October, 35% in November). Sensitivity column is 2,000 sessions, the other session's assumption.
3. Build phase counts: 16 to 18 October usage is included (150 QA sessions for every plan; plan A's evaluation runs; seeding and moderation tests).
4. Agent model: Gemini 3.8 Flash on the global endpoint at the intro price (input 0.75, output 3.75, cached input 0.075 per 1M tokens; valid through 31 December 2026). Moderation and extraction in B2 use Gemini 3.5 Flash-Lite (0.30 / 2.50). Output prices include thinking tokens.
5. Cloud Run in asia-southeast2 (Jakarta), request-based billing. One warm agent instance (1 vCPU, 512 MiB) from 19 October to 7 November, 20 days, in every plan. Web service scales to zero.
6. Firestore default database, Cloud Storage and Artifact Registry in Jakarta.
7. Agent Search (formerly Vertex AI Search) Standard edition with the 10,000 free queries per account per month applied; a sensitivity line shows the cost if it is not.
8. Billing account is new but has no USD 300 trial credit and the hackathon gives no credits. List price throughout.
9. PPN 11% added as one line. No IDR conversion.

Per-session model usage, from each plan's own design:

| Plan | Calls per session | Input per call | Output per call | Gemini cost per session |
|---|---|---|---|---|
| A | 5 (ADK tool loop: complaint, tool calls, up to two follow-ups, final JSON card) | 4,000 tokens, of which 2,500 is a fixed prefix | 800 | 0.0300 (0.0216 if implicit caching hits the prefix) |
| B1 | 4 | 3,000 | 800 | 0.0210 |
| B2 | 2 (one Guidance call, one Shortlist call) | 3,000, of which 2,000 cached | 800 | 0.0078 |

Other unit costs used: Cloud Run Jakarta active CPU 0.0000336 per vCPU-second, active memory 0.0000035 per GiB-second, idle minimum instance 0.0000035 per vCPU-second and per GiB-second, so one warm 1 vCPU / 512 MiB instance costs 0.4536 per day; Place Details Enterprise 20.00 and Enterprise + Atmosphere 25.00 per 1,000 after 1,000 free per SKU per month; Text Search Enterprise 35.00 per 1,000 after 1,000 free; Place Photos 7.00 per 1,000 after 1,000 free; Text Search and Place Details IDs-only free without limit; Agent Search Standard 1.50 per 1,000 queries after the free 10,000 per month; Gen AI Evaluation model-based metrics billed only as autorater model tokens; Artifact Registry 0.10 per GiB-month over 0.5 GiB; Firebase Authentication, Cloud Build, Secret Manager, Cloud Logging, Cloud Monitoring uptime checks and Cloud Scheduler all inside their free allowances at this scale.

## Result: 23 days, 300 sessions (headline)

| Line | A | B1 | B2 | Note |
|---|---|---|---|---|
| Gemini, agent, judging sessions (300) | 9.00 | 6.30 | 2.34 | per-session cost above |
| Gemini, agent, build-phase QA (150 sessions) | 4.50 | 3.15 | 1.17 | 16 to 18 October |
| Gemini, evaluation runs (40 cases x 5 iterations, 3 calls each) | 3.60 | 0 | 0 | A only |
| Gen AI Evaluation autorater (600 judge calls) | 1.60 | 0 | 0 | A only; computation-based metrics are negligible |
| Gemini, Testimony moderation (45) | 0 | 0.16 | 0.08 | B1 at Flash, B2 at Flash-Lite |
| Gemini, "Daftarkan Provider" extraction (35) | 0 | 0 | 0.28 | B2 only |
| Gemini, price-list extraction (60 calls) | 0.90 | 0.90 | 0.48 | B2 at Flash-Lite |
| Explicit context cache storage (2,000 tokens, 23 days) | 0 | 0 | 1.10 | 0 if B2 relies on implicit caching |
| Agent Search queries | 0 | 0 | 0 | inside the free 10,000 per month |
| Places: Text Search Enterprise | 0 | 0 | 0 | B1: 495 calls in October, 105 in November, under the cap |
| Places: Place Details Enterprise + Atmosphere (reviews) | 0 | 2.13 | 0 | B1: 1,085 calls in October (500 build, 585 judging), 85 billable |
| Places: Place Photos | 0 | 0.60 | 0 | B1 only |
| Places: Place Details Enterprise, rating on tap | 0 | 0 | 0 | B2: 395 calls in October, under the cap |
| Cloud Run, warm agent instance, 20 days | 9.07 | 9.07 | 9.07 | see free-tier note |
| Cloud Run, active CPU and memory | 0.47 | 0.47 | 0.32 | 30 s per session in A and B1, 20 s in B2 |
| Cloud Run, web service | 0 | 0 | 0 | inside the free tier |
| Firestore | 0 | 0 | 0 | default database free quota |
| Cloud Storage, egress, Artifact Registry | 0.20 | 0.20 | 0.25 | Jakarta has no free storage tier; cents |
| Auth, Build, Secrets, Logging, Monitoring, Scheduler | 0 | 0 | 0 | free allowances |
| **Subtotal ex-tax** | **29.34** | **22.98** | **15.09** | |
| PPN 11% | 3.23 | 2.53 | 1.66 | |
| **Total** | **32.57** | **25.51** | **16.75** | |

## Result: 23 days, 2,000 sessions (sensitivity)

| Line | A | B1 | B2 | Note |
|---|---|---|---|---|
| Gemini, agent, judging sessions (2,000) | 60.00 | 42.00 | 15.60 | |
| Gemini, agent, build-phase QA | 4.50 | 3.15 | 1.17 | |
| Gemini, evaluation runs and autorater | 5.20 | 0 | 0 | |
| Gemini, moderation (300), Provider extraction (60), price lists | 0.90 | 1.95 | 1.47 | |
| Explicit context cache storage | 0 | 0 | 1.10 | |
| Agent Search queries (about 5,600 in A, 4,600 in B) | 0 | 0 | 0 | 3,650 in October, 1,750 in November, under the cap |
| Places: Text Search Enterprise | 0 | 21.00 | 0 | B1: 1,600 calls in October, 600 billable |
| Places: Place Details Enterprise + Atmosphere | 0 | 112.50 | 0 | B1: 4,400 calls in October and 2,100 in November, 4,500 billable |
| Places: Place Photos | 0 | 31.50 | 0 | B1; optional, drop photos from the field mask to remove it |
| Places: Place Details Enterprise, rating on tap (1,700) | 0 | 0 | 3.50 | B2: 175 billable in October |
| Cloud Run, warm agent instance | 9.07 | 9.07 | 9.07 | |
| Cloud Run, active (agent and web) | 2.28 | 3.28 | 1.52 | B1 adds server-side Places calls on the web service |
| Storage, egress, Artifact Registry | 0.30 | 0.60 | 0.60 | Testimony photos and their views |
| **Subtotal ex-tax** | **82.25** | **225.05** | **34.03** | B1 without photos: 193.55 |
| PPN 11% | 9.05 | 24.76 | 3.74 | |
| **Total** | **91.30** | **249.81** | **37.77** | |

## Run rate after the build phase, and a 41-day window

Per day at 15 sessions per day, ex-tax: A 0.93, B1 0.80 plus Places overflow once a month's cap is used (about 0.30 per day at this traffic), B2 0.63. The warm instance is 0.45 of each.

If the window were 16 October to 27 November (41 days, warm instance 38 days): A about 48, B1 about 45, B2 about 27 ex-tax, before PPN.

## What moves the numbers

- **The warm instance is the largest line at judge traffic** (60% of B2, 30% of A). Cloud Run's free tier (180,000 vCPU-seconds and 360,000 GiB-seconds per month, applied as a spending discount at us-central1 rates) is not applied in the headline. Depending on how Google values free seconds against idle minimum-instance time, the 9.07 falls to somewhere between 0.70 and 7.70. Expect the real bill for this line to be lower than shown.
- **Gemini intro pricing is delivered as 50% credits back on net spend.** The invoice may show the standard price (1.50 in, 7.50 out) with the credit posted separately. Cash exposure on the Gemini lines can be double the figures above until the credit lands.
- **Agent Search free trial.** If the 10,000 free queries do not apply to this account: A adds 2.25 (300 sessions) or 8.40 (2,000); B1 and B2 add 0.90 or 6.90.
- **Plan A without any caching assumption is conservative.** Vertex applies implicit caching to repeated prefixes; if it hits, A's agent lines fall by about 28% (saves 3.80 at 300 sessions, 18 at 2,000). Collapsing the ADK loop from 5 calls to 3 would save another 40%.
- **B1 is the only scope whose cost scales with traffic in a way that hurts.** Place Details with reviews is 25.00 per 1,000 and the free cap is 1,000 per month; every page view that shows reviews is a billable call once the cap is used. At 300 sessions the caps absorb almost all of it; at 2,000 sessions it is 70% of the bill.
- **Custom domain.** findyourdent.com on Cloud Run in Jakarta needs a front: Cloud Run domain mapping is preview-only and not offered in asia-southeast2. Firebase Hosting with a rewrite to Cloud Run costs nothing (verify that rewrites support the Jakarta region before relying on it); a global external Application Load Balancer costs 13.80 for 23 days (0.025 per hour for the forwarding rule) or 24.60 for 41 days. Not included above. Domain registration is not a GCP cost unless bought through Cloud Domains (12.00 per year).
- **Gemini Developer API free tier** would make every Gemini line zero, but it is not Google Cloud, scores nothing for "Google Cloud architectural depth", and its free-tier data terms are unsuitable for Patient complaint text. Not recommended for the agent; acceptable for synthetic evalset experiments.
- **Not in GCP billing but real:** team hours to seed and verify 30 to 50 Providers (A and B2) versus none in B1; human moderation time for Testimonies (B1 and B2).

## Reading

At judge traffic all three scopes cost under USD 35 ex-tax for the whole window, and the difference between A and B2 is about USD 14, of which 5 is plan A's evaluation runs and the rest is plan A's five-call agent loop. Cost does not separate A from B2; scope, legal exposure and time to build do. B1 is cheap only while traffic stays inside the Places free caps, and it is the one scope that becomes expensive if the prototype gets real use. If a budget ceiling is needed for the window, USD 50 covers A or B2 with PPN and the custom-domain load balancer; USD 100 covers A at 2,000 sessions.

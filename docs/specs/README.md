# FindYourDent specs (AI Builder Cup 2026)

Written 17 October 2026 from the grilling sessions. Submission deadline is 18 October 2026 (assumed 23:59 IST); the deployed URL must stay up through the finalist announcement on 7 November 2026. Team of two: **A** builds the agent service (Python, ADK, Gemini), **B** builds the web app and Google Cloud setup (React Router v7, Firebase); the product owner does the deck, video and narration.

Vocabulary follows [GLOSSARY.md](../../GLOSSARY.md). Decisions follow the ADRs in [docs/adr](../adr). These specs replace the scope in `docs/hackathon-plan.md` (written by another session for an earlier version of the idea).

## The specs

| # | Spec | Label | Owner | Depends on | Cut order |
|---|---|---|---|---|---|
| 00 | [Platform foundation](00-platform-foundation.md) | ready-for-agent | B, with A | none | never |
| 01 | [Guidance and Emergency Escalation](01-guidance-and-emergency-escalation.md) | ready-for-agent | A | 00 | never; voice input last |
| 02 | [Shortlist and Provider page](02-shortlist-and-provider-detail.md) | ready-for-agent | B, with A | 00, 01 | never |
| 03 | [Testimonies and Moderation](03-testimonies-and-moderation.md) | ready-for-agent | B, with A | 00, 02 | never; Moderation can fall back to hold-all |
| 04 | [Landing feed, directory and impact counter](04-landing-feed-and-directory.md) | ready-for-agent | B | 00, 03 | never; extra filters can go |
| 05 | [Claim and Price List](05-claim-and-price-list.md) | ready-for-agent | B, with A | 00, 02, 03 | first: Price List, then Claim |
| 06 | [Post-deployment evaluation and first real Testimonies](06-post-deployment-evaluation.md) | ready-for-human | product owner | 01, 02, 03 | not in the submission build |
| 07 | [Proven Testimonies and buzzer defence](07-proven-testimonies-and-buzzer-defence.md) | ready-for-agent | B, with A | 02, 03, 04 | part 1 never; part 2 after the hackathon |

Cut order under time pressure, first to last: Price List, Claim, Gemini Moderation (fall back to holding every Testimony for the admin), voice input. Guidance, Emergency Escalation, the Shortlist, Provider pages, posting Testimonies and the landing feed are never cut.

## Critical path

1. Spec 00 setup and both services deployed (hello world on the real URL).
2. A: spec 01 agent contract stub first, so B can build the UI against it; then Emergency Escalation with its tests, grounding, and the Guidance call.
3. B: spec 02 Places adapter, Shortlist and Provider page; then spec 03 posting journey and admin queue; then spec 04.
4. A: spec 02 reasons call, spec 03 Moderation endpoint, then spec 05 extraction.
5. Freeze, smoke test on a phone over mobile data, README with emergency test results and Lighthouse scores, record the video.

## Test seams (agreed)

1. The agent service HTTP contract, with Gemini, Agent Search and Places faked at their adapters.
2. The web service HTTP API against the Firebase emulators, with the Places adapter and agent faked.
3. Three end-to-end browser tests on the deployed preview: complaint to Guidance to Shortlist to Provider page; posting a Testimony; an admin reviewing a held Testimony.

## How the build maps to the judging criteria

| Criterion | Weight | Where it is earned |
|---|---|---|
| Technical Merit & Gen AI Implementation | 40% | Spec 01 (grounded ADK agent, structured Guidance, two-layer Emergency Escalation with published tests), spec 03 (Gemini Moderation with human accountability, Proof of Visit check), spec 05 (document extraction), spec 00 (Cloud Run, Firestore, App Check, Agent Search, quotas) |
| Problem Alignment & Impact | 25% | Problems A1 and A2; SKI 2023 figures; BPJS answers; the live impact counter (spec 04); spec 06 results during judging |
| Innovation & Creativity | 25% | Guidance plus a Shortlist ranked by Testimonies FindYourDent owns, each screened by AI and checked against proof of visit; voice complaint input |
| User Experience | 10% | Indonesian-first, mobile-first responsive web app, voice input, sign-in only at "Kirim", fix-before-submit Moderation, Lighthouse scores |

Differentiator (deck and video): "FindYourDent turns a toothache into a guided decision. A grounded Gemini agent explains urgency, the visit journey, cost and BPJS coverage, then shortlists Providers ranked by Patient Testimonies that FindYourDent owns, each one screened by AI and checked against proof of visit."

## Video storyboard (under 3 minutes; nothing outside these scenes is built)

1. **Problem** (Impact): SKI 2023 figures (checked against the report) and one real Testimony.
2. **Guidance** (Technical Merit): a voice or typed complaint, the Guidance card with the BPJS answer, then the emergency case and the "Ke IGD sekarang" card.
3. **Shortlist** (Innovation): five Providers with reasons, a Provider page, the "Lihat ulasan Google" tap.
4. **Posting a Testimony** (Technical Merit, Gen AI depth): the fix-before-submit prompt for a phone number, Gemini Moderation, Kunjungan terbukti.
5. **Architecture and impact** (Impact, Google Cloud depth): the architecture diagram, the live counter, and the roadmap to Providers and clinics.

## Cost reference

Shared numbers: [docs/research/cost-comparison-2026-10-17.md](../research/cost-comparison-2026-10-17.md). This design is closest to its column B2 (about USD 15 ex-tax at 300 sessions over 23 days). Places spend above the free allowances is capped at USD 10 a month (ADR-0005).

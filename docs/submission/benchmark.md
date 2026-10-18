# Prototype performance and benchmarking

One table for the deck's "Prototype Performance report/Benchmarking" slide (issue #23). Every number links to where it was measured; the README has the detail. Measured on 18 October 2026 against https://findyourdent.com: web revision `fyd-web-00008-9v6` (image `web:0066864071ec`), agent revision `fyd-agent-00006-nqg`.

| Area | Measure | Result | Gate | Source |
| --- | --- | --- | --- | --- |
| Lighthouse, landing page (mobile) | Performance / Accessibility / Best practices / SEO | **96 / 100 / 100 / 100** | 90 / 95 / 90 / 90 | [Lighthouse](../../README.md#lighthouse) |
| Lighthouse, landing page (mobile) | LCP / TBT / CLS | 2.2 s / 0 ms / 0 | | [median report](lighthouse/2026-10-18-landing-mobile.json) |
| Lighthouse, Listed Provider page (mobile) | Performance / Accessibility / Best practices / SEO | 99 / 100 / 100 / 100 | | [Lighthouse](../../README.md#lighthouse) |
| Emergency Escalation | Must-escalate phrases that get the "Ke IGD sekarang" card | **48 / 48** | 100% | [results](../../README.md#emergency-escalation-results) |
| Emergency Escalation | Must-not-escalate phrases left alone | **28 / 28** | 100% | [results](../../README.md#emergency-escalation-results) |
| Guidance evaluation (40 cases) | Emergency recall | **100%** (8/8) | 100% | [results](../../README.md#guidance-evaluation-results) |
| Guidance evaluation | Urgency-tier accuracy | 76% (28/37) | ≥ 85%, **fail** | [results](../../README.md#guidance-evaluation-results) |
| Guidance evaluation | Category / journey accuracy | 100% / 100% | | [results](../../README.md#guidance-evaluation-results) |
| Guidance evaluation | Unsafe medicine advice | **0** | 0 | [results](../../README.md#guidance-evaluation-results) |
| Moderation evaluation (30 cases × 3 runs) | False publishes / neutrality mismatches | **0 / 0** | 0 / 0 | [results](../../README.md#moderation-evaluation-results) |
| Moderation evaluation | Decision accuracy | 96.7% (29/30) | ≥ 90% | [results](../../README.md#moderation-evaluation-results) |
| End-to-end, deployed site | Complaint to Guidance to Shortlist to Provider page to Google Reviews | Passed 3 of 5 runs | | [journeys](../../README.md#end-to-end-journeys-on-the-deployed-site) |
| End-to-end, deployed site | Testimony with a phone number, fixed, published | Passed 3 of 5 runs | | [journeys](../../README.md#end-to-end-journeys-on-the-deployed-site) |
| End-to-end, deployed site | Admin decides on a held Testimony | Not passed yet | | [journeys](../../README.md#end-to-end-journeys-on-the-deployed-site) |

Lighthouse: version 12.6.1 through `@lhci/cli` 0.15.1, mobile form factor, simulated throttling, 3 runs per page; each row is the run with the median performance score. The Guidance and Moderation labels are source-derived and team-labelled, not reviewed by a licensed dentist.

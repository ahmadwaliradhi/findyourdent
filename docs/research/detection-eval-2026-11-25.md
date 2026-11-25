# Detection evaluation, 2026-11-25

- Detection under test: `apps/web/app/server/detection.ts` (D1 velocity, D2 similarity, D3 sharedDevice)
- Labels: agent-drafted by Claude, not reviewed by the team yet
- Cases: 34 (17 campaign, 17 genuine)
- Constants: `VELOCITY_DAY_THRESHOLD` 3, `VELOCITY_DAY_WINDOW_HOURS` 24, `VELOCITY_WEEK_THRESHOLD` 5, `VELOCITY_WEEK_WINDOW_HOURS` 168, `SIMILARITY_THRESHOLD` 0.75

| Gate | Threshold | Value | Result |
|---|---|---|---|
| campaign hold rate | >= 0.9 | 0.941 | pass |
| genuine hold rate without known false holds | <= 0.1 | 0.000 | pass |

## Hold rate per group

| Group | Cases | Held | Hold rate |
|---|---|---|---|
| campaign | 17 | 16 | 0.941 |
| genuine | 17 | 6 | 0.353 |
| genuine without known false holds | 11 | 0 | 0.000 |

A known false hold is a genuine case that a rule's definition holds and no threshold can fix (see the last section); the gate leaves them out, the first genuine row counts them.

## Before tuning

First run with the thresholds as shipped in the Part 2 detection module (D2 at 0.8). The campaign template with several small rewordings scored 0.785 and was published; the most similar genuine pair scored 0.632. D2 was lowered to 0.75, a tightening that catches the template and still clears the genuine pairs by 0.12. D1, D3 and the genuine false holds are unchanged: see the findings.

- Constants before: `SIMILARITY_THRESHOLD` 0.8
- Campaign hold rate before 0.882, after 0.941
- Genuine hold rate before 0.353, after 0.353
- Genuine hold rate without known false holds before 0.000, after 0.000

## Per-rule breakdown

Cases in which each rule fired (a case can fire more than one).

| Rule | Campaign | Genuine |
|---|---|---|
| D1 | 7 | 2 |
| D2 | 8 | 0 |
| D3 | 5 | 4 |

- Campaign cases that slipped through: camp-slow-paraphrase
- Genuine cases held (false holds): gen-three-in-day-spread, gen-five-in-week-busy, gen-waiting-room-wifi, gen-waiting-room-wifi-busy, gen-family-home-network, gen-family-shared-tablet
- Cases whose fired rules differ from the expected ones: none

## Cases

| Case | Group | Expected | Outcome | Rules fired | Rules as expected |
|---|---|---|---|---|---|
| camp-burst-day | campaign | hold | hold | D1 | yes |
| camp-burst-week | campaign | hold | hold | D1 | yes |
| camp-burst-day-edge | campaign | hold | hold | D1 | yes |
| camp-burst-week-edge | campaign | hold | hold | D1 | yes |
| camp-copypaste | campaign | hold | hold | D2 | yes |
| camp-template-one-word | campaign | hold | hold | D2 | yes |
| camp-template-reworded-ends | campaign | hold | hold | D2 | yes |
| camp-template-english | campaign | hold | hold | D2 | yes |
| camp-short-copy | campaign | hold | hold | D2 | yes |
| camp-case-and-spacing | campaign | hold | hold | D2 | yes |
| camp-one-phone-three-accounts | campaign | hold | hold | D3 | yes |
| camp-same-network-staff | campaign | hold | hold | D3 | yes |
| camp-shared-device-short | campaign | hold | hold | D3 | yes |
| camp-burst-and-template | campaign | hold | hold | D1, D2 | yes |
| camp-burst-one-phone | campaign | hold | hold | D1, D3 | yes |
| camp-all-three | campaign | hold | hold | D1, D2, D3 | yes |
| camp-slow-paraphrase | campaign | hold | publish | - | yes |
| gen-busy-two-in-day | genuine | publish | publish | - | yes |
| gen-steady-four-in-week | genuine | publish | publish | - | yes |
| gen-three-in-day-spread | genuine | publish | hold | D1 | yes |
| gen-five-in-week-busy | genuine | publish | hold | D1 | yes |
| gen-short-shared-phrase | genuine | publish | publish | - | yes |
| gen-short-common-praise | genuine | publish | publish | - | yes |
| gen-many-short-reviews | genuine | publish | publish | - | yes |
| gen-english-short | genuine | publish | publish | - | yes |
| gen-same-wording-different-visit | genuine | publish | publish | - | yes |
| gen-waiting-room-wifi | genuine | publish | hold | D3 | yes |
| gen-waiting-room-wifi-busy | genuine | publish | hold | D3 | yes |
| gen-family-home-network | genuine | publish | hold | D3 | yes |
| gen-family-shared-tablet | genuine | publish | hold | D3 | yes |
| gen-same-author-after-delete | genuine | publish | publish | - | yes |
| gen-own-old-held-new-network | genuine | publish | publish | - | yes |
| gen-quiet-clinic-old-testimonies | genuine | publish | publish | - | yes |
| gen-two-visits-same-day-friends | genuine | publish | publish | - | yes |

## Near-threshold cases and known false holds

| Case | Kind | Note |
|---|---|---|
| camp-burst-day-edge | near threshold | Three in just under 24 hours (23.5 h span), distinct texts and devices: sits on the day window edge. |
| camp-burst-week-edge | near threshold | Fifth Testimony of a 6.9-day span, spread over days: one hour inside the week window. |
| camp-template-reworded-ends | near threshold | Template with several small rewordings and punctuation changes, compared with a held copy. |
| gen-steady-four-in-week | near threshold | A steady clinic: fourth Testimony in a week, never more than two in a day. |
| gen-three-in-day-spread | known false hold (D1) | A popular clinic on a Saturday: three different patients over about 21 hours, each text clearly its own. D1 holds it, and it has the same shape as camp-burst-day-edge, so loosening D1 would let that campaign through. |
| gen-five-in-week-busy | known false hold (D1) | A very busy clinic: fifth Testimony in a week (one a day), every patient on their own phone and network. D1 holds it, and it has the same shape as camp-burst-week-edge. |
| gen-waiting-room-wifi | known false hold (D3) | Two patients wrote on the clinic's waiting-room wifi (same IP hash, own phones and accounts), three days apart. D3 holds it; a threshold cannot fix that. |
| gen-waiting-room-wifi-busy | known false hold (D3) | Third patient on the same waiting-room wifi in a month, no other overlap. D3 holds it. |
| gen-family-home-network | known false hold (D3) | A mother and her son, each with an account and phone, writing on the home wifi four days apart. D3 holds it. |
| gen-family-shared-tablet | known false hold (D3) | Two spouses on one shared tablet (same browser id and IP), two weeks apart. D3 holds it. |

## Findings

- D2 was the only threshold the eval asked to move: 0.8 to 0.75 (tightening). No genuine pair came near it (highest 0.632, the two short reviews sharing 'Dokternya ramah dan bersih'); the template with several small rewordings scored 0.785.
- D3 over-holds genuine patients on shared networks: the clinic's waiting-room wifi (two cases), a family on one home network and a couple on one shared tablet are all held, because D3 matches a bare IP hash or browser-id hash across accounts. Four of 17 genuine cases. No threshold applies (D3 has none) and its definition was not changed, as the spec requires. They go to the admin queue, which shows the shared hash and whether the linked account wrote about other Providers. If it overflows with clinic wifi, the follow-up is a product decision (for example an IP hash alone, shared by several accounts across many Providers, counting for less), not a tuning change.
- D1 cannot tell a popular clinic from a campaign: three different patients in 21 hours and five in a week at one a day are held, and they have exactly the shape of camp-burst-day-edge and camp-burst-week-edge. Raising either threshold would let those campaigns through, so D1 stays at 3 per 24 hours and 5 per 7 days. Two of 17 genuine cases; the admin queue releases them.
- Known gap: a paraphrased campaign spread over weeks on different phones and networks (camp-slow-paraphrase, trigram similarity 0.27) is not seen by any rule. It is the one campaign case that is published; that is why the campaign gate is 0.9 and not 1.0. Reports and the Proven Testimony rule (only proven visits count toward the score) are the defence there.
- Short genuine reviews are safe from D2 at either threshold: character trigrams of 25 to 35 characters rarely overlap by more than 0.65 unless the texts are close to identical.

---
title: "Spec 09: Proven Testimonies and buzzer defence"
labels: [ready-for-agent]
owner: B (web) for scoring, Proof Fingerprints, admin queue and detection; A (agent) for the Proof of Visit extraction in Moderation
depends_on: ["02", "03", "04"]
cut_order: part 1 never cut; part 2 (detection and Testimony Policy Violations) follows the hackathon build
---

# Spec 09: Proven Testimonies and buzzer defence

Written 18 October 2026 from a grilling session. Decision recorded in [ADR-0011](../adr/0011-only-proven-testimonies-count.md). Part 1 changes rules in specs 02, 03 and 04; where they disagree, this spec wins.

## Problem Statement

Dentists report that some dental clinics pay buzzers to post good reviews about them on Google Maps, social media and elsewhere. A buzzer review costs a few thousand rupiah, so a clinic can buy hundreds. If the same happens on FindYourDent, its Testimony scores, its directory order, its Shortlist ranking and its price stats stop meaning anything, and the platform becomes one more unreliable place to look for a credible, affordable dentist. Real Testimonies from real Patients are FindYourDent's most valuable data, and today nothing stops them being diluted:

- A Proof of Visit is optional, and a Testimony without one counts fully in every average, sort and price stat.
- The only identity is a Google account, which costs nothing to create in bulk.
- Moderation screens one Testimony at a time, so a campaign of many similar Testimonies from many accounts looks clean piece by piece.
- Nothing says a clinic may not reward Testimonies, or ask only its happy Patients to write one.

The same holes let a competitor attack a clinic with fake negative Testimonies.

## Solution

Only a Proven Testimony counts. Any Patient can still write a Testimony and it is still published under the same Moderation rules, but unless a Proof of Visit was accepted it carries a "Belum terbukti" label and moves no number: not the aspect averages, not the directory sort, not the Shortlist ranking, not the price stats. A buzzer can still write words; they can no longer move the score without a real receipt from a real visit, which costs a real treatment.

The Proof of Visit check gets stricter and harder to reuse. The clinic name on the receipt must match the Provider, its date must fall within a month of the stated visit, and it must be less than 12 months old. FindYourDent keeps a Proof Fingerprint of every accepted receipt (never the receipt), so one real receipt cannot unlock many Testimonies. Anything doubtful goes to an admin; the Testimony itself stays published as "Belum terbukti" meanwhile. A Patient who finds the receipt later can attach it to their published Testimony.

A Provider with fewer than three Proven Testimonies shows no star average, only "Belum cukup testimoni terbukti" and the count. A public page explains how FindYourDent verifies Testimonies and what it does not allow.

After the hackathon (part 2), a detection step holds Testimonies that look like a campaign (bursts for one Provider, near-identical text, accounts sharing a device or network) for an admin, and a published policy lets the team mark a Provider that rewards or gates Testimonies with a public "Pelanggaran kebijakan testimoni" badge for six months and exclude the affected Testimonies from its score.

Sign-in stays Google only, permanently: no phone or WhatsApp OTP and no email verification.

## User Stories

### Part 1: Proven Testimonies (hackathon)

1. As a Patient choosing a dentist, I want scores built only from Testimonies backed by a proven visit, so that a clinic cannot buy its rating.
2. As a Patient choosing a dentist, I want price stats built only from Proven Testimonies, so that the "affordable" signal reflects what people really paid.
3. As a Patient, I want each Testimony labelled "Kunjungan terbukti" or "Belum terbukti", so that I know how much weight to give it.
4. As a Patient, I want to still read Testimonies without proof, so that honest experiences without a receipt are not silenced.
5. As a Patient, I want a Provider with fewer than three Proven Testimonies to show "Belum cukup testimoni terbukti" and the count instead of a star average, so that one or two Testimonies cannot pass as a reputation.
6. As a Patient, I want the directory and Shortlist order to use only Proven Testimonies, so that buzzers cannot push a clinic up the list.
7. As a Patient, I want a "Cara kami memverifikasi testimoni" page, so that I understand why FindYourDent scores can be trusted.
8. As a Patient writing a Testimony, I want the form to tell me that only Testimonies with a Proof of Visit count toward the score, so that I am encouraged to attach one.
9. As a Patient, I want to attach a receipt, invoice or appointment card as my Proof of Visit, so that my Testimony counts.
10. As a Patient, I want to know right away whether my proof was accepted, sent to the team, or not accepted and why, so that I can act.
11. As a Patient whose receipt is unreadable or too old, I want a plain reason and the chance to try another document, so that I am not stuck.
12. As a Patient, I want to attach a Proof of Visit to a Testimony that is already published, so that it starts counting when I find the receipt later.
13. As a Patient, I want attaching proof later not to re-screen or hide my published text, so that my Testimony stays visible while the proof is checked.
14. As a Patient, I want my Testimony to stay published as "Belum terbukti" while the team checks my proof, so that a doubtful receipt does not hide my story.
15. As a Patient, I want my receipt kept only as long as needed (deleted right away, or within seven days if the team must look at it), so that my health and payment data are not stored.
16. As a Patient, I want my name on the receipt never stored, so that the fingerprint cannot identify me.
17. As a Patient, I want "Testimoni saya" to show my proof status, so that I can follow it.
18. As a Patient, I want deleting my Testimony to delete its Proof Fingerprint too, so that erasure is complete.
19. As a Provider, I want a competitor's fake negative Testimonies without proof to have no effect on my score, so that I am protected from attacks.
20. As a Provider, I want the minimum of three to apply equally to everyone, so that the rule is fair.
21. As the FindYourDent team, I want a receipt whose clinic name does not match the Provider, or whose date is outside the visit month by more than one month, sent to the admin queue rather than accepted, so that edited or borrowed receipts are caught.
22. As the FindYourDent team, I want a receipt older than 12 months not accepted, so that scores stay current.
23. As the FindYourDent team, I want a receipt that matches the fingerprint of an already accepted receipt sent to the admin queue, so that one real receipt cannot unlock many Testimonies.
24. As the FindYourDent team, I want to see the held receipt, the extracted fields, the reasons and any Testimonies with a matching fingerprint in the queue, so that I can decide quickly.
25. As the FindYourDent team, I want to accept or reject a held proof with a reason the author sees, so that every outcome is explained.
26. As the FindYourDent team, I want a held proof that nobody decides within seven days to be rejected as expired and its file deleted, so that receipts never linger.
27. As the FindYourDent team, I want a limit on proof attempts per Testimony, so that a buzzer cannot try fake receipts until one passes.
28. As the FindYourDent team, I want every existing Provider aggregate recomputed under the new rule at release, with no grandfathering, so that one rule applies to everyone.
29. As the FindYourDent team, I want the impact counter's Kunjungan terbukti figure to count proofs accepted later and by an admin, so that it stays correct.
30. As the FindYourDent team, I want held Testimonies and proofs never published or accepted by a timeout, so that waiting is never a way in.
31. As the FindYourDent team, I want the policy against rewarding or gating Testimonies published on the transparency page, so that clinics are warned before part 2 enforces it.

### Part 2: detection and Testimony Policy Violations (after the hackathon)

32. As the FindYourDent team, I want a Testimony held when a Provider receives three or more new Testimonies within 24 hours or five or more within 7 days, so that bursts are reviewed.
33. As the FindYourDent team, I want a Testimony held when its text is at least 0.8 similar to another Testimony for the same Provider, so that templated campaigns are caught.
34. As the FindYourDent team, I want a Testimony held when two or more accounts share a device or network hash for the same Provider, so that one buzzer with many accounts is caught.
35. As the FindYourDent team, I want the queue to show the linked Testimonies and signals behind a detection hold, including accounts that have only ever written about this one Provider, so that I can judge the pattern.
36. As a Patient, I want my IP address never stored, and the device and network hashes deleted after 90 days, so that detection does not track me.
37. As a Patient, I want a detection hold to tell me my Testimony is being checked, without revealing the detection rules, so that I am informed but buzzers learn nothing.
38. As a reader, I want to report "Klinik menawarkan imbalan untuk testimoni", so that I can flag a clinic that pays for Testimonies.
39. As the FindYourDent team, I want to open a Testimony Policy Violation case on a Provider with its evidence, so that suspected incentives or gating are tracked.
40. As a Provider, I want to be notified of a violation case and have seven days to respond, so that I can explain before anything is public.
41. As the FindYourDent team, I want to confirm or dismiss the case after the response window, with a reason, so that the decision is accountable.
42. As a Patient, I want a confirmed violation shown as "Pelanggaran kebijakan testimoni" on the Provider page for six months, so that I know the clinic tried to buy its reputation.
43. As the FindYourDent team, I want the Testimonies from the violation period excluded from the Provider's score, so that bought Testimonies stop counting.
44. As the FindYourDent team, I want the detection thresholds tuned with the moderation eval, so that genuine busy clinics are not over-held.
45. As the FindYourDent team, I want to tighten thresholds rather than loosen the gate when the queue overflows, so that pressure never becomes an opening.

## Implementation Decisions

### Part 1

- **Proven Testimony**: a published Testimony whose Proof of Visit result is `accepted`. Only Proven Testimonies feed scores and price stats. Every published Testimony is still shown, in the feed and on the Provider page, with "Kunjungan terbukti" or "Belum terbukti".
- **Aggregates** (per Provider, recomputed whenever a Testimony enters or leaves `published` or its proof result changes):
  - `testimonyCount`: all published Testimonies (shown as a count only).
  - `verifiedVisitCount`: Proven Testimonies. This is the count the score uses.
  - `averages`: aspect averages over Proven Testimonies only; `null` when `verifiedVisitCount` is below 3. The minimum is a named constant shared by aggregates, ranking and display.
  - `procedurePrices`: from Proven Testimonies only. Spec 02's "at least two" display rule for a median still applies on top.
- **Ranking** (spec 02 Shortlist and spec 04 directory sort): the shrinkage toward the overall mean uses `verifiedVisitCount` as the count and the proven-only averages; a Provider with no average uses the overall mean. The separate Kunjungan terbukti bonus is removed, because proof is now the whole input. The directory's "most Testimonies" sort sorts by `verifiedVisitCount`.
- **Display**: star averages render only when `averages` is not null; otherwise "Belum cukup testimoni terbukti" with "N testimoni terbukti". The feed's existing "Kunjungan terbukti only" filter stays.
- **Proof of Visit result** on a Testimony becomes one of `notProvided`, `accepted`, `pending` (waiting for an admin), or `rejected` with a reason code: `unreadable`, `notAProof`, `tooOld`, `adminRejected`, `expired`. `pending` carries the reasons that sent it to the admin: `nameMismatch`, `dateMismatch`, `possibleReuse`. `verifiedVisit` is true only for `accepted`.
- **Moderation contract change (agent)**: when a Proof of Visit is given, the output adds an extraction: `readable`, `isProofOfVisit`, `clinicNameOnProof`, `proofDate` (day if printed, else month), `totalRupiah` if printed, and `clinicNameMatches` (Gemini's fuzzy judgment against the typed name and Google's live name). The patient's name is never extracted. The old `accepted`/`rejected` judgment is replaced by these facts; the agent no longer applies a date window. The proof still never changes the Testimony's own `decision`.
- **Proof decision (web, a pure function)** takes the extraction, the stated visit month, today's date (Asia/Jakarta) and the reuse check:
  1. Not readable or not a proof: `rejected` (`unreadable` or `notAProof`).
  2. Proof date more than 12 months before today: `rejected` (`tooOld`).
  3. Otherwise `pending` if the clinic name does not match, the proof month is more than one month from the visit month, or the reuse check finds a match; reasons accumulate.
  4. Otherwise `accepted`.
- **Proof Fingerprint**: computed by the web service from the proof before the file is deleted, and stored for `accepted` and `pending` proofs: a 64-bit perceptual hash for images (with `sharp`), a SHA-256 of the file for PDFs, and a key built from the normalised `clinicNameOnProof`, `proofDate` and `totalRupiah`. Kept in a new `proofFingerprints` collection keyed by Testimony, with `placeId`; no image, no patient name. Deleted when its Testimony is deleted or its proof is rejected.
- **Reuse check**: against fingerprints for the same `placeId` held by other Testimonies: the same key, the same file hash, or a perceptual-hash Hamming distance of 10 bits or less is `possibleReuse`. The per-Provider set is small, so the comparison is a scan in the web service; no index on the hash.
- **Proof file retention** (amends spec 03's "deleted immediately"): an `accepted` or `rejected` proof file is deleted right after the decision, as today. A `pending` proof file stays in the private uploads bucket for the admin until decided, at most 7 days. A bucket lifecycle rule on the proof prefix deletes anything older than 7 days as a backstop, and a scheduled sweep turns `pending` proofs older than 7 days into `rejected` (`expired`).
- **Admin queue**: a new item type, proof review, showing the proof file, the extraction, the pending reasons and, for `possibleReuse`, links to the Testimonies with matching fingerprints. Actions: accept proof, reject proof with a reason the author sees. Both are recorded in `adminActions`. Target 72 hours. Never auto-accepted.
- **Attach proof later**: the author of a published Testimony without an accepted proof can upload one from "Testimoni saya". The web service calls Moderation in a proof-only mode (no text or photo screening, no `pendingRevision`, no change to the public Testimony) and applies the same proof decision. At most 3 proof attempts per Testimony (counted on the Testimony, including the attempt at submission); after that the author can only wait for an admin decision or delete and rewrite. Proof uploads use the existing per-account write limits.
- **Release recompute (no grandfathering)**: a one-off job recomputes every Provider's aggregates under the new rule and resets the directory and Shortlist inputs. Testimonies already marked Kunjungan terbukti under the old 24-month rule stay accepted; their files are gone, so they cannot be re-checked and get no fingerprint.
- **Impact counter**: `impact.verifiedVisits` increments on every move into `accepted` (at submission, by admin or later attachment) and decrements when a Proven Testimony leaves `published` or is deleted.
- **Testimony form copy**: next to the Proof of Visit field, a line saying only Testimonies with an accepted Proof of Visit count toward the score, and that the file is deleted after the check.
- **Transparency page** "Cara kami memverifikasi testimoni": server-rendered, indexable, linked from the footer, the Testimony form and every "Belum terbukti" label. States: only Proven Testimonies count; how proof is checked and how long it is kept; the minimum of three; that FindYourDent never pays for Testimonies; that Providers may not offer anything in exchange for a Testimony or ask only selected Patients to write one, and that a confirmed violation is shown publicly. It does not state detection thresholds.

### Part 2

- **Submission signals**: on each Testimony submission and edit, the web service writes a `submissionSignals` document (keyed by Testimony) with a salted SHA-256 of the client IP and a salted SHA-256 of the opaque browser id kept in the `__session` cookie (ADR-0008), plus `placeId`, `authorUid` and `expiresAt` 90 days later (Firestore TTL). No raw IP or id is stored.
- **Detection runs in the web service at submission**, after Moderation returns `publish`, and can only turn `publish` into `hold`. Triggers, each with a rule code shown to admins only:
  - `D1 velocity`: 3 or more Testimonies for the same `placeId` submitted within 24 hours, or 5 or more within 7 days, counting this one.
  - `D2 similarity`: character-trigram Jaccard similarity of 0.8 or more with any published or held Testimony for the same `placeId`.
  - `D3 sharedDevice`: another account's submission for the same `placeId` shares the IP hash or browser-id hash.
- Thresholds are constants tuned with the moderation eval set (spec 06) extended with campaign-shaped cases. When the queue overflows, tighten thresholds; never auto-publish.
- **Author message on a detection hold**: the standard held message; the rule codes are not shown.
- **Admin queue for detection holds** shows the linked Testimonies (same Provider, same window), their similarity, shared hashes, and whether each linked account has written about any other Provider.
- **Report reason** `incentive` ("Klinik menawarkan imbalan untuk testimoni") added to `testimonyReports`; it does not hide the Testimony.
- **Testimony Policy Violation** (new `policyViolations` collection): `placeId`, evidence (report ids, detection holds, admin notes and screenshots in the private bucket), the suspected period, and status `open` → `providerNotified` (with `responseDueAt` 7 days later) → `confirmed` or `dismissed`, each move recorded in `adminActions` with a reason. A claimed Provider is notified and responds in its owner pages; an unclaimed Provider is contacted by phone through its live Google listing, as for Claims. On `confirmed`: a "Pelanggaran kebijakan testimoni" badge shows on the Provider page and directory row until `badgeUntil` (6 months), and Testimonies in the period are marked `excludedByViolation` and left out of aggregates (still readable, labelled).

## Testing Decisions

- Good tests check behaviour through the public seams, not internals: given Testimonies and proofs in, what the HTTP API returns and what the pages render. Pure decision modules (proof decision, aggregates, ranking, similarity) may also have unit tests, as `aggregates.ts` and `ranking.ts` do today.
- **Seam 1, web service HTTP API against the Firebase emulators with the agent faked** (prior art: the Testimony, admin-queue, directory, Shortlist and feed API tests):
  - a Testimony without accepted proof is published with "Belum terbukti" and changes no average, sort position or price stat;
  - averages are null below 3 Proven Testimonies and appear at 3;
  - each proof decision path: unreadable, not a proof, too old, name mismatch, date mismatch, reuse (same key, same PDF hash, near-identical image), accepted;
  - a `pending` proof keeps the Testimony published and the file stored; admin accept makes it Proven and recomputes aggregates; admin reject deletes the file and fingerprint; the 7-day sweep expires it;
  - accepted and rejected proof files are gone from storage after the decision;
  - attaching proof later: no re-screening, no change to public text, attempt limit enforced, only the author can attach;
  - deleting a Testimony deletes its fingerprint and decrements the counter;
  - the release recompute changes aggregates for a Provider with unproven Testimonies;
  - the transparency page renders server-side and contains no threshold numbers.
  - Part 2: each detection trigger holds and nothing else does; no raw IP in Firestore; signals carry `expiresAt`; the violation state machine, notification window, badge and exclusion from aggregates.
- **Seam 2, agent Moderation contract with Gemini faked** (prior art: the moderation contract tests): the extraction fields validate against the schema; the patient's name is never in the output; proof-only mode screens nothing else; a proof never changes `decision`.
- Real-model extraction quality (clinic name match on real Indonesian receipts, dates) is measured in the moderation eval (spec 06), with receipts made by the team, never real Patients' receipts.
- End-to-end: the existing posting test adds a proof and sees "Kunjungan terbukti"; no new journey test.

## Out of Scope

- Phone, WhatsApp or email verification of authors, now and later (ADR-0011).
- Booking through FindYourDent as proof of visit; revisit if booking is ever built.
- A code or confirmation issued by the clinic as proof (the clinic must never gate its own Testimonies).
- Rewards of any kind for writing Testimonies.
- Publishing detection thresholds.
- Expiring Proven Testimonies from the score by age; only the receipt's age at check time matters.
- Automatic rejection or removal by detection; detection only holds.

## Further Notes

- The two-admin team must keep the 72-hour target for held Testimonies and proofs; the 7-day proof expiry is the backstop.
- Reused receipts cost the attacker a real visit per Provider; the fingerprint stops multiplying one visit across accounts, not across Providers (a receipt naming one clinic fails the name match for another).
- UU 27/2022: a fingerprint and extracted clinic, date and total are not the receipt and carry no patient name; signals are hashed and expire in 90 days.
- On submission day most Providers will show "Belum cukup testimoni terbukti". That is the intended honest empty state, and the demo should show a Testimony with a receipt becoming Kunjungan terbukti.

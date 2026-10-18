---
title: "Spec 03: Testimonies and Moderation"
labels: [ready-for-agent]
owner: B (web) for the journey, admin queue and data; A (agent) for the Moderation endpoint
depends_on: ["00", "02"]
cut_order: never cut; if time runs out, Gemini Moderation falls back to holding every Testimony for the admin
---

# Spec 03: Testimonies and Moderation

## Problem Statement

Patients cannot judge whether a dentist is credible before they go (problem A1). Google reviews are short, rarely mention hygiene or materials, and belong to Google, so FindYourDent cannot build on them. A Patient who had a good or bad experience has no simple, safe place to describe it in detail, with the procedure and the price they paid, without exposing themselves. And a platform that publishes experiences about named health professionals carries real risk: personal data, defamation, fake or paid reviews, and Providers trying to bury complaints.

## Solution

Anyone can read Testimonies. A Patient who has visited a Provider anywhere in Indonesia taps "Ceritakan pengalamanmu", picks the place, rates service, hygiene, and materials and equipment, writes as much as they want, and can add the procedure, the price paid, the visit month, clinic photos and a private Proof of Visit. They sign in with Google only when they press "Kirim". Gemini screens the Testimony in seconds: clean ones are published, fixable problems (like a phone number in the text) are shown to the author to fix before submitting, and anything doubtful is held for the FindYourDent team. The author can edit or delete their Testimony at any time; a Provider can reply or report but never delete; only a human removes anything published.

## User Stories

1. As a Patient, I want to start a Testimony from the landing page, a Provider page or after my Shortlist, so that I can share whenever I remember.
2. As a Patient, I want to find the place I visited by typing its name, anywhere in Indonesia, so that I am not limited to one city.
3. As a Patient who shares my location, I want nearby places suggested first, so that I find mine faster.
4. As a Patient who does not share my location, I want the search to work anyway, so that I am not forced to share it.
5. As the first Patient to write about a place, I want to type the place's name as I know it from its signboard, so that the Testimony has a clear name.
6. As a later Patient for the same place, I want the name already filled in by FindYourDent, so that I do not retype it.
7. As a later Patient who sees a wrong name, I want to suggest a correction, so that the record improves.
8. As a Patient, I want to choose the province and kota/kabupaten (required) and kecamatan (optional) from an official list, so that my Testimony is findable by area.
9. As a Patient, I want to rate service, hygiene, and materials and equipment from 1 to 5, so that I can be specific about what was good or bad.
10. As a Patient, I want to write as much as I need, so that I can tell the whole story.
11. As a Patient, I want my draft kept if I close the page by accident, so that I do not lose what I wrote.
12. As a Patient, I want to add which procedure I had and the price I paid, optionally, so that other Patients can judge affordability.
13. As a Patient, I want to give the visit month and year rather than the exact date, so that I am harder to identify.
14. As a Patient, I want to add up to four photos of the clinic (waiting room, treatment room, equipment), so that others can see the hygiene and equipment.
15. As a Patient, I want location data removed from my photos automatically, so that my photos do not reveal where I live.
16. As a Patient, I want to attach a receipt or appointment screenshot privately as Proof of Visit, so that my Testimony is marked "Kunjungan terbukti" without the document being shown.
17. As a Patient, I want the Proof of Visit file deleted right after it is checked, so that my receipt is not kept.
18. As a Patient, I want to choose the public name shown on my Testimony (initials by default), so that I can stay anonymous to the Provider.
19. As a Patient, I want to confirm that this is my honest experience and contains no one else's personal data, so that I know the rules.
20. As a Patient, I want to sign in with Google only when I press "Kirim", so that writing feels effortless.
21. As a Patient, I want to know within seconds whether my Testimony is published or being reviewed, so that I am not left wondering.
22. As a Patient whose Testimony contains a phone number or other fixable problem, I want to see the exact sentence and the reason, and fix it before it is submitted, so that I do not wait for a human.
23. As a Patient whose Testimony is held, I want a plain reason and an estimate of when the team will decide, so that I understand.
24. As a Patient, I want to see my published Testimony on the Provider page and in the landing feed, so that I feel it was worth it.
25. As a Patient, I want a "Testimoni saya" page showing the status of everything I wrote and any Provider replies, so that I can follow up.
26. As a Patient, I want to edit my Testimony (it is screened again), so that I can correct or update it.
27. As a Patient, I want to delete my Testimony permanently, so that I control my own data.
28. As a Patient, I want only one Testimony per place, editable over time, so that each voice counts once.
29. As a reader, I want to report a Testimony for personal data, threats, false claims, spam or conflict of interest, so that problems get reviewed.
30. As a reader, I want Testimonies reported for personal data or threats hidden immediately until reviewed, so that harm stops fast.
31. As a claimed Provider, I want to reply publicly to a Testimony, so that I can respond professionally.
32. As a Provider, I want to report a Testimony I believe is false, so that the team reviews it, knowing I cannot delete it.
33. As the FindYourDent team, I want Gemini to publish only Testimonies that break no rule with high confidence, so that clean posts appear immediately.
34. As the FindYourDent team, I want every held or reported Testimony in one admin queue with Gemini's reasons and the flagged text, so that I can decide quickly.
35. As the FindYourDent team, I want to publish, reject with a reason, or send back to the author from the queue, so that every outcome is explained.
36. As the FindYourDent team, I want to be the only ones who can remove a published Testimony, so that removal is always a human decision.
37. As the FindYourDent team, I want a 10% sample of auto-published Testimonies in the queue for spot-checking, so that I can tell whether Gemini is getting it right.
38. As the FindYourDent team, I want every admin decision recorded with who, when and why, so that we can answer disputes and takedown requests.
39. As the FindYourDent team, I want negative and positive Testimonies judged by exactly the same rules, so that the platform does not silently filter complaints.
40. As the FindYourDent team, I want a negative mention that names a person always held for us, so that we manage defamation risk without silencing complaints about the clinic.
41. As the FindYourDent team, I want a place to become a Listed Provider when its first Testimony is published, so that the directory grows without manual seeding.
42. As the FindYourDent team, I want Testimony posting limited to five per account per day, so that bulk fake posting is hard.

## Implementation Decisions

- Provider picker: Places Autocomplete (New) through the web service, restricted to Indonesia, limited to dentist and hospital place types, biased to the Patient's location only if they share it, using session tokens; the selection stores the `placeId` from the chosen suggestion, with no Place Details call (an IDs-only call is free but does not change Autocomplete billing, and it would use the shared Place Details quota). Requests wait for a 300 ms typing pause and at least 3 characters, so the 300-a-day Autocomplete cap covers enough picks. Google's names appear only in the live suggestion list.
- Name and Region (ADR-0005): if the `place_id` is not yet a Listed Provider, the form shows an empty "Nama tempat sesuai papan nama atau yang kamu kenal" field after the picker closes, never pre-filled and never showing Google's name as text to copy. Province and kota/kabupaten are required and kecamatan optional, from the Kemendagri region code list shipped with the app. If the Provider is already Listed, its stored name and Region are shown read-only with a "Sarankan koreksi" link that creates an admin task.
- Testimony fields: Provider `place_id`; three aspect ratings 1 to 5 (service, hygiene, materials and equipment); text (no product limit, technical cap 10,000 characters); visit month and year; optional procedure (shared procedure list with specs 01 and 05); optional price paid in rupiah; up to four photos; optional Proof of Visit (one image or PDF); public display name (default: first name plus initial); consent flags; author account id (never shown).
- Testimony states: `submitted` (moderation running) → `published`, `needsAuthorFix` (author sees flagged spans and edits), or `held` (admin decides). From `held`: `published` or `rejected` (with reason). A `published` Testimony can become `hidden` (report for personal data or threats; admin decides `published` or `removed`) or `removed` (admin only). The author can move any state to `deleted`, which removes text and photos permanently. Editing a `published` Testimony re-enters `submitted`, and the previous version stays public until the new one is decided.
- Moderation endpoint in the agent service, called by the web service on submit. Model: Gemini 3.5 Flash-Lite, structured output, no `temperature` (ignored from this model on, #69). The Testimony is passed as data; instructions inside it are ignored. Input also includes the Provider's live Google display name (fetched by the web service, held in memory only) and the typed name.
- Moderation output: `decision` (`publish`, `authorFix` or `hold`), the rule codes, the exact flagged spans, a confidence value, and a short author-facing message in the author's language. Model errors, timeouts or invalid output always become `hold`.
- Text rules (any hit means not `publish`):
  - R1 personal data (phone numbers, emails, addresses, ID or medical-record numbers, full names of other patients or staff) → `authorFix`.
  - R2 accusation stated as fact (fraud, malpractice, crime) → `hold`.
  - R3 hate speech, SARA, harassment, threats, profanity → `hold`.
  - R4 not a first-hand visit (hearsay, advertising, links, promo codes, spam, review-for-discount) → `authorFix`.
  - R5 medical advice to readers (medicine with dose, "no need to see a dentist") → `authorFix`.
  - R6 wrong Provider (text about another place, or typed name clearly not the picked place) → `authorFix`.
  - R7 conflict of interest (owner or staff voice, competitor attack) → `hold`.
  - R8 someone else's health data → `hold`; the author's own health details produce only a gentle warning.
  - R9 manipulation (instructions to the AI, gibberish) → `hold`.
  - A negative statement naming a person (a dentist or staff member) → `hold`. Neutral or positive mentions of a dentist's name pass.
- Photo rules: only the clinic setting (waiting room, treatment room, equipment, signboard). Faces or people, intraoral or clinical images, documents, receipts or screenshots, explicit or violent images, and images that look copied (another site's watermark) cause `hold`. Location metadata (EXIF) is stripped server-side before storage.
- Proof of Visit (amended by spec 07): stored in a private bucket and read in the same Moderation call, which extracts the clinic name, date and total; the web service accepts it only when the name matches the Provider, the date is within one month of the stated visit month and under 12 months old, and no other Testimony for the place has the same Proof Fingerprint. Doubtful proofs wait for an admin (file kept at most 7 days); accepted and rejected files are deleted at once. A proof never holds the Testimony; it only grants or withholds "Kunjungan terbukti", and only Proven Testimonies count toward scores and prices. Proof can also be attached to a published Testimony later.
- Neutrality: sentiment and star ratings are never inputs to the decision; the prompt says so and the moderation tests check it.
- Author fix loop: for `authorFix`, the web service returns the spans and messages to the author before anything is stored as submitted; the author edits and resubmits. After three `authorFix` rounds, the Testimony is held instead.
- Listed Provider creation: when a Testimony for a non-Listed `place_id` is first published, the web service creates the Listed Provider with the typed name, Region, the Testimony's aggregates, and coordinates from an Essentials Place Details call.
- Reports: anyone can report with a category (personal data, threat, false claim, spam, conflict of interest, other). Personal data and threat reports set `hidden` immediately. All reports go to the admin queue with a 24-hour target.
- Provider replies: one public reply per Testimony from the claimed Provider (spec 05), screened by the same Moderation rules.
- Admin queue (allowlisted accounts only): held Testimonies, reports, name corrections, the 10% spot-check sample, and Claims (spec 05). Each item shows the content, Gemini's rule codes and spans, and the history. Actions: publish, reject with a reason, send back to the author, hide, remove. Every action is recorded in `adminActions`.
- Aggregates (per Provider aspect averages, counts, Kunjungan terbukti count, procedure prices) are recomputed whenever a Testimony enters or leaves `published` or its proof result changes. Averages and procedure prices use Proven Testimonies only, and averages are shown from three Proven Testimonies (spec 07).
- Rate limits: five Testimony submissions per account per day, plus spec 00's App Check and session limits on the picker and submit routes.

## Testing Decisions

- Seams: the web service HTTP API against the Firebase emulators with the Moderation endpoint and Places adapter faked; the agent service Moderation contract with Gemini faked.
- Web API tests: the full state machine (each transition, including author delete from every state and the rule that only admins remove); `authorFix` returns spans without creating a submitted record; Proof of Visit file is gone from storage after the check whatever the result; EXIF is stripped from stored photos; a second Testimony by the same account for the same `place_id` is refused; the first published Testimony creates exactly one Listed Provider with the typed name; Firestore never stores Google's name; reports for personal data hide immediately; non-admins cannot call admin actions; aggregates change on publish and on removal.
- Moderation contract tests: a fake model error or invalid output returns `hold`; the output always validates against the schema; a request containing instructions to the model is still treated as a Testimony.
- Real-model Moderation quality, including sentiment-pair neutrality, is measured in spec 06.
- End-to-end (deployed preview): post a Testimony with a phone number, fix it, publish; an admin reviews a held Testimony.
- Prior art: spec 00 and 02 API tests.

## Out of Scope

- Copying, importing or seeding Google reviews (prohibited by Google's terms, ADR-0005).
- Testimonies written by the team or invented; the 30 real Testimonies are recruited from real Patients in spec 06.
- Phone, WhatsApp or email verification of authors, now and later (ADR-0011).
- Video uploads.
- Public display of Proof of Visit documents.
- Automatic removal of anything published.

## Further Notes

- Decisions recorded in ADR-0002 (Providers cannot delete; authors can), ADR-0004 (Gemini may publish; humans hold-decide and remove) and ADR-0011 (only Proven Testimonies count; Google sign-in only).
- Spec 07 adds Proven Testimonies, Proof Fingerprints, buzzer detection and Testimony Policy Violations; where it differs from this spec, spec 07 wins.
- Takedown duty: the admin queue and `adminActions` log are the process for Permenkominfo 5/2020 requests; the 24-hour target applies to all reports.

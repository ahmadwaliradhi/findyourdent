---
title: "Spec 05: Claim and Price List"
labels: [ready-for-agent]
owner: B (web) for the Claim flow and admin, A (agent) for Price List extraction
depends_on: ["00", "02", "03"]
cut_order: first to cut (Price List first, then Claim)
---

# Spec 05: Claim and Price List

## Problem Statement

Dentists and clinics have no trusted, ethical way to show the public who they are and what they charge (problems B1 and C1). Promotion is restricted for Indonesian dentists (MKEK Fatwa 29/2021 and the PDGI dental code of ethics, KODEKGI 2020), so "branding" tools that advertise or boost them are off the table. What they can do ethically is keep their facts correct, publish their price list, and respond professionally to Patients. For Patients, a Provider's own price list is the clearest affordability signal there is, and Providers already have one as a PDF, a brochure or a photo.

## Solution

A dentist or clinic owner finds their Provider page, taps "Klaim halaman ini", signs in with Google, and uploads their practice permit (SIP or izin praktik). The FindYourDent team checks the document and calls the phone number on the Provider's Google listing to confirm. Once approved, the page shows "Diklaim pemilik", and the owner can enter their own facts, reply to Testimonies, and upload their price list as a PDF or photo. Gemini reads the price list into rows (procedure, minimum and maximum price, unit, notes), the owner checks and corrects them, and the prices appear on the page and in Shortlist price signals with their source and date. There is no promotion, no paid ranking, and no way to remove Testimonies.

## User Stories

1. As a dentist or clinic owner, I want to claim my Provider page, so that the facts about my practice are correct.
2. As a claimant, I want to sign in with my Google account, so that I do not create another password.
3. As a claimant, I want to upload my SIP or practice permit privately, so that FindYourDent can confirm I am the owner.
4. As a claimant, I want to know how long the check takes and what happens next, so that I am not left waiting.
5. As a claimant, I want to be told why a Claim was rejected, so that I can fix it.
6. As a claimant, I want my permit document deleted after the decision, so that it is not kept.
7. As a Patient, I want to see "Diklaim pemilik" on claimed pages, so that I know the owner maintains the facts.
8. As a claimed Provider, I want to set my practice name, type (Klinik, Private Dentist or Hospital), address, Region, phone, WhatsApp, opening hours and services, so that Patients see accurate information.
9. As a claimed Provider, I want my own facts to replace the first Testimony author's typed name and the inferred type, so that the page reflects the owner's information.
10. As a claimed Provider, I want to reply once, publicly, to each Testimony, so that I can respond professionally.
11. As a claimed Provider, I want to report a Testimony I believe is false, so that the team reviews it.
12. As a claimed Provider, I want to upload my price list as a PDF or photo, so that I do not retype it.
13. As a claimed Provider, I want to see the rows Gemini read, with low-confidence rows highlighted, so that I can correct mistakes.
14. As a claimed Provider, I want to edit, add or delete rows before confirming, so that the published prices are right.
15. As a claimed Provider, I want each published price to show the date I confirmed it, so that Patients know it is current.
16. As a claimed Provider, I want to replace my price list when prices change, so that old prices disappear.
17. As a Patient, I want to see a Provider's own prices for my likely procedure, labelled with the source and date, so that I can judge affordability.
18. As a Patient, I want price lists that are more than 12 months old marked as possibly outdated, so that I am not misled.
19. As the FindYourDent team, I want to review Claims in the admin queue with the document and the Provider's Google listing phone number, so that I can verify by phone.
20. As the FindYourDent team, I want to revoke a Claim, so that I can fix a wrong approval.
21. As the FindYourDent team, I want promotional wording ("terbaik", "termurah", discounts, testimonials of their own) in owner-entered facts and replies to be held for review, so that the platform does not become a tool for breaching the dental code of ethics.
22. As the FindYourDent team, I want a Claim to make a non-Listed Provider a Listed Provider, so that claimed Providers appear in the directory.
23. As a Patient, I want claimed Providers to rank exactly as they would unclaimed, so that I can trust the Shortlist.

## Implementation Decisions

- Claim flow: from a Provider page, a signed-in user submits a Claim with their role (owner, practising dentist, manager), a contact phone, and one permit document (image or PDF) to a private bucket. One active Claim per `place_id`.
- Claim states: `submitted` → `approved` or `rejected` (with a reason); `approved` → `revoked`. The permit document is deleted when the Claim leaves `submitted`; only the decision, the reviewer and the date are kept.
- Verification is manual: the admin queue shows the document and the Provider's live Google phone number (fetched for the reviewer through the Places adapter, not stored), the admin calls to confirm, then approves or rejects.
- Owner-entered facts are first-party data and are stored on the Listed Provider; they take precedence over the first Testimony author's name and the inferred type. They are screened with the Moderation endpoint using a Provider-facts rule set (personal data of patients, promotional claims, misleading statements) and held for the admin on any hit.
- Replies: one per Testimony, editable, screened with the same Moderation rules plus the promotional-wording rule.
- Price List extraction: an extraction endpoint in the agent service using Gemini 3.5 Flash-Lite with structured output. Input: one PDF or up to five images. Output rows: procedure (mapped to the shared procedure list where possible, otherwise free text), minimum price, maximum price (equal for a fixed price), unit (per tooth, per jaw, per visit, per package), notes, and a confidence per row. If extraction quality is poor in testing, switch this endpoint to Gemini 3.8 Flash.
- Review and confirm: the owner sees the rows next to the original document, edits them, and confirms. Only confirmed rows are stored, each with source "Daftar harga dari pemilik", the upload date and the confirmation date. The original document is kept privately for 30 days for disputes, then deleted.
- Prices feed spec 02's price signals (second in priority after prices paid from Testimonies) and the Provider page. Lists older than 12 months show an "mungkin sudah berubah" note.
- Ranking: Claim status has no effect on rank (spec 02).
- Ethics constraints for every dentist-facing feature: no promotion tools, no sponsored placement, no discounts or offers, no badges other than "Diklaim pemilik", no ability to remove or hide Testimonies.

## Testing Decisions

- Seams: the web service HTTP API against the Firebase emulators with the Places adapter and agent endpoints faked; the agent extraction contract with Gemini faked.
- Web API tests: the Claim state machine; the permit document is deleted on approve and on reject; only allowlisted admins can approve; a claimed Provider's facts replace the typed name and inferred type; a claimed Provider cannot delete or hide a Testimony through any route; one reply per Testimony; a Claim on a non-Listed `place_id` creates a Listed Provider; claimed and unclaimed Providers with identical data rank identically.
- Extraction contract tests: output validates against the schema; invalid or failed extraction returns an empty result with a retry message, never partial unvalidated rows.
- Prior art: specs 02 and 03 API tests.

## Out of Scope

- Patient management, appointment and marketing tools for clinics (problem B2/C2, after the hackathon).
- Clinical AI tools for dentists such as orthodontic progress prediction or radiograph interpretation (problem B3/C3, after the hackathon).
- Registry verification of STR or facility codes (dropped by decision; the Claim check is the permit document and the phone call).
- Paid plans, subscriptions and any form of promotion.

## Further Notes

- Cut order: if time is short, drop Price List first (Patients still get prices from Testimonies and Cost Estimates), then Claim (Providers then exist only through Testimonies).
- The admin calls the phone number on the Google listing because a claimant could otherwise supply their own number; the call is the ownership check.

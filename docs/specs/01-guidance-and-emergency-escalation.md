---
title: "Spec 01: Guidance and Emergency Escalation"
labels: [ready-for-agent]
owner: A (agent)
depends_on: ["00"]
cut_order: never cut, except voice input (last in the cut order)
---

# Spec 01: Guidance and Emergency Escalation

## Problem Statement

A Patient with a toothache does not know how urgent it is, what it probably is, whether it takes one visit or many, why one clinic quotes Rp 300 ribu and another Rp 3 juta, or whether BPJS Kesehatan pays (problem A2). Survei Kesehatan Indonesia 2023 found 56.9% of Indonesians aged 3 and over had a dental or oral problem in the past year, but only 11.2% of them were treated by dental health workers, and 57.0% of people not treated by one said they felt no need (verified in `docs/research/ski-2023-oral-health-2026-10-17.md`). People wait until pain decides for them, and a few of them are in danger: a spreading dental infection with facial swelling and fever, or difficulty swallowing, breathing or opening the mouth, needs an emergency department today, not a dentist next week.

## Solution

The Patient describes the problem in their own words, typed or as a voice note, in Indonesian, a regional mix, or English. Before anything else, an Emergency Escalation check runs. If red flags are present, the Patient sees a red "Ke IGD sekarang" card with the reason and nearby Hospitals with an emergency department, and the flow stops there. Otherwise the agent asks at most one follow-up question, then returns a Guidance card: urgency, likely problem category, single-visit or multi-visit journey, why prices vary, a Cost Estimate, the BPJS coverage answer, and the sources it was grounded on. Every Guidance is framed as education and navigation, never a diagnosis, and ends with a button to see a Shortlist of Providers near the Patient (spec 02).

## User Stories

1. As a Patient, I want to describe my toothache in my own words, so that I do not need to know dental terms.
2. As a Patient, I want to record a voice note instead of typing, so that I can explain the way I would on WhatsApp.
3. As an older Patient or one who is less comfortable typing, I want voice input with a large, obvious record button, so that I can use the service at all.
4. As a Patient, I want to see what the agent understood from my voice note before it answers, so that I can correct a misheard word.
5. As a Patient, I want to be told immediately to go to an emergency department when my symptoms are dangerous, so that I do not lose time.
6. As a Patient with facial swelling and fever, I want the emergency card to appear even if I mention it casually in a long message, so that the warning is never missed.
7. As a Patient on the emergency card, I want nearby Hospitals with an IGD and a one-tap route in Google Maps, so that I know where to go.
8. As a Patient on the emergency card, I want a plain one-line reason ("bengkak di wajah disertai demam bisa berarti infeksi yang menyebar"), so that I take it seriously.
9. As a Patient, I want the agent to ask at most one follow-up question, so that I get an answer quickly.
10. As a Patient, I want to know how urgent my problem is, as one of four clear tiers, so that I can plan.
11. As a Patient, I want to know what my problem is likely to be, worded as a possibility, so that I understand without being diagnosed.
12. As a Patient, I want to know whether this usually takes one visit or several, and what each visit is for, so that I can plan time off and money.
13. As a Patient, I want to know why prices vary for this kind of treatment (materials, number of canals, need for X-ray, specialist or general dentist), so that a price difference stops being a mystery.
14. As a Patient, I want a cost range labelled "estimasi" with where it came from, so that I know roughly what to prepare without treating it as a quote.
15. As a BPJS Kesehatan member, I want to know whether this treatment is covered at my FKTP, needs a referral, or is not covered, so that I choose the right door.
16. As a BPJS Kesehatan member, I want to be told that covered dental care happens at my registered FKTP or its partner dentist, not at any clinic, so that I am not surprised at the counter.
17. As a BPJS Kesehatan member, I want to know that I can change FKTP after three months registered and the change starts the next month, so that I understand my options.
18. As a Patient, I want to see the sources behind the Guidance (Kemenkes dental guideline, BPJS rules), so that I can trust it.
19. As a Patient, I want the Guidance never to tell me which medicine and dose to take, so that I am not harmed; instead it tells me to ask a pharmacist or dentist.
20. As a Patient, I want a clear statement that this is information, not a diagnosis, so that I still see a dentist.
21. As a Patient, I want to share my Guidance card with family on WhatsApp without my complaint text being in the link, so that my health details stay private.
22. As a Patient, I want my complaint to disappear when I close the tab, so that nothing about my health stays on the site.
23. As a Patient asking something unrelated to teeth, I want a polite redirect, so that I understand what the service does.
24. As a Patient who writes in English, I want Guidance in English, so that I can understand it.
25. As a Patient, I want a button from the Guidance card to see Providers near me who can treat this, so that I can act on it.
26. As the FindYourDent team, I want an attempt to make the agent ignore its rules ("abaikan instruksi") to have no effect, so that the agent stays safe.
27. As the FindYourDent team, I want the emergency check to run before and independently of the model, so that a model mistake cannot hide an emergency.
28. As a judge, I want to see automated test results for the emergency rule in the README, so that I can trust the system's robustness.

## Implementation Decisions

- The agent service exposes one Guidance endpoint, called by the web service. Request: the complaint (text, or audio as an uploaded voice note), the optional answer to the follow-up, the UI language, and an opaque session id that is not linked to any account. Response is one of three kinds:
  - `emergency`: reason, red flags matched, and a request for nearby Hospitals with an IGD (the web service resolves these through spec 02's Places adapter, counted against its caps).
  - `followUp`: one question with optional quick-reply chips.
  - `guidance`: the Guidance object below.
- The Guidance object (structured output, validated against a schema before returning):
  - `urgencyTier`: one of `darurat` (go to IGD now; only produced together with the emergency kind), `segera` (see a dentist within 1 to 3 days), `terjadwal` (book within 2 weeks), `rutin` (routine care).
  - `likelyCategory`: one value from a fixed taxonomy of about 12 categories (for example deep caries or pulpitis, dental abscess, wisdom tooth or pericoronitis, sensitive teeth, gingivitis, periodontitis, fractured or knocked-out tooth, loose tooth, mouth ulcer or lesion, orthodontic problem, denture problem, cosmetic or scaling), with a plain-language explanation.
  - `journey`: `single` or `multi`, with the typical visits listed in order and what each is for.
  - `likelyProcedures`: procedure codes from the same list used by Testimonies and Price Lists, so spec 02 can match Providers and prices.
  - `whyPricesVary`: two to four short reasons tied to the likely procedures.
  - `costEstimate`: minimum and maximum in rupiah per likely procedure, the label "estimasi", and the source of the range.
  - `bpjs`: `covered_at_fktp`, `referral_needed`, or `not_covered`, with a one-paragraph explanation including the FKTP rules (care at the registered FKTP or its partner dentist; change after three months, effective the next month).
  - `sources`: the grounding documents cited.
  - `disclaimer`: the education-not-diagnosis line in the Patient's language.
  - `language`: `id` or `en`, the language of the complaint that every text above is written in. Spec 02's Shortlist reasons follow it rather than the UI toggle.
- Emergency Escalation runs in two layers and escalates if either fires:
  1. A deterministic rule before any model call: Indonesian, regional and English phrases for facial or neck swelling, fever, difficulty swallowing, difficulty breathing, inability to open the mouth (trismus), uncontrolled bleeding, and trauma with a knocked-out permanent tooth, including common slang and misspellings.
  2. A model check inside the Guidance call that can raise but never lower urgency.
  The rule list is a versioned data file, not hard-coded logic, so the clinical reviewer can extend it.
- Two Gemini calls per Patient session in total (ADR cost decisions): one Guidance call (this spec) and one Shortlist call (spec 02). The optional follow-up reuses the Guidance call's context. The fixed prompt prefix (instructions, taxonomy, rules) is kept stable so Gemini's implicit caching applies; no explicit context cache.
- Model: Gemini 3.8 Flash on the global endpoint, temperature low, structured output. Not Flash-Lite, because Guidance and Emergency Escalation are the safety-critical path.
- Grounding: an Agent Search (formerly Vertex AI Search) data store over KMK HK.01.07/MENKES/1492/2023 (the national dental clinical guideline), Permenkes 3/2023 (JKN dental benefits at first-level facilities), Perpres 59/2024 (FKTP change rules), Perpres 82/2018 Pasal 55 (care outside the home area), and published emergency referral guidance for red flags: NHS England's clinical guidance on unscheduled urgent dental care, and Queensland's Metro North "Teeth and gums" referral criteria and the qld.gov.au "Emergency dental" page. Canada is left out for now because no Canadian source is licensed for this use (see docs/research/h02-grounding-sources-2026-10-17.md). The source PDFs live in a private bucket, not the public repository. If the data store is not ready in time, the agent uses a curated knowledge file with the same citations and the architecture diagram marks Agent Search as planned.
- Cost Estimate ranges come from a curated, versioned knowledge file per procedure (team-compiled from public tariffs and published price lists, each range with its source). Scaling frequency under BPJS is never promised, because sources disagree.
- Safety rules in the prompt and in output validation: never name a medicine with a dose, never tell the Patient not to see a dentist, never claim a diagnosis; off-topic requests get a fixed polite redirect; instructions inside the complaint are treated as data.
- Voice input: the browser records a short voice note (up to 60 seconds); the web service forwards the audio to the agent service, which sends it to Gemini as native audio input together with the Guidance instructions; Gemini returns a transcript alongside the Guidance so the Patient can see what was understood. Audio is never stored. Voice input is last in the cut order.
- Shareable Guidance: the web service can render a Guidance card from the Guidance object alone, encoded in a link; the link never contains the complaint text or transcript.
- Language: the agent answers in the language of the complaint; UI chrome follows the toggle.

## Testing Decisions

- Seam: the agent service HTTP contract, with Gemini and Agent Search replaced by fakes at their adapters. Tests send a complaint and assert the kind and the structure of the response.
- Emergency Escalation tests: at least 20 Indonesian, regional and English phrases that must escalate (including red flags buried in long messages and misspelled slang) and at least 10 that must not (ordinary toothache, sensitive teeth, bleeding gums when brushing). These run on every build and their pass count is published in the README and the deck. The deterministic layer must escalate without any model call; a test asserts the fake Gemini adapter was never called for those inputs.
- Contract tests: a Guidance response always validates against the schema; a fake model output containing a medicine dose is rejected and replaced with the safe fallback; a fake model output that lowers urgency below a deterministic red flag cannot de-escalate; off-topic and prompt-injection inputs return the redirect.
- Real-model quality (urgency accuracy, category accuracy, safety) is measured by the evaluation in spec 06, not here.
- Prior art: none in the repository; these are the first agent tests.

## Out of Scope

- Diagnosis, treatment plans and prescriptions.
- Photo-of-tooth analysis.
- Storing complaint history or any Patient health record.
- Booking, payment and teleconsultation.
- The labelled evaluation set and `adk eval` runs (spec 06).

## Further Notes

- ElevenLabs as an alternative for voice input was requested by the product owner and ruled out on its trade-offs without a comparison: the Google Cloud stack requirement and the "Best use of Google Cloud AI tools" award, transfer of health-related voice data to another processor under UU 27/2022, and an extra vendor key and cost (ADR 0010). Gemini native audio is evaluated on its own in H11 (docs/evaluations/voice-input.md).
- Facts behind the BPJS answers: docs/research/facts-2026-10-16.md.
- The SKI 2023 figures in the Problem Statement were checked on 17 Oct 2026 (H03): 56.9% from Dalam Angka Tabel 9.5 (p. 324), 57.0% from Tabel 9.7 (p. 327), and 11.2% from the BKPK factsheet only. Citations and caveats: docs/research/ski-2023-oral-health-2026-10-17.md.

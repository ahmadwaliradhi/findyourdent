---
title: "Spec 06: Post-deployment evaluation and first real Testimonies"
labels: [ready-for-human]
owner: product owner (starts it), A (agent) for the eval tooling
depends_on: ["01", "02", "03"]
cut_order: not part of the submission build; started by the product owner after deployment
---

# Spec 06: Post-deployment evaluation and first real Testimonies

## Problem Statement

Guidance is clinical-adjacent and Moderation decides what is said publicly about named health professionals. Neither can be trusted on demo runs alone: a missed emergency, a wrong urgency tier, unsafe medicine advice, or Moderation that quietly suppresses complaints would each cause real harm. The platform also launches with an empty Testimony feed, and its value to Patients (problem A1) depends on real Testimonies from real Patients. The product owner decided both are done after deployment, when they choose to start them.

## Solution

When the product owner starts it, three pieces of work run during the judging window: a labelled evaluation of Guidance and Emergency Escalation with clear pass gates, a labelled evaluation of Moderation that includes a neutrality check, and the recruitment of 30 real Testimonies from Patients across Indonesia. Results go into the README and an updated deck, with every number honest about who labelled what.

## User Stories

1. As the product owner, I want this work to start only when I decide, so that the build is not delayed.
2. As the product owner, I want an evaluation set of 40 Indonesian-language Patient messages, including 8 emergencies and 5 off-topic or adversarial cases, so that Guidance is tested on realistic input.
3. As the product owner, I want each case labelled from cited clinical and official sources (urgency tier, likely category, journey, BPJS, emergency yes or no), with every label traceable to the clause it comes from and stated honestly as source-derived and agent-labelled, so that an agent can build the evaluation and the ground truth can be checked; review by a licensed dentist outside the team is an optional follow-up that upgrades the labeller line.
4. As the product owner, I want to run the evaluation with `adk eval` (tool trajectory, response match, and an LLM judge) and Gemini Enterprise Agent Platform's Gen AI evaluation for safety, so that results use Google Cloud tooling.
5. As the product owner, I want pass gates of 100% emergency recall, at least 85% urgency-tier accuracy and zero unsafe medicine advice, so that "good enough" is defined before I see the numbers.
6. As the product owner, I want 10 of the 40 cases held out and never used for prompt tuning, so that the reported numbers are not overfitted.
7. As the product owner, I want a Moderation evaluation set of 30 Testimonies covering clean cases, each rule R1 to R9, photo cases, and pairs of the same text written with negative and positive sentiment, so that I can prove Moderation is accurate and neutral.
8. As the product owner, I want the Moderation evaluation re-run before every Moderation prompt change, so that changes do not regress.
9. As the product owner, I want a results table in the README and the deck that says exactly who labelled the data, so that judges can trust it.
10. As the product owner, I want to recruit 30 real Testimonies from people in my network across Indonesia about their own past dental visits, so that the feed shows real experiences.
11. As the product owner, I want a short message and instructions I can send on WhatsApp, so that recruiting is quick.
12. As the product owner, I want to be sure no Testimony is written by the team or invented, so that the platform stays honest and legal.
13. As the product owner, I want a short evaluation of Gemini native audio on a handful of Indonesian voice notes with dental terms, so that I know whether it hears Patients well enough and whether a dental term list helps.
14. As a judge, I want to see these results update during the judging window, so that I see the product being validated.

## Implementation Decisions

- Agent evaluation:
  - Evalset of 40 cases in the ADK evalset format: 8 emergencies, 5 adversarial or off-topic, 27 ordinary across the category taxonomy; cases and labels derived from cited sources in `docs/research/indonesia-dental-use-cases-2026-10-17.md`, labels marked source-derived and agent-labelled, with doubtful labels flagged needs-dentist-review. An external licensed dentist's review is optional and, when done, bumps the evalset version.
  - Metrics: emergency recall (escalation fired), urgency-tier accuracy, category accuracy, journey accuracy, unsafe medicine advice count (LLM judge plus manual review of every flagged output), BPJS answer correctness on cases where coverage is clear.
  - Tooling: `adk eval` against the deployed agent service; Gemini Enterprise Agent Platform Gen AI evaluation for safety metrics.
  - Gates: emergency recall 100%, urgency-tier accuracy at least 85%, unsafe medicine advice 0. A failed gate is reported as failed, never hidden.
  - 10 held-out cases are run only for the final reported numbers.
- Moderation evaluation:
  - 30 cases: 8 clean, at least one per rule R1 to R9, 4 photo cases, and 4 sentiment pairs (identical facts, one negative and one positive) that must receive the same decision.
  - Labels from the team, stated as team-labelled.
  - Metrics: decision accuracy, false-publish count (a rule-breaking Testimony published), neutrality (pairs with different decisions).
- Real Testimonies:
  - Target 30 published Testimonies from real Patients in several cities, recruited through the product owner's network over WhatsApp, each written by the Patient themselves through the normal posting journey.
  - No Testimony is written, edited or invented by the team; no incentives that depend on the Testimony being positive.
- Voice evaluation: 10 short Indonesian voice notes recorded by the team, transcribed by Gemini native audio through the production Guidance call, with and without the dental term list in the Guidance instruction; compare dental term recall, WER and the Emergency Escalation result (docs/evaluations/voice-input.md). ElevenLabs is out of scope (ADR 0010).
- Results: a results table in the README and the deck, with the date, model version, labeller and pass or fail for each gate.

## Testing Decisions

- This spec produces evaluations rather than code paths; the evaluation runners themselves are scripts checked into the repository, and their output files are committed with the date and model version.
- A good evaluation result is reproducible: rerunning the runner on the same evalset and model version gives the same pass or fail per gate.
- Prior art: spec 01's emergency tests, which remain the always-on regression check.

## Out of Scope

- Anything that delays the submission build.
- Paying for Testimonies or offering rewards tied to their content.
- Seeding Testimonies from Google reviews or any other source.

## Further Notes

- The optional external dentist review and the voice-note recordings require human effort; nothing in this spec should be started by an agent without the product owner's go-ahead.

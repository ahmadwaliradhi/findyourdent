---
title: "Spec 00: Platform foundation"
labels: [ready-for-agent]
owner: B (web) with A (agent service)
depends_on: []
cut_order: never cut
---

# Spec 00: Platform foundation

## Problem Statement

Every FindYourDent feature (Guidance, Shortlist, Testimonies, the feed, Claims) needs the same base: a fast, mobile-first web app that Indonesian Patients can use on a low-end Android phone over mobile data, a separate agent service, Google sign-in, protection against bots that would run up Google Places and Gemini bills, privacy handling for symptom text under UU 27/2022, and a deployment that stays up through the judging window (19 October to 7 November 2026). Without this base, each feature would solve these concerns differently, and one bot crawl or one leaked log could end the project.

## Solution

A Patient opens findyourdent.com (until the domain is bought, the default Firebase Hosting or Cloud Run URL) and gets a fast, mobile-first, Indonesian-first web app with an English toggle, a one-line consent notice before sharing any symptom, and Google sign-in only when they post a Testimony or make a Claim. Behind it, two Cloud Run services (web and agent) run in Jakarta, data stays in Jakarta, Gemini is called on the global endpoint with that disclosed, Google keys never reach the browser, and bots are stopped by App Check, rate limits and hard daily caps on every paid API before they can cost money.

## User Stories

1. As a Patient, I want the site to open in Bahasa Indonesia by default, so that I can read it without effort.
2. As a judge or foreign visitor, I want an English toggle that is visible on every page, so that I can follow the product.
3. As a Patient who writes in English, I want the agent to answer in the language I wrote in, so that the toggle and my message never conflict.
4. As a Patient on a low-end Android phone with a slow connection, I want pages to load quickly, so that I do not give up.
5. As a Patient on a phone, I want every screen designed for a small touch screen first, so that the site is easy to use even though I only visit it occasionally.
6. As a Patient, I want to see a short consent notice ("informasi edukasi, bukan diagnosis") before I describe my symptoms, so that I know what the service is and is not.
7. As a Patient, I want to know that my complaint text is not stored and is processed by Google AI outside Indonesia, so that I can decide whether to share it.
8. As a Patient, I want to read everything public without creating an account, so that I can try the service immediately.
9. As a Patient, I want to sign in with one tap using my Google account only when I post, so that I am not blocked by a registration form.
10. As a Patient, I want no email or phone verification step after Google sign-in, so that posting stays quick.
11. As a Patient, I want a friendly error page with a retry when something fails, so that I am not stuck.
12. As a Patient behind a shared mobile carrier IP address, I want rate limits that do not block me because of other people on the same network, so that the site keeps working.
13. As the FindYourDent team, I want only our two Google accounts to reach the admin area, so that nobody else can moderate or approve Claims.
14. As the FindYourDent team, I want automated traffic without a valid App Check token to be refused before any Google Places or Gemini call, so that bots cost nothing.
15. As the FindYourDent team, I want per-App-Check-token and per-session rate limits plus a high per-IP ceiling, so that abuse is throttled without hurting real Patients.
16. As the FindYourDent team, I want daily quota caps on every Places method and on Gemini, so that the worst case is a hard stop, not a bill.
17. As the FindYourDent team, I want a budget alert at USD 100 with warnings at 50% and 90%, so that I see spending early.
18. As the FindYourDent team, I want complaint text, voice notes and Testimony drafts never written to logs, so that we meet UU 27/2022 data minimisation.
19. As the FindYourDent team, I want structured logs and an uptime check on both services, so that I know when the demo is down during judging.
20. As the FindYourDent team, I want one agent instance kept warm from 19 October to 7 November, so that judges never wait for a cold start.
21. As the FindYourDent team, I want the web service to scale to zero outside judging, so that idle cost stays near zero.
22. As a developer, I want one command to deploy each service, so that fixes during judging are quick and repeatable.
23. As a developer, I want secrets (Places key, App Check keys, service accounts) in Secret Manager and never in the repository, so that the public repository leaks nothing.
24. As a developer, I want Firebase emulators for Firestore, Auth and Storage, so that I can test locally without cost.
25. As a judge, I want the public repository to contain only code written during the hackathon and no third-party content, so that the entry is eligible.
26. As a developer, I want the custom domain to be attachable later without code changes, so that buying findyourdent.com is a configuration step.

## Implementation Decisions

- Two services on Cloud Run in `asia-southeast2` (Jakarta): the web app (React Router v7 in framework mode, TypeScript, server-rendered, mobile-first responsive; not a PWA, see ADR-0006) and the agent service (Python, Google ADK). Firestore (default database, so the free quota applies), Cloud Storage and Artifact Registry also in Jakarta.
- The web service is the only public entry point and acts as the backend for the browser. The browser never calls the agent service, Places or Gemini directly; all calls go through the web service API, which holds the Places key server-side. The agent service accepts only authenticated service-to-service calls from the web service.
- Gemini runs on the global endpoint (ADR-0003): Gemini 3.8 Flash for Guidance and Shortlist reasons, Gemini 3.5 Flash-Lite for Moderation and document extraction. Model names live in configuration so they can change without code changes.
- Firebase Hosting fronts the web service for HTTPS and the custom domain. First task: confirm that Firebase Hosting rewrites support a Cloud Run service in `asia-southeast2`. If they do not, fall back to a global external Application Load Balancer (about USD 13.80 for the window) or move only the web service to `asia-southeast1`; record the choice in an ADR.
- Authentication: Firebase Authentication with the Google provider only. No email verification, no phone OTP. Admin access is an allowlist of two email addresses held in configuration.
- Bot protection: Firebase App Check with reCAPTCHA Enterprise (score-based, no puzzle) on every web API route that can trigger Places, Gemini or a write. Requests without a valid token are refused before any paid call.
- Rate limits, enforced in the web service and stored in Firestore with time-window counters: per App Check token and per session for each paid route (default 30 Places-backed requests per hour, 10 Guidance sessions per hour), per signed-in user for writes (5 Testimonies per day), and a high per-IP ceiling (300 requests per hour) because Indonesian mobile carriers share IP addresses.
- Daily quota caps are set in the Google Cloud console per Places method and per Gemini model, sized to the USD 10 per month Places budget in ADR-0005 (spec 02 lists them). The budget alert is USD 100 for the whole account with 50% and 90% notifications.
- Privacy: complaint text and voice notes are processed in memory only and never persisted or logged; request bodies are excluded from Cloud Logging on both services. The consent notice and privacy page state the purpose (education and navigation, not diagnosis), that text is processed by Google AI on the global endpoint, that it is not stored, and how to contact the team.
- Internationalisation: Indonesian default, English toggle remembered per browser; every UI string in both languages from day one.
- Firestore data model (top-level collections, field names indicative):
  - `providers`: keyed by `place_id`; first-party name and its source, Region codes, coordinates with the date fetched, Provider type with its source (inferred or claimed), Claim status, Testimony aggregates, timestamps. Never holds Google fields other than `place_id` and coordinates.
  - `testimonies`, `testimonyReports`, `claims`, `priceLists`, `moderationDecisions`, `nameCorrections` ("Sarankan koreksi" suggestions on a Listed Provider's name or Region, spec 03), `adminActions`, `counters`, `rateLimits`.
- Observability: structured logs with request IDs and outcome codes only; Cloud Monitoring uptime checks on both services; an alert when either service returns errors for five minutes.
- Warm instance: the agent service has a minimum of one instance from 19 October to 7 November 2026 (request-based billing), zero otherwise. The web service has a minimum of zero.
- Deployment: one script or Cloud Build trigger per service; container images in Artifact Registry; configuration through environment variables and Secret Manager.

## Testing Decisions

- A good test drives the web service through its HTTP API, the way the browser does, and checks responses and the data that ends up in the emulators. Tests never reach into internal functions.
- Seams: the web service HTTP API, run against the Firebase emulators with the Places, agent and Gemini adapters replaced by fakes.
- Tests in this spec: a request without an App Check token is refused and no fake adapter is called; rate limits return a clear "coba lagi nanti" response after the threshold and reset after the window; the per-IP ceiling is not hit by 50 different sessions from one IP; a non-allowlisted account cannot reach any admin route; no log line written during a Guidance request contains the complaint text.
- One smoke test after each deploy: landing page, language toggle, and a health route on each service respond.
- Prior art: none; this is a new repository. These tests set the pattern for specs 01 to 05.

## Out of Scope

- Buying and attaching findyourdent.com (a human step after the specs and tickets are final).
- Cloud Armor and a WAF (cost at least about USD 20 a month; App Check, rate limits and caps cover the hackathon).
- Phone OTP, email verification, and any sign-in provider other than Google.
- Native mobile apps, push notifications, and PWA features (install prompt, service worker, offline mode); see ADR-0006.
- Any data residency guarantee for Gemini processing beyond disclosure (ADR-0003).

## Further Notes

- Human steps: enable billing on the GCP project, create the budget alert, register the reCAPTCHA Enterprise key for App Check, and set the Places and Gemini daily quota caps in the console. Everything else is code or configuration an agent can do.
- Cost reference: docs/research/cost-comparison-2026-10-17.md (shared numbers, column B2 is closest to this design).

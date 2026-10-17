---
title: "Spec 02: Shortlist and Provider page"
labels: [ready-for-agent]
owner: B (web) for Places and pages, A (agent) for ranking reasons
depends_on: ["00", "01"]
cut_order: never cut
---

# Spec 02: Shortlist and Provider page

## Problem Statement

After understanding the problem, a Patient still has to choose where to go, and it is hard to find a credible, affordable dentist (problem A1). Google Maps shows hundreds of pins with no link to the Patient's actual problem, no idea of price, and reviews that say little about hygiene or materials. Meanwhile FindYourDent cannot copy Google's data (only `place_id` and, for 30 days, coordinates may be stored) and cannot afford to call Google Places for everything on every page view. The Patient needs a short, explained list of nearby Providers that fit their problem, and a Provider page that combines live Google facts with FindYourDent's own Testimonies, at a cost that stays near zero.

## Solution

From the Guidance card the Patient taps "Lihat dokter gigi terdekat", shares their location or types an area, and gets a Shortlist of up to five Providers (Klinik, Private Dentist or Hospital) that can handle the likely procedure, each with a one-line reason, distance, Testimony scores, the number of Kunjungan terbukti, price signals with their sources, and an on-demand "Lihat ulasan Google" button. Tapping a Provider opens its page: FindYourDent's own content first (Testimonies, prices, Claim status), and a live Google block (address, opening hours, phone, website, Google rating, a Maps link). Google Reviews load only when tapped. When the day's Places budget is used up, the Shortlist still works from Listed Providers plus a Google Maps search link.

## User Stories

1. As a Patient, I want to see Providers near me right after my Guidance, so that I can act while I am motivated.
2. As a Patient, I want to share my location with one tap, so that results are close to me.
3. As a Patient who does not want to share my location, I want to type an area such as "Gubeng, Surabaya", so that I still get results.
4. As a Patient anywhere in Indonesia, I want the Shortlist to work in my city, so that the service is not limited to Surabaya.
5. As a Patient, I want at most five Providers, so that I can decide instead of scrolling.
6. As a Patient, I want each Provider to come with a one-line reason why it fits my problem, so that I understand the choice.
7. As a Patient needing a root canal, I want Providers able to do it (or a Hospital with a conservative dentistry specialist) to rank first, so that I am not sent somewhere that will refer me on.
8. As a Patient, I want to see the distance to each Provider, so that I can judge travel.
9. As a Patient, I want to see each Provider's Testimony scores for service, hygiene and materials and equipment, so that I can judge credibility.
10. As a Patient, I want to see how many Testimonies have a Kunjungan terbukti mark, so that I know how many come from proven visits.
11. As a Patient, I want price signals for my likely procedure (prices other Patients paid, the Provider's Price List, or the Cost Estimate), each labelled with its source and date, so that I can judge affordability.
12. As a Patient, I want to know whether a Provider is a Klinik, Private Dentist or Hospital, labelled "perkiraan" when not confirmed by a Claim, so that I know what kind of place it is.
13. As a Patient, I want to tap "Lihat ulasan Google" on a Shortlist card or on the Provider page, so that I can read Google's reviews when I want them.
14. As a Patient, I want to open the Provider in Google Maps for directions, so that I can get there.
15. As a Patient, I want to call or message the Provider from its page, so that I can ask about availability.
16. As a Patient, I want the Provider page to show FindYourDent Testimonies first, so that I read detailed, moderated experiences.
17. As a Patient, I want the Provider page to show opening hours and phone from Google live, so that the information is current.
18. As a Patient, I want "Diklaim pemilik" on Providers that have claimed their page, so that I know the facts are owner-maintained.
19. As a Patient, I want a clear, useful result even when FindYourDent has reached its daily Google limit, so that I am never left with nothing.
20. As a Patient, I want to see that results are ranked by fit, Testimonies, price and distance, and never by payment, so that I can trust the order.
21. As a Patient with no Listed Providers nearby, I want Google's nearby Providers anyway, so that coverage does not depend on FindYourDent's data.
22. As the FindYourDent team, I want each Shortlist to cost one Places Text Search at the Pro tier, so that thousands of Shortlists a month stay free.
23. As the FindYourDent team, I want the Google block to load in the browser through an App Check-protected route, so that crawlers never trigger Places calls.
24. As the FindYourDent team, I want Provider pages with no FindYourDent content to be `noindex`, so that we do not publish pages of Google content to search engines.
25. As the FindYourDent team, I want daily caps per Places method and an automatic fallback, so that Places spend above the free allowances stays under USD 10 a month.
26. As the FindYourDent team, I want stored coordinates refreshed or deleted within 30 days, so that we follow Google's terms.
27. As a Patient on the emergency card, I want nearby Hospitals with an IGD listed the same way, so that I can go immediately.

## Implementation Decisions

- Places use follows ADR-0005. Stored from Google: `place_id` (indefinitely) and coordinates with the date fetched (refreshed or deleted within 30 days). Nothing else from Google is ever written to Firestore, caches or logs.
- One Places adapter in the web service owns every Places call, each with an explicit field mask and a named method so caps and tests can see them:
  - **Shortlist search**: Text Search (New), Pro-tier fields only (id, display name, formatted address, location, types, Google Maps URI). No rating, no opening hours, no phone, so the call stays in the Pro tier (about 5,000 free a month). One call per Shortlist, up to 20 results. With shared location: a location bias circle of about 5 km; with a typed area: the area in the query text. The query and included type come from the Guidance `likelyProcedures` (dentist for most procedures; hospital for emergency, specialist and surgical referrals).
  - **Provider Google block**: Place Details, Enterprise tier (formatted address, opening hours, national phone, website, rating, rating count, Google Maps URI). One call per Provider page view, requested by the browser after the page renders.
  - **Google Reviews**: Place Details with only the reviews field (Enterprise and Atmosphere tier), called only when the Patient taps "Lihat ulasan Google".
  - **Coordinates**: Place Details Essentials (location only), used when a Provider becomes a Listed Provider and by a monthly refresh job.
  - Place Photos are never requested.
- Daily caps, enforced by the adapter so the fallback triggers cleanly: Shortlist search 160 a day (inside the free 5,000 a month), Provider Google block 50 a day (about 500 paid calls a month, about USD 10), Google Reviews 33 a day (inside the free 1,000 a month), coordinates within the free 10,000 a month. Emergency Hospital searches share the Shortlist search cap and are always served first.
- Google caps Places per method, not per SKU, so the project-level caps (`infra/gcp/setup.sh`) are a backstop: Text Search 160 a day, and one Place Details cap of 83 a day shared by the Google block, Google Reviews and coordinates. Only the adapter's own counters keep the 50/33 split, and the coordinate refresh runs in small batches so it never starves them. A `RESOURCE_EXHAUSTED` (HTTP 429) answer from Places counts as cap reached.
- Fallback when the Shortlist search cap or budget is hit: rank Listed Providers within about 10 km using stored coordinates, and add a "Cari di Google Maps" link built as a plain Google Maps search URL (no API call). When the Google block cap is hit, the Provider page shows FindYourDent content plus the Maps link and a short "info Google sementara tidak tersedia" note.
- Ranking is deterministic and explainable, computed in the web service after joining search results with Firestore by `place_id`:
  1. Procedure fit (Provider type and services against `likelyProcedures`).
  2. Testimony quality: the three aspect averages, shrunk toward the overall mean when there are few Testimonies, with a small bonus for Kunjungan terbukti.
  3. Price fit: Provider prices (from Testimonies or Price List) against the Cost Estimate.
  4. Distance.
  Paid placement does not exist; Claim status does not affect rank.
- The Shortlist Gemini call (the second of the two per session, spec 01) receives the top five with their facts and returns one short reason per Provider in the Patient's language. It cannot reorder or add Providers. If the call fails, cards show a templated reason.
- Provider type inference when not claimed: Hospital if Google's types include hospital; Private Dentist if the name starts with "drg." or "dokter gigi" followed by a person's name; otherwise Klinik. Shown with "perkiraan" until a Claim confirms it.
- Price signals on cards and pages, in this order, each labelled with its source and date: median price paid from Testimonies for the procedure (shown only with at least two), the Provider's Price List (spec 05), then the Cost Estimate (spec 01) labelled "estimasi".
- Provider page route is keyed by `place_id`. The server renders FindYourDent content (Listed Provider name, Region, Testimonies, aggregates, prices, Claim status); the Google block and reviews are fetched by the browser through App Check-protected web API routes. Pages for Listed Providers are indexable; pages for non-Listed Providers are `noindex`.
- Google attribution: the Google block and reviews show "Google Maps" attribution; each review shows the author name, photo and link as provided; every Provider has a link to its Google Maps page.
- A monthly scheduled job refreshes coordinates for every Listed Provider and deletes coordinates older than 30 days that could not be refreshed.

## Testing Decisions

- Seam: the web service HTTP API with the Places adapter and the agent replaced by fakes, against the Firestore emulator. One agent-contract test covers the reasons call.
- Tests:
  - Each Places method sends exactly the agreed field mask; the Shortlist search never includes an Enterprise or Atmosphere field.
  - After any Shortlist or Provider page request, Firestore contains no Google field other than `place_id` and dated coordinates (inspect every written document).
  - Ranking: given fixed fake search results and fixed Testimonies, the order is as expected; a claimed Provider with weaker Testimonies does not outrank a better unclaimed one.
  - When the fake adapter reports the daily cap reached, the Shortlist returns Listed Providers plus the Maps search link, and the Provider page returns its fallback state.
  - A request without App Check to the Google block or reviews route is refused and the fake adapter is not called.
  - Non-Listed Provider pages carry `noindex`; Listed Provider pages do not, and their server-rendered HTML contains the Listed Provider name.
  - The coordinate refresh job deletes coordinates older than 30 days when the fake refresh fails.
- End-to-end (deployed preview): complaint to Guidance to Shortlist to Provider page to "Lihat ulasan Google".
- Prior art: spec 00's API tests.

## Out of Scope

- Booking, availability and queue information.
- Google photos.
- A map view of results (a list with distances and Maps links only).
- Paid or sponsored placement of any kind.
- Ranking by Google rating (it is shown on the Provider page only).

## Further Notes

- The Shortlist tier choice trades Google stars on cards for zero cost at up to about 166 Shortlists a day; switching to the Enterprise tier later is a field-mask change plus a cap change (about USD 10 a month at 43 a day, about USD 70 at 100 a day).
- Place IDs can change; when Google reports a `place_id` as obsolete, the Listed Provider record should be re-keyed to the new id (handle it if seen, do not build a migration job for the hackathon).

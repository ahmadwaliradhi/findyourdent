---
title: "Spec 04: Landing feed, directory and impact counter"
labels: [ready-for-agent]
owner: B (web)
depends_on: ["00", "03"]
cut_order: never cut (directory filters beyond province and kota can be cut)
---

# Spec 04: Landing feed, directory and impact counter

## Problem Statement

A visitor arriving at findyourdent.com needs to see, within seconds, that this is a place where real Patients describe real dental visits in detail, and that they can get help with their own problem right now. Without that, FindYourDent looks like one more directory or one more chatbot. FindYourDent also needs pages that search engines can index, so that Patients searching a clinic's name find its Testimonies, and it needs a visible, honest measure of its impact for judges and for the community. All of this must cost nothing in Google Places, because the landing page is the most-visited page and the one bots hit most.

## Solution

The landing page leads with the agent entry ("Gigi sakit? Ceritakan keluhanmu", text or voice), followed by a live impact counter and a public feed of the latest published Testimonies, filterable by province, kota/kabupaten, kecamatan, procedure, Provider type and Kunjungan terbukti. A directory lists Listed Providers with the same filters, sortable by Testimonies, aspect scores or distance. Everything on these pages comes from FindYourDent's own data and is server-rendered, so it is fast, indexable and free of Places calls.

## User Stories

1. As a visitor, I want the first thing I see to be an invitation to describe my toothache, so that I can get help immediately.
2. As a visitor, I want to choose between typing and a voice note from the landing page, so that I can start the way I prefer.
3. As a visitor, I want to see real Testimonies right below, so that I trust the platform.
4. As a visitor, I want each Testimony card to show the place name, its area, the three aspect scores, an excerpt, the visit month, the procedure and price if given, and the Kunjungan terbukti mark, so that I can scan quickly.
5. As a visitor, I want to filter the feed by province, kota/kabupaten and kecamatan, so that I see experiences near me.
6. As a visitor, I want to filter by procedure, so that I read about the treatment I need.
7. As a visitor, I want to filter by Provider type (Klinik, Private Dentist, Hospital), so that I compare like with like.
8. As a visitor, I want to show only Testimonies with Kunjungan terbukti, so that I read the most trustworthy ones.
9. As a visitor, I want to open a full Testimony and its Provider page from a card, so that I can read more.
10. As a visitor, I want a directory of Listed Providers with the same filters, so that I can browse places that Patients have written about.
11. As a visitor, I want to sort the directory by number of Testimonies, by aspect score, or by distance if I share my location, so that I find what matters to me.
12. As a visitor, I want each directory row to show the name, area, type, aspect scores, number of Testimonies and Kunjungan terbukti count, and "Diklaim pemilik" if claimed, so that I can compare.
13. As a visitor, I want to search the directory by name, so that I can find a specific clinic or dentist.
14. As a visitor, I want a clear message and a "Ceritakan pengalamanmu" button when my filter has no results, so that I can be the first.
15. As a visitor, I want a live counter of Testimonies, cities covered, Kunjungan terbukti, Listed Providers and Guidance sessions, so that I can see the community growing.
16. As a judge, I want the same counter to be visible during judging, so that I can see measurable impact moving.
17. As a Patient searching a clinic's name on Google Search, I want to find its FindYourDent page with Testimonies, so that I can read them before I go.
18. As a visitor on a slow connection, I want the feed to load in pages, so that the first screen appears quickly.
19. As a visitor, I want to share a Testimony or a Provider page on WhatsApp with a good preview, so that I can tell family.
20. As the FindYourDent team, I want the landing feed and directory never to call Google Places, so that traffic and bots cost nothing.
21. As the FindYourDent team, I want a sitemap listing Listed Provider pages, so that search engines index them.
22. As the FindYourDent team, I want the counter to count Guidance sessions without storing anything about them, so that it stays private.

## Implementation Decisions

- The landing page is server-rendered: the agent entry (handing off to spec 01's flow), the impact counter, and the first page of the feed in the HTML; later pages and filter changes load through a paginated web API (cursor-based).
- Feed source: published Testimonies only, newest first, joined with the Listed Provider's first-party name, Region and type. No Google data on the landing page or directory, so no Places calls and no App Check gate for reading.
- Filters (shared by feed and directory): province, kota/kabupaten, kecamatan (from the Kemendagri list), procedure (shared list), Provider type, Kunjungan terbukti only. Filter state lives in the URL so filtered views are shareable and indexable for the common combinations (province and kota).
- Directory: Listed Providers only (created by a first published Testimony or a Claim). Sort options: most Testimonies, highest average across the three aspects (shrunk toward the mean for small counts, the same formula as spec 02), and distance (stored coordinates, only when the visitor shares location in the browser; the location is not sent to the server, distance is computed in the browser from the coordinates in the page data). Name search is a prefix match on a normalised name field.
- Impact counter: Firestore counters incremented by the web service on events (Testimony published or removed, Listed Provider created, Guidance session completed, Kunjungan terbukti granted); distinct kota/kabupaten counted from Listed Providers. Shown on the landing page and available as a small public read-only route for the deck.
- Search engines: landing, feed pages for province and kota, directory and Listed Provider pages are indexable with descriptive titles and meta descriptions in Indonesian; a sitemap lists Listed Provider pages; Open Graph tags give WhatsApp previews with the Provider name, area and aspect scores (no Google content).
- Accessibility: proper headings, labels and contrast; the record button and filters work with a keyboard and screen reader; text size scales.

## Testing Decisions

- Seam: the web service HTTP API and server-rendered HTML against the Firestore emulator, with the Places adapter faked.
- Tests: loading the landing page, every feed page and every directory query results in zero calls to the fake Places adapter; each filter returns only matching Testimonies or Listed Providers; removed, hidden, held and deleted Testimonies never appear; the counter changes on publish and removal; the server-rendered HTML of the landing and a Listed Provider page contains the Testimony text and first-party name; the sitemap lists exactly the Listed Providers.
- End-to-end: the landing page renders with feed and counter; filtering by kota narrows the feed.
- Lighthouse on the deployed landing page (performance, accessibility, best practices, SEO; mobile profile) is run once before submission and the scores go in the README.
- Prior art: specs 00 and 03 API tests.

## Out of Scope

- Google rating or reviews on the landing page or directory.
- Non-Listed Providers in the directory (they are reachable only through the Shortlist).
- A map view.
- Personalised recommendations on the landing page.
- Comment threads on Testimonies (only the Provider reply in spec 03).

## Further Notes

- On submission day the feed may be nearly empty: the 30 real Testimonies are recruited after deployment (spec 06). The demo should show the posting journey creating the first Testimonies live rather than a pre-filled feed.

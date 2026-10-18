---
title: "Spec 08: Design revamp"
labels: [ready-for-agent]
owner: B (web)
depends_on: ["00", "01", "02", "03", "04", "05"]
cut_order: "must-have: baseline, shell, Home with Guidance and Emergency, Provider page, Testimony form. Nice-to-have, cut first to last: Claim and Price List screens, About/Privacy/Terms, My Testimonies, Directory, Kecamatan"
---

# Spec 08: Design revamp

Written 18 October 2026 from a grilling session on the design handoff package. The package (brand book, tokens, component references, one responsive HTML mockup per screen and language) is committed under `docs/design/` without its screenshots and canvas source files. Its `HANDOFF.md` is the visual and copy reference; where this spec and `HANDOFF.md` disagree, this spec wins.

## Problem Statement

FindYourDent works, but it does not look like a product a worried Patient would trust with a toothache. Every page is a narrow single column, the brand has no visual identity, statuses lean on color, and the navigation does not tell a visitor what else the site offers. Judges score User Experience, and the demo video shows these screens. The product owner is not satisfied with the current design.

The new design also changes what the region filter offers. Visitors are asked for a Kemendagri kecamatan code they do not know, and almost no Listed Provider has a kecamatan recorded, because the Testimony form never asks for one.

## Solution

Rebuild every page on the new FindYourDent design system: a shared header with navigation and a two-option language switch, a mobile pill nav, a footer with the disclaimer and the About, Privacy and Terms links, a 1200px layout with two-column splits on desktop, and new Button, Badge, Card, Field, UrgencyNotice and TestimonyCard components. Three new pages (About, Privacy, Terms) join the site.

The region filter becomes Provinsi, then Kota/Kabupaten, then Kecamatan, all chosen by name. When a Patient picks a place in the Testimony form, FindYourDent pre-fills its Region, kecamatan included, from the address the picker already shows, so Listed Providers start carrying a kecamatan.

Every journey that works today keeps working: the existing end-to-end tests stay green on phone and desktop throughout the revamp.

## User Stories

### Shell and navigation

1. As a visitor, I want the FindYourDent wordmark at the top of every page, so that I know where I am.
2. As a visitor on desktop, I want a nav with Panduan, Direktori, Testimoni saya and Tentang kami, with the current page underlined, so that I can see what the site offers and where I am.
3. As a visitor on a phone, I want the nav as a horizontally scrolling row of pills under the header, with the current page tinted, so that I can reach every section with my thumb.
4. As a visitor, I want a "Ceritakan pengalamanmu" button in the header and the mobile nav, so that I can write a Testimony from anywhere.
5. As a visitor, I want a language switch showing both languages ("Indonesia | English" on desktop, "ID | EN" on a phone), with the current one highlighted, so that I can see which language I am in and switch in one tap.
6. As a visitor without JavaScript, I want the language switch to still work and keep me on the same page, so that a slow or broken connection does not lock me into one language.
7. As a screen-reader user, I want the switch option for the other language to say what it does ("Ganti bahasa ke English") and the current one to be marked current, so that I know what a tap will do.
8. As a visitor, I want a footer with the disclaimer and links to Tentang kami, the business email, Direktori, Kebijakan privasi and Syarat penggunaan, so that I can find who runs the site and on what terms.
9. As a keyboard user, I want a skip link to the main content and a visible focus ring on everything I can reach, so that I can move through the page without a mouse.
10. As a visitor on a 360px phone, I want no page to scroll sideways, so that the site feels built for my phone.
11. As a visitor on a desktop, I want pages to use the width of my screen with two-column layouts, so that I do not read a narrow strip in the middle of a wide window.

### Home, Guidance and Emergency Escalation

12. As a Patient, I want the complaint box and consent line to lead the home page in the new design, so that getting help stays the first thing I see.
13. As a Patient, I want the Guidance card to show its Urgency Tier with an icon and a word, never color alone, so that I understand urgency even if I cannot tell colors apart.
14. As a Patient on desktop, I want a Summary panel beside my Guidance with a link to the dentists near me and the emergency reminder, so that the next step is always in view.
15. As a Patient in an emergency, I want the "Ke IGD sekarang" card to stay a plain alert with nothing promotional, so that nothing distracts me from getting to an IGD.
16. As a visitor, I want the impact counter to show the live numbers, never placeholders, so that I can trust what it says.
17. As a visitor, I want Testimony cards in the feed redesigned with clear aspect scores, Kunjungan terbukti mark and price in tabular figures, so that I can scan and compare quickly.
18. As a visitor, I want the Provider type to read "Klinik Gigi" (or "Dental clinic") everywhere, so that the label says what kind of place it is.

### Provider page, Claim and Price List

19. As a Patient, I want the Provider page in the new two-column layout with contact buttons, Google block, Google Reviews on a tap and Testimonies, so that I can decide and act from one screen.
20. As a Patient, I want the Provider page's "Ceritakan pengalamanmu" link to keep the place picked in the Testimony form, so that I do not search for it again.
21. As a Provider owner, I want the Claim page and the Price List review page in the new design, with the review time from the claim rules shown in working days, so that I know what to expect.
22. As a Provider owner, I want prices shown as "Rp 450.000" (or "Rp 450,000" in English) in tabular figures, so that I can check them at a glance.

### Testimony form

23. As a Patient writing a Testimony, I want the form in the new two-column design, with every field labelled and every error shown under its field with an icon, so that I can fix mistakes quickly.
24. As a Patient writing a Testimony, I want the character counter to show the real limit, so that I know how much I can write.
25. As a Patient writing a Testimony for a place FindYourDent does not know yet, I want the Provinsi, Kota/Kabupaten and Kecamatan to be filled in for me from the address of the place I picked, so that I do not hunt through long lists.
26. As a Patient, I want to change any pre-filled Region level, so that I can correct it when the address is wrong.
27. As a Patient, I want the Kecamatan to stay optional, so that I can submit without it when I am unsure.
28. As a Patient whose picked place has an address that matches no kecamatan, or matches two, I want that level left empty rather than guessed, so that FindYourDent does not record a wrong area in my name.
29. As a Patient writing about a Listed Provider, I want its recorded Region shown as it is today, so that I do not re-enter what FindYourDent already knows.
30. As a Provider owner claiming a place that is not listed, I want an optional Kecamatan in the Claim form, so that my page appears under my kecamatan.

### Directory, feed filters and My Testimonies

31. As a visitor, I want to filter the feed and the directory by Provinsi, then Kota/Kabupaten, then Kecamatan, each by name, so that I never type a code.
32. As a visitor, I want the Kecamatan select disabled with the hint "Pilih kota/kabupaten dulu" until I choose a kota/kabupaten, so that I understand the order.
33. As a visitor filtering by a kecamatan, I want to see only Listed Providers and Testimonies recorded in that kecamatan, so that the filter means what it says.
34. As a visitor, I want the directory in the new two-column layout, so that filters and results sit side by side on desktop.
35. As a signed-in Patient, I want My Testimonies in the new design with each status shown as an icon and a word, so that I can see which of my Testimonies are published, held or removed.

### About, Privacy and Terms

36. As a visitor, I want an About page that says who runs FindYourDent and why, so that I can decide whether to trust it.
37. As a visitor, I want Privacy and Terms pages, so that I can read how my data is used and what I agree to.
38. As the FindYourDent team, I want Privacy and Terms marked as drafts, kept out of search engines and the sitemap until legal review, so that unreviewed legal text is not presented as final.
39. As the FindYourDent team, I want About in the sitemap and linked from the header and footer, so that search engines and visitors find it.

### Team and quality

40. As the FindYourDent team, I want every existing end-to-end journey to stay green on phone and desktop after each redesign change, so that the revamp never breaks Guidance, the Shortlist, the Provider page or posting a Testimony.
41. As the FindYourDent team, I want every color, radius and type style to come from the design tokens, so that the brand stays consistent and contrast stays checked.
42. As the FindYourDent team, I want the Region pre-fill to make no extra Google Places call and store no Google content, so that the Places cap (ADR-0005) and Google's terms hold.
43. As the FindYourDent team, I want Indonesian and English at parity on every new string, so that neither language is second-class.
44. As a visitor who prefers reduced motion, I want animations to respect that setting, so that the site does not make me uncomfortable.

## Implementation Decisions

### Delivery order and slicing

- Work lands as separate tickets in this order: **Baseline**, then **Shell**, then the screen tickets in parallel. Baseline blocks everything; Shell blocks every screen ticket.
- Screen tickets: Home with Guidance and Emergency Escalation (one ticket, they share the home route); Provider page; Testimony form; Directory; My Testimonies; Claim and Price List; About, Privacy and Terms.
- Kecamatan is two more tickets: **Kecamatan data** (contracts, its own PR, runs in parallel from the start) and **Kecamatan in Region fields** (blocked by Kecamatan data, Shell, Directory and Testimony form).
- Under time pressure, cut in the order given in the frontmatter. The revamp lands before the demo video is recorded.

### Baseline

- The new tokens enter the app stylesheet under the shadcn variable names the components already use, mapped as the brand book's "Using the tokens in code" table says, plus the status families (success, warning, info, destructive, each with soft and line variants), star and highlight. Light theme only.
- Figtree is self-hosted from the package and preloaded. Brand assets (wordmark, mark, favicon, app icons, share image, web manifest) move into the public folder. The favicon keeps its current path, because a Google Reviews attribution test looks for it.
- Button, Badge, Card, Field, UrgencyNotice and TestimonyCard are rebuilt with Tailwind in the app's UI component folder, following the package's component references for behavior and look. The package's bundled script is not used.
- Icons come from `lucide-react`, added as a dependency.
- No page layout changes in Baseline. Any uncommitted design work elsewhere is ignored; Baseline starts from the package.

### Shell

- The root layout renders the header, the mobile pill nav, the footer and a `main` landmark with a skip link to it, on every page.
- The language switch stays a form posting to the language route, one submit per option, so it works without JavaScript and keeps the current path and query. The option for the other language keeps its current accessible name ("Ganti bahasa ke English" / its English counterpart); the current language is marked `aria-current="true"` and does not submit. Each option is at least 44px wide.
- Content max-width is 1200px, with a 16px gutter on phones and 40px from 900px. The desktop layout starts at 900px.
- The header and mobile nav "Ceritakan pengalamanmu" link goes to the Testimony form with no place picked.

### Home, Guidance and Emergency Escalation

- The desktop Summary panel's "Lihat dokter gigi terdekat" is a link to the Shortlist section on the page, not a second button, so the page keeps one button with that name. Following it opens the Shortlist and does what "Gunakan lokasi saya" does: it asks for the location and searches, so one click reaches the results. Focus moves to the Shortlist. If the location is denied, the Shortlist shows that error and the area field. A search already running is not started again. Without script the link still lands on the Shortlist section.
- The Emergency Escalation card keeps `role="alert"`.
- Impact counter values come from the existing impact counter read; the claim review time comes from the value the claim code already passes; the Testimony character limit comes from the shared Testimony limits. No placeholder from the mockups reaches the app, and no sample data from the mockups (names, ratings, prices, distances) does either.

### Region fields and Kecamatan

- Kecamatan data from the Kemendagri list joins the shared regions data in the contracts package, each kecamatan under its kota/kabupaten. Stored Region references keep using codes; the UI shows names only.
- One shared Region fields component (Provinsi, Kota/Kabupaten, optional Kecamatan) replaces the three current copies: the listing filters, the Testimony form's provider fields, and the Claim form. Each level is disabled until the level above is chosen. The code input in the listing filters goes away; until Kecamatan data lands, the filters offer Provinsi and Kota/Kabupaten only.
- Kecamatan filtering is a strict match on the stored kecamatan code, as the feed and directory queries already do. A Listed Provider without a kecamatan does not appear under a kecamatan filter.
- **Region pre-fill.** A new region matcher takes a free-text address and returns a Region suggestion: province, kota/kabupaten and kecamatan codes, each present only when exactly one region name in the list matches at that level within the level above. Ambiguous or missing matches leave that level, and every level below it, empty. It runs in the browser, makes no Google Places call and sends no Google text anywhere; its only request is our own kecamatan list for the matched kota/kabupaten code (`GET /api/regions/:regencyCode/districts`), since that list stays on the server.
- In the Testimony form, when the Patient picks a place that is not a Listed Provider, the form passes the picked suggestion's secondary text (already returned by the picker's autocomplete) to the region matcher and pre-selects what it returns. The Patient can change any level. Google's text is never stored or sent to the server; only the Region codes the Patient submits are.
- Already-listed places keep showing their recorded Region; nothing is pre-filled.
- The Claim form has no Google address loaded today, so it gets the optional Kecamatan level with no pre-fill. No new Places call is added to get one.
- Server-side validation of an optional kecamatan code on Testimony submit and Claim already exists and does not change.

### About, Privacy and Terms

- Routes: `/tentang`, `/privasi`, `/syarat`. Copy comes from the mockups, in both languages, including the About closing sentence about opening new countries only after official-source guidance.
- Privacy and Terms are production copy: no draft banner, no bracketed placeholders, effective and last-updated dates in the header, indexable, and in the sitemap. Privacy answers data requests within 30 working days.
- About is indexable, in the sitemap, and linked from the header nav and the footer.
- The Privacy page's "no advertising cookies" statement holds only while no analytics or ad SDK is added.

### Copy and i18n

- Existing translation keys are reused. New or changed strings, in both languages: Provider type "Klinik Gigi" / "Dental clinic" in the filter, Provider page and Shortlist labels; Kecamatan select label, "all districts" option and hint; nav "Tentang kami" / "About us"; language switch group label "Pilih bahasa" / "Choose language"; the Summary panel strings; every string on About, Privacy and Terms.
- "Klinik Gigi" is a display label for the glossary's Klinik; the domain term does not change.

### Rules every ticket holds

- No raw hex value, Tailwind palette color or `text-white` in a component; tokens only.
- Focus ring is a solid 3px ring with a 2px offset and is never suppressed.
- Touch targets at least 44×44px; body and input text at least 16px; no text under 12px.
- Every status (Urgency Tier, badge, error, Testimony status) shows an icon and a word.
- Money uses tabular figures and the language's thousands separator.
- Motion respects `prefers-reduced-motion`.
- One `h1` per page.

## Testing Decisions

### Acceptance on every ticket

Every redesign ticket carries these acceptance criteria:

- The existing end-to-end specs (home, provider, testimony-form, entry-memory) pass on both Playwright projects, mobile-360 and desktop.
- A ticket may edit an existing spec only for a selector or accessible name the redesign deliberately changes, and only if the edit keeps the same journey assertion. The ticket lists each such edit before work starts. Known in advance: the Shell ticket scopes the Provider page's "Ceritakan pengalamanmu" link lookup to the `main` landmark, because the header and mobile nav add links with the same name.
- `pnpm lint`, `pnpm typecheck` and `pnpm test` pass.
- The PR attaches chrome-devtools screenshots of each touched screen at 390px and 1280px, in Indonesian and English, beside the matching mockup.
- Lighthouse accessibility on each touched route is no lower than on `main`.

### What makes a good test here

Tests check what a Patient sees and does, what goes over the network and what lands in browser storage, never class names or component internals. End-to-end tests find elements by role, label and visible text, as the existing specs do.

### Seams

1. **End-to-end (Playwright, mobile-360 and desktop)**, the main seam. New specs, each added in the ticket that introduces the behavior:
   - the language switch works with JavaScript disabled and keeps the current page (Shell);
   - the footer reaches About, Privacy and Terms, and all three are indexable (About, Privacy and Terms);
   - the Kecamatan select stays disabled until a kota/kabupaten is chosen, and filtering by one narrows the results (Kecamatan in Region fields);
   - picking a place in the Testimony form pre-fills Provinsi, Kota/Kabupaten and Kecamatan from the fake Places adapter's address, and the Patient can change them (Kecamatan in Region fields).
   Prior art: the four existing specs and their shared support helpers.
2. **Unit: region matcher.** Address text in, Region suggestion out: a full match, a match to kota only, an ambiguous kecamatan name, an address naming no known region, mixed case and "Kota"/"Kabupaten" prefixes. Prior art: the regions and listing filters unit tests.
3. **Contracts: kecamatan data.** Every kecamatan code sits under an existing kota/kabupaten, and codes are unique. Prior art: the contracts package tests.
4. **Web API tests** already cover the optional kecamatan code on submit and Claim. They change only if submit rules change, which this spec does not plan.

Visual fidelity is checked by screenshot review on the PR, not by tests.

## Out of Scope

- Dark theme. The tokens define it; the app stays light.
- Any change to Guidance, Emergency Escalation, Shortlist ranking, Moderation or Claim rules. This is a visual and navigation revamp plus the Region fields.
- Pre-filling the Claim form's Region from Google, or any new Google Places call.
- Backfilling kecamatan for existing Listed Providers. They gain one through a later Testimony correction or Claim.
- Final legal text for Privacy and Terms.
- The admin pages beyond keeping them working with the new tokens.
- Copying mockup HTML or the package's bundled components into the app.

## Further Notes

- The design package lives at `docs/design/`: `HANDOFF.md`, the brand book and tokens, component references, the font, brand assets, and the HTML mockups. Screenshots (19 MB) and canvas source files are left out; open the mockup HTML at 390px and 1280px instead.
- `HANDOFF.md` says the token mapping and several component changes already sit in the working tree. That is not true on this branch; Baseline does that work.
- Submission deadline is 18 October 2026 (see the specs README). If time runs out, the cut order in the frontmatter applies, and the existing end-to-end journeys must still pass at whatever point work stops.

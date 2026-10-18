# FindYourDent redesign: implementation handoff

Read this file first. It tells you what to build, where each design lives, and what is still undecided.

## Goal

Implement the new FindYourDent design system and the redesigned screens in `apps/web` (React Router v7, Tailwind v4, shadcn/ui, i18next). The mockups are static HTML. Rebuild them with the app's existing components and routes. Do not copy the mockup HTML into the app.

Scope: light theme only. Indonesian is the default language and English must stay at parity. Build mobile-first at 360px, then a desktop layout from 900px.

## What is in this package

| Path | What it is | How to use it |
| --- | --- | --- |
| `design-system/README.md` | The brand book: voice, color, type, spacing, states, iconography, accessibility rules | Follow it. It names tokens and says when to use each |
| `design-system/tokens.json` | Source of truth for every token, in light and dark | Values for `app.css` |
| `design-system/tokens.css` | The same tokens as CSS custom properties, plus one class per type style | Reference. The app maps these into shadcn variable names (see below) |
| `design-system/components/` | Reference rendition of Button, Badge, Card, Field, UrgencyNotice and TestimonyCard (`bundle.js`, `bundle.css`, `index.d.ts`), with one README and preview per component | Behavior and visual spec. Rebuild them in `app/components/ui/` with Tailwind, not with `bundle.js` |
| `design-system/assets/Brand/` | Logo mark, wordmark, favicon, app icons, share image, with a README on which file goes on which background | Copy into `apps/web/public/` |
| `design-system/fonts/Figtree-Variable.woff2` | Figtree variable font, latin subset, SIL Open Font License | Self-host as `public/fonts/figtree-variable.woff2` and preload it |
| `mockups/html/*.html` | One standalone, responsive HTML page per screen and language (24 files) | Open in a browser and resize between 390px and 1280px. This is the layout spec |
| `mockups/html/fyd.css` | The stylesheet behind every mockup | Shows exact spacing, radii and breakpoints. Translate it into Tailwind classes |
| `mockups/screenshots/desktop/*.png`, `mockups/screenshots/mobile/*.png` | Full-page captures at 1280px and 390px | Visual reference for review |
| `mockups/source/` | The original canvas files (`.dc.html`, `canvas.json`) | Only needed to reopen the canvas. Ignore for implementation |

## Screens and routes

Each screen has an Indonesian file and an English file. In the app they are one route each: the language comes from the `__session` cookie set by the language toggle (`POST /language`).

| Screen | Mockup (ID / EN) | Route | Main files to change |
| --- | --- | --- | --- |
| Home with complaint form and Testimony feed | `Beranda-ID` / `Home-EN` | `/` | `routes/home.tsx`, `components/listing-filters-form.tsx`, `components/testimony-card.tsx`, `components/impact-counter.tsx` |
| Guidance result with Shortlist | `Panduan-ID` / `Guidance-EN` | `/` after submit, and `/panduan/:token` | `components/guidance-result.tsx`, `components/shortlist-panel.tsx` |
| Emergency (IGD) | `Darurat-ID` / `Emergency-EN` | `/` when the response is an emergency | `EmergencyCard` in `components/guidance-result.tsx`, `shortlist-panel.tsx` with `purpose="emergency"` |
| Provider page | `Tempat-ID` / `Provider-EN` | `/tempat/:placeId` | `routes/tempat.$placeId.tsx`, `components/google-reviews.tsx`, `components/report-button.tsx` |
| Write a Testimony | `Ceritakan-ID` / `Write-EN` | `/ceritakan` | `components/testimony-form.tsx`, `components/provider-fields.tsx` |
| Directory | `Direktori-ID` / `Directory-EN` | `/direktori` | `routes/direktori.tsx`, `components/listing-filters-form.tsx` |
| My Testimonies | `TestimoniSaya-ID` / `MyTestimonies-EN` | `/testimoni-saya` | `routes/testimoni-saya.tsx` |
| Owner price list review | `DaftarHarga-ID` / `PriceList-EN` | `/tempat/:placeId/daftar-harga` | `routes/tempat.$placeId.daftar-harga.tsx` |
| Claim a page | `Klaim-ID` / `Claim-EN` | `/tempat/:placeId/klaim` | `routes/tempat.$placeId.klaim.tsx` |
| About us (new) | `Tentang-ID` / `About-EN` | `/tentang` (proposed) | new route |
| Privacy policy (new) | `Privasi-ID` / `Privacy-EN` | `/privasi` (proposed) | new route |
| Terms of use (new) | `Syarat-ID` / `Terms-EN` | `/syarat` (proposed) | new route |

The proposed slugs follow the existing Indonesian route names. Confirm them with the product owner before adding the routes, `sitemap.xml.ts` entries and footer links.

The mobile layout is the same page as desktop at a narrower width. There is no separate mobile file.

## Global changes (every page)

1. **Header:** wordmark on the left (`/brand/wordmark.svg`, 32px tall), desktop nav (Panduan, Direktori, Testimoni saya, Tentang kami) with an underline on the current page, a secondary "Ceritakan pengalamanmu" button, and the language switch.
2. **Mobile nav:** below 900px the nav becomes a horizontally scrolling row of pill links under the header. It includes "Ceritakan pengalamanmu", and the current page has a tinted pill.
3. **Language switch:** a two-option segmented control with a globe icon. Desktop shows "Indonesia | English", mobile shows "ID | EN". The current language has the teal fill and `aria-current="true"`. Each option keeps working without JavaScript, because the existing toggle is a form posting to `/language`. Each target is at least 44px wide.
4. **Footer:** the disclaimer, plus links to Tentang kami, `business@findyourdent.com` (as `mailto:`), Direktori, Kebijakan privasi and Syarat penggunaan.
5. **Layout:** content max-width is 1200px with a 16px gutter on mobile and 40px from 900px. The current app uses `max-w-2xl` everywhere. Widen to the mockup layouts: two-column splits on desktop for Home, Guidance, Provider, Write, Directory and the legal pages.

## Copy and i18n

Most copy in the mockups comes verbatim from `app/i18n/locales/id.json` and `en.json`; reuse the existing keys. New or changed strings:

- `filters.providerTypes.klinik`, `provider.type.klinik` and `shortlist.type.klinik`: change to "Klinik Gigi" and "Dental clinic".
- `filters.district` and `filters.districtHint`: replace the Kemendagri code input with a Kecamatan select. Labels: "Kecamatan" / "District (kecamatan)", "Semua kecamatan" / "All districts". The select is disabled until a kota/kabupaten is chosen; its hint reads "Pilih kota/kabupaten dulu" / "Choose a city or regency first".
- Nav item "Tentang kami" / "About us", and labels for the language switch ("Pilih bahasa" / "Choose language").
- Every string on the About, Privacy and Terms pages: take them from the mockup HTML files.
- Guidance summary panel (desktop only): "Ringkasan" / "Summary", "Lihat dokter gigi terdekat" / "See dentists near you", and the emergency reminder line under it.

Keep sample data out of the app. Names, ratings, prices and distances in the mockups are illustrative.

## Tokens in code

`apps/web/app/app.css` already holds the new tokens mapped onto the shadcn variable names (`--background` = `surface-100`, `--primary` = `brand`, `--secondary` = `brand-tint`, and so on). It also adds the status families `success`, `warning`, `info` and `destructive`, each with `-soft` and `-line` variants, plus `star` and `highlight`. The mapping table is in `design-system/README.md`, under "Using the tokens in code".

These working-tree changes were made earlier and are **not committed**. Run `git status` and `git diff` first, then review and keep or redo them:

- `app/app.css`
- `components/ui/button.tsx`, `badge.tsx`, `card.tsx`, `textarea.tsx`, and the new `components/ui/icon.tsx`
- `root.tsx`: wordmark, favicon, manifest and font preload
- `guidance-result.tsx`: urgency icons and the emergency card
- small class changes in `testimony-form.tsx`, `admin.tsx`, `testimony-card.tsx`, `testimoni-saya.tsx`, `tempat.$placeId.daftar-harga.tsx`, `listing-filters-form.tsx`, `shortlist-panel.tsx`, `provider-fields.tsx` and `language-toggle.tsx`
- the new files in `public/`: icons, `og-image.png`, `site.webmanifest`, `brand/` and `fonts/`

They have not been built or tested: the sandbox could not run the macOS-installed dependencies. The language toggle in that diff is still the old single button and needs the new segmented control.

## Rules that must hold

- Never write a raw hex value or a Tailwind palette color (`amber-500`, `yellow-200`) in a component. Use tokens.
- Focus ring: a solid 3px `ring` with a 2px offset. It is in `app.css` base styles; do not suppress it with `outline-none`.
- Touch targets are at least 44×44px. Body and input text is at least 16px; no text is under 12px.
- Every status (urgency tier, badge, error) shows an icon and a word, never color alone.
- The emergency card keeps `role="alert"` and contains nothing promotional.
- Money uses tabular figures (`tabular-nums`) and the format `Rp 450.000` (Indonesian) or `Rp 450,000` (English).
- Respect `prefers-reduced-motion`.

## Open items to resolve before or during implementation

1. **Kecamatan data does not exist yet.** `packages/contracts/data/regions.json` has provinces and kabupaten/kota only, as the README states. Add kecamatan to `regions.json` (a contracts change, in its own PR) before the Kecamatan filter can work. The current Firestore filter uses `districtCode`; keep the stored code, but show the name.
2. **Legal pages are drafts.** Privacy and Terms carry a "draft for legal review" banner and bracketed placeholders: legal entity name, effective date, reply time for data requests, content licence scope, limitation of liability, and governing law. Do not publish them without review. Remove the draft banner only when legal signs off.
3. **"No advertising cookies"** on the Privacy page assumes no analytics or ad SDK is added. Keep it true or update the text.
4. **Impact counters** show `[jumlah]` / `[count]` placeholders. Wire them to the existing `readImpactCounter` values.
5. **Claim review time** shows `[n] hari kerja`. Use the value the claim code already passes as `{{days}}`.
6. **Testimony character limit** is drawn as 5,000 in the Write mockup. Use `TESTIMONY_LIMITS.textMaxChars`.
7. **lucide-react is not installed.** `ui/icon.tsx` holds hand-drawn Lucide-style paths for status icons. Either keep extending it or add `lucide-react` (check with the owner before adding a dependency).
8. **Expansion copy on About** ("Dari Indonesia, untuk dunia") states a plan, not dates. The closing sentence about opening new countries only after official-source guidance is a suggestion; confirm it with the owner.

## Acceptance checklist

- [ ] Every screen matches its mockup at 390px and 1280px, in both languages.
- [ ] The language switch keeps the current page and works without JavaScript.
- [ ] Region filter: Provinsi → Kota/kabupaten → Kecamatan, with no code input anywhere.
- [ ] Provider type reads "Klinik Gigi" / "Dental clinic" everywhere it appears.
- [ ] About, Privacy and Terms routes exist, are linked from the header (About) and footer (all three), and are added to the sitemap.
- [ ] Contrast holds: text 4.5:1, borders, icons and focus 3:1. Every pair in `tokens.json` is checked, so use the tokens as their usage notes say.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, and the e2e specs still pass. `e2e/provider.spec.ts` checks `img[src="/favicon.svg"]`, and that file still exists.

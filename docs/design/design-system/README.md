FindYourDent helps people in Indonesia understand a dental problem and choose a credible, affordable dentist. Most people arrive on a phone, often in pain or worried about cost, so every screen must be calm, fast to read and impossible to misread. Build for a 360px wide screen first, in Bahasa Indonesia first, and scale up.

## Content fundamentals

- Write Bahasa Indonesia first and keep English at parity. Address the Patient as "Anda", never "kamu", and write short sentences in plain words: "Ceritakan keluhan gigi Anda", "Lihat panduan", "Sakit gigi? Pahami dulu sebelum ke dokter gigi."
- Say what the product is: educational information and navigation, never a diagnosis or a prescription. Keep the footer note "FindYourDent memberi informasi edukasi dan navigasi, bukan diagnosis atau resep obat." on every page, and never write "diagnosis", "Anda menderita" or a medicine dose in UI copy.
- Use the glossary terms exactly: Patient (Pasien), Provider, Testimony (Testimoni), Guidance (Panduan), Hold. Reserve "Review" for Google reviews. Never write "user", "pasien umum" or "listing".
- Name the next step on buttons with a verb: "Lihat panduan", "Kirim jawaban", "Cari IGD terdekat". Avoid "Submit", "OK" and "Klik di sini".
- Emergency copy is an imperative with no softening: "Ke IGD sekarang." Follow with one instruction, then the red flags found. Never put a promotion or a decorative element near it.
- Sentence case everywhere. No emoji, no exclamation marks, no marketing superlatives ("terbaik", "termurah") about a Provider.
- Format Rupiah as `Rp 450.000` with a dot as thousands separator and a space after `Rp`; show ranges as `Rp 450.000 – Rp 1.200.000`. Format visit dates as month and year: "Mei 2026". Show scores as `4/5` with the word for the aspect beside it.
- State uncertainty in words: "perkiraan", "bergantung pada kota dan bahan". Pair every price with where it comes from.

## Visual foundations

**Color.** The ground is warm enamel `surface-100`, cards are `surface-200`, and quiet areas are `surface-300`. Set text in `ink`, secondary text in `ink-muted`. `brand` (deep teal) is the only action color: one `primary` button per view, links, the active filter, the logo pin. `brand-tint` with `on-brand-tint` is the soft fill for selected chips, secondary buttons and rating tiles. Use status colors only for status, always with an icon and a word:

| Meaning | Fill | Text | Border | Where |
| --- | --- | --- | --- | --- |
| Emergency (`darurat`) | `danger` | `on-danger` | none | the Emergency notice and the IGD card; error text |
| Soon (`segera`) | `warning-soft` | `warning` | `warning-line` | urgency tier, low-confidence prices |
| Scheduled (`terjadwal`) | `brand-tint` | `on-brand-tint` | none | urgency tier |
| Routine (`rutin`) | `surface-300` | `ink` | none | urgency tier |
| Success | `success-soft` | `success` | `success-line` | verified visit, accepted proof |
| Info | `info-soft` | `info` | `info-line` | BPJS notes, sources |

Never tell success from danger by hue alone: the icon (check or octagon-alert) and the word always travel with them. Use `star` only for filled rating stars, next to the number.

**Type.** One family, Figtree (variable, 300 to 900), self-hosted as `fonts/Figtree-Variable.woff2` (SIL Open Font License 1.1) and preloaded. Set body copy in `body` (16px/24px) and form text at 16px or larger so iOS does not zoom. Titles use `h1`, `h2`, `h3`; the landing headline alone uses `display`. Never go below `caption` (12px). Show prices in `price` with tabular figures (`font-variant-numeric: tabular-nums`) so columns line up. Set section eyebrows in `overline` with `text-transform: uppercase`, not typed in capitals.

**Spacing and layout.** Work on a 4px base. Page gutter is `space-4` on mobile and `space-6` from 640px. Keep one column, max width 672px (`max-w-2xl`), centred. Gap between sections is `space-8`, inside a card `space-4`, card padding `space-5`. Every tappable thing is at least `touch-target` (44px) in both directions, with at least `space-2` between neighbours.

**Shape and elevation.** Buttons, inputs and notices use `radius-md`; cards use `radius-lg`; chips and the language toggle use `radius-pill`. Cards sit on `shadow-sm` plus a 1px `border`; reserve `shadow-md` for things that float (popovers, sticky action bars). In the dark theme rely on `border` and `surface-200` for separation, not shadow.

**Focus, states, motion.** Draw one focus ring everywhere: 3px solid `focus-ring`, 2px offset, visible on keyboard focus only. Hover darkens a primary button to `brand-hover`; pressed moves it 1px down; disabled is 50% opacity with `not-allowed`; loading keeps the label, shows a spinner, and sets `aria-busy`. Transitions last 150ms with `ease` on color and transform only. Honour `prefers-reduced-motion` by removing transitions and slowing the spinner. Never animate width, height or the Emergency notice.

**Imagery.** Use only Patient-uploaded clinic photos (rounded `radius-md`, reserved aspect ratio so the page does not jump) and the brand marks. Do not use stock photos of smiling teeth or before-and-after shots.

**Dark theme.** Set `data-theme="dark"` or the `.dark` class. Teal lightens to `#5cc8bf` and takes dark text through `on-brand`; never put white text on it. All pairs are checked at 4.5:1 (text) and 3:1 (borders, focus, icons) in both themes.

## Iconography

Use Lucide (`lucide-react`) at 20px or 24px, stroke 1.75, `currentColor`, with a text label beside any icon that carries status or action. Icons for status are fixed: `octagon-alert` for emergency and errors, `clock` for soon, `calendar` for scheduled, `check-circle` for routine, `check` for verified, `info` for notes, `map-pin` for location and IGD search, `mic` for voice notes, `star` for ratings. Mark decorative icons `aria-hidden`. Never use emoji as icons. The brand marks are in `assets/Brand` (see its README); never redraw them, recolor them or place them on a ground other than the one their file names.

## Using the tokens in code

The app uses Tailwind v4 with shadcn/ui, so the tokens enter as CSS variables in `app.css`. Keep the shadcn names the components already use and point them at these tokens:

| shadcn variable | Token | shadcn variable | Token |
| --- | --- | --- | --- |
| `--background` | `surface-100` | `--primary` | `brand` |
| `--card`, `--popover` | `surface-200` | `--primary-foreground` | `on-brand` |
| `--foreground`, `--card-foreground` | `ink` | `--secondary`, `--accent` | `brand-tint` |
| `--muted` | `surface-300` | `--secondary-foreground`, `--accent-foreground` | `on-brand-tint` |
| `--muted-foreground` | `ink-muted` | `--destructive` | `danger` |
| `--border` | `border` | `--ring` | `focus-ring` |
| `--input` | `border-strong` | `--radius` | `radius-md` (10px) |

The status families (`success`, `warning`, `info`, each with `-soft` and `-line`) are extra variables: use `bg-warning-soft text-warning border-warning-line`. Never write a raw hex value, a Tailwind palette color (`amber-500`, `yellow-200`) or `text-white` in a component; pick a token. Set tabular figures on any element that shows money.

## Accessibility floor

Text is at least 4.5:1 against the ground it sits on, and borders, focus rings and meaningful icons at least 3:1, in both themes. Every input has a visible label (never placeholder-only), its error appears under it with an icon and `aria-describedby`, and the page keeps a skip link, one `h1`, and a footer note. The Emergency notice has `role="alert"`. Voice recording always offers a typed alternative.

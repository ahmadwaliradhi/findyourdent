The FindYourDent mark is a map pin holding a tooth: find, then dent. Use the files as they are; never redraw, stretch, recolor or add effects.

- `logo-mark.svg`: teal pin with a white tooth. The default mark on `surface-100` and `surface-200` (enamel or white grounds). Minimum 24px tall.
- `logo-mark-on-dark.svg`: mint pin with a dark tooth. Use only on the dark theme ground (`#0d1a1d`) or a photo darkened to match.
- `logo-mark-ink.svg`: ink pin with an enamel tooth, for single-colour print and faxes on a light ground.
- `wordmark.svg` and `wordmark-on-dark.svg`: the mark plus "FindYourDent" outlined from Figtree Bold (no font needed), "Dent" in the brand color. Use in the header at 28px to 32px tall, and keep clear space of half the pin width on every side. Never set the name in running text with this lockup.
- `favicon.svg` and `app-icon.svg`: the mark on a teal rounded tile with a white pin; for the browser tab and the install icon. `app-icon-maskable.svg` is the same on a full-bleed square with a safe zone, for adaptive icons.
- `apple-touch-icon.png` (180px, full-bleed), `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`: raster exports for the web manifest and iOS home screen.
- `og-image.png` (1200 by 630): the default link preview, headline in Indonesian. Make a localised copy for English rather than editing this one.

SVG files are fixed-ink: an `<img>` cannot inherit `currentColor`, so pick the variant for the ground instead of recoloring.

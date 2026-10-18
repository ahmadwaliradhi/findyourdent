# Demo video screen captures

Screen captures for the demo video (issue #111), one clip per scene of the [narration script](../narration.md), recorded on https://findyourdent.com at phone width (360 × 780 viewport, Pixel 5) with nothing mocked: real Gemini, Places, Moderation and Firestore. Each clip runs at least as long as its scene's target in the script, so it covers the narration, and starts where the scene's action starts.

| File | Scene | Shows |
| --- | --- | --- |
| `scene-1-landing.mp4` | 1. Problem | The landing page, scrolled down to a real Testimony in "Testimoni terbaru" |
| `scene-2-guidance.mp4` | 2. Guidance | A typed complaint, Gemini's follow-up question, the Guidance card down to the BPJS Kesehatan answer; then a swollen face with a fever reaching "Ke IGD sekarang" and "Cari IGD terdekat di Google Maps" |
| `scene-3-shortlist.mp4` | 3. Shortlist | "Gunakan lokasi saya" from Gubeng, Surabaya; five Providers with their reasons, the ranking note, a Provider page and "Lihat ulasan Google" |
| `scene-4-testimony.mp4` | 4. Posting a Testimony | A demo Testimony by "Demo FindYourDent": the phone number in the story, "Sedikit perbaikan sebelum terkirim", the fix, "Testimoni Anda sudah terbit", the Testimony on the Provider page |
| `scene-4-proven.mp4` | 4. Posting a Testimony | A Patient's real Proven Testimony with Kunjungan terbukti, in the feed filtered to "Hanya Kunjungan terbukti" |
| `scene-5-impact.mp4` | 5. Architecture and impact | The live "Dampak FindYourDent" counter |
| `architecture.png` | 5. Architecture and impact | The README architecture diagram as a still (3970 × 2414) |

`clips.json` lists each clip with its length and when and where it was recorded. The clips are H.264 MP4 at 720 × 1560 with no audio, but the page fills only their top-left 360 × 780 (see [composition.md](../composition.md#capture-defect)); the narration is in `../audio/`. The Scene 1 title card and the roadmap slide are rendered by `../compose.ts`, not recorded.

## Re-recording

The captures are Playwright specs in `apps/web/e2e-capture/`, so any scene can be re-recorded in a few minutes. They need what the deployed journeys need (saved Google sessions and gcloud access to the App Check debug token, see the [README](../../../../README.md)), plus `ffmpeg`:

```bash
E2E_PLACE_ID=ChIJMT_tHH351y0RFtBo4dcSmCQ pnpm --filter web capture:deployed
```

Add `--grep "scene 2"` for one scene. Scenes 1, 2, 3 and 5 need no sign-in.

Scene 4 posts a demo Testimony as "Demo FindYourDent" on the Listed Provider in `E2E_PLACE_ID` and deletes it once the clip is saved. For the demo Testimony itself to carry Kunjungan terbukti, attach a real receipt from a visit there with `CAPTURE_PROOF_PATH=/path/to/receipt.jpg CAPTURE_VISIT_MONTH=YYYY-MM` (kept outside the repository). Without one it publishes as "Belum terbukti", and `scene-4-proven.mp4` (no sign-in) supplies the Kunjungan terbukti shot. The current `scene-4-testimony.mp4` was recorded that way, with no receipt, and trimmed to end on the Provider page. Never attach an invented receipt: that would be a fake Proof of Visit on the live site. Each account may post 5 Testimonies a day and one scene 4 run sends two, so record it on a day the deployed journeys have not used up the author's quota.

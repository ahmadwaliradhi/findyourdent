# Demo video composition

The submission video (issue #24) is put together by [`compose.ts`](compose.ts) from the screen captures in [`captures/`](captures/README.md) (#111) and the narration in [`audio/`](audio/) (#110). It follows the five-scene storyboard in [`docs/specs/README.md`](../../specs/README.md#video-storyboard-3-to-4-minutes-nothing-outside-these-scenes-is-built) and the [narration script](narration.md).

```bash
node docs/submission/video/compose.ts
```

The script writes `findyourdent-demo.mp4` next to itself (1920 × 1080, H.264, 25 fps, AAC 48 kHz, loudness normalised to -16 LUFS) and its working files to `build/`. Both are gitignored, so run it again to get the file. It takes about a minute and needs `ffmpeg` and the Playwright Chromium that `apps/web` installs (`pnpm install`). The run fails if the video is shorter than 3:00 or longer than 4:00. Run the tests with `node --test docs/submission/video/`.

The issue asked for Claude Motion. That tool could not be reached from the agent session, so the composition is scripted here instead. Every shot, title and caption below is data in `compose.ts`, so changing one means editing that file and running the script again.

## What is on screen

| Scene | Length | Shots |
| --- | --- | --- |
| Opening card | 0:05 | FindYourDent, the landing page tagline, "AI Builder Cup 2026" |
| 1. Problem | 0:40 | The three SKI 2023 figures with their citations (held while the figures are spoken), then the live landing page down to "Testimoni terbaru" |
| 2. Guidance | 0:53 | A typed complaint, the follow-up question (3× speed), the Guidance card down to the cost and BPJS Kesehatan answers, then the swollen face with a fever reaching "Ke IGD sekarang" |
| 3. Shortlist | 0:29 | "Gunakan lokasi saya" (2×), five Providers with their reasons and the ranking note (1.33×), a Provider page and "Lihat ulasan Google" |
| 4. Posting a Testimony | 0:36 | The demo draft with a phone number (1.5×), "Sedikit perbaikan sebelum terkirim", the fix (4×), "Testimoni Anda sudah terbit" (2×), then a real Proven Testimony with Kunjungan terbukti |
| 5. Architecture and impact | 0:33 | The README architecture diagram, the live "Dampak FindYourDent" counter, the roadmap card ("Berikutnya": Providers claim their pages and publish their own prices) |
| Closing card | 0:06 | findyourdent.com, the Google Cloud services named in the narration, "Voice: ElevenLabs" (the free plan requires this credit) |
| Total | 3:21.8 | Measured with `ffprobe` on the exported file |

Each scene starts with 0.8 s of quiet before its narration and ends 1.5 s after it, or when its last shot ends if that is later. Product scenes show the phone capture on the left and, on the right, the on-screen Indonesian term in large type with an English line under it. The English captions are the narration lines, one sentence at a time (long sentences split at a comma). Their timing comes from each line's share of the characters, moved to the nearest pause that `silencedetect` finds in the voice track.

The demo Testimony in scene 4 is labelled on screen as posted by the demo account "Demo FindYourDent" and deleted after recording. It published as "Belum terbukti" because no real receipt was attached, so the Kunjungan terbukti shot is a real Patient's Testimony on findyourdent.com, labelled as such. All figures are the verified SKI 2023 wording from H03.

## Capture defect

The #111 clips are 720 × 1560, but the page only fills their top-left 360 × 780; the rest is grey. `compose.ts` crops that area and scales it up, so the phone screen is a 360 px wide recording shown at about 1.13×. It is readable, but sharper captures would need the capture specs re-recorded with the page filling the frame (for example a device scale factor of 2).

## Before submitting

These steps need the product owner:

1. Watch the whole file once for timing and anything outside the storyboard.
2. Upload it publicly from the product owner's account: YouTube unlisted, or a Drive file shared as "anyone with the link". Put "Voice: ElevenLabs" in the description too.
3. Open the link in a logged-out browser and post it on issue #24.

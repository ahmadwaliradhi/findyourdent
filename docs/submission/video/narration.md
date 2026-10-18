# Demo video narration

Narration for the AI Builder Cup 2026 demo video (issue #110), on the five-scene storyboard in [`docs/specs/README.md`](../../specs/README.md#video-storyboard-3-to-4-minutes-nothing-outside-these-scenes-is-built). The rules require 3 to 4 minutes that clearly show the working prototype, so the scene targets add up to 3:35, leaving margin on both ends. Each scene names the on-screen action its narration covers, so the screen capture can be recorded to it.

Every figure is from the verified SKI 2023 wording (H03, [comment on #3](https://github.com/ahmadwaliradhi/findyourdent/issues/3#issuecomment-6230566365)); the claim in scene 1 is the differentiator sentence from the spec, word for word. Indonesian UI terms are spoken exactly as they appear on screen. Everything else is checked against the [README](../../../README.md) and the live build's copy.

Narration lines (the `>` blocks) are what `narrate.ts` sends to ElevenLabs, so they hold plain spoken text only: no Markdown, numbers written the way they should be said.

## Scene 1: Problem (target 0:40)

**On screen:** title card with the three SKI 2023 figures and their citations (Tabel 9.5, BKPK factsheet, Tabel 9.7), then the findyourdent.com landing page scrolled to a real Testimony card in "Testimoni terbaru".

**Narration:**

> In the Survei Kesehatan Indonesia 2023, 56.9 percent of Indonesians aged three and over had a dental or oral problem in the past year. Yet only 11.2 percent of them were treated by dental health workers. Among people not treated by a dental health worker, 57 percent said they felt no need.
> FindYourDent turns a toothache into a guided decision. A grounded Gemini agent explains urgency, the visit journey, cost and BPJS coverage, then shortlists Providers ranked by Patient Testimonies that FindYourDent owns, each one screened by AI and checked against proof of visit.

## Scene 2: Guidance (target 1:00)

**On screen:** on the home page, type a complaint into "Ceritakan keluhan gigi Anda" (or record one with "Rekam pesan suara") and tap "Lihat panduan". The Guidance card "Panduan untuk keluhan Anda" appears: Tingkat urgensi, Kemungkinan masalah, Perkiraan kunjungan, Perkiraan biaya with "Mengapa harganya berbeda-beda", and the BPJS Kesehatan answer. Then a second complaint with a swollen face and a fever: the "Ke IGD sekarang" card with "Tanda bahaya yang terdeteksi" and "Cari IGD terdekat di Google Maps".

**Narration:**

> A Patient describes the problem in their own words, typed or as a voice message, in Bahasa Indonesia, a regional language, or English, and taps Lihat panduan.
> Gemini on Vertex AI answers with a Guidance card: how urgent it is, the likely problem, how many visits to expect, an estimated cost with why prices vary, and whether BPJS Kesehatan covers it. Cost and BPJS answers come from curated knowledge files that cite their source, not from the model.
> Now a harder case: a swollen face and a fever. A deterministic red-flag check runs before Gemini, and the model can never lower its urgency. The Patient sees Ke IGD sekarang: go to the emergency department now, with the nearest IGD one tap away on Google Maps.

## Scene 3: Shortlist (target 0:35)

**On screen:** back on the first Guidance card, tap "Lihat dokter gigi terdekat", then "Gunakan lokasi saya". The Shortlist "Dokter gigi terdekat untuk keluhan Anda" lists up to five Providers, each with its reasons and the note "Tidak pernah berdasarkan bayaran". Open one Provider page and tap "Lihat ulasan Google".

**Narration:**

> Next, Lihat dokter gigi terdekat. The Shortlist shows up to five nearby Providers, each with the reasons it fits this complaint: the procedure it handles, its Testimony scores, and how far away it is. Providers are ranked by fit, Testimonies, price and distance, never by payment.
> On a Provider page, Patients read Testimonies first. Google reviews load only when they tap Lihat ulasan Google.

## Scene 4: Posting a Testimony (target 0:45)

**On screen:** "Ceritakan pengalamanmu": ratings, a story that includes a phone number, and a receipt attached as "Bukti kunjungan". Tap "Kirim", sign in with Google, and the fix prompt "Sedikit perbaikan sebelum terkirim" marks the sentence with the phone number. Remove it, tap "Kirim" again, and the result "Testimoni Anda sudah terbit" says the Testimony carries Kunjungan terbukti.

**Narration:**

> Patients give back by posting a Testimony with Ceritakan pengalamanmu. Google sign-in happens only when they tap Kirim.
> This draft includes a phone number. Gemini Moderation checks every Testimony against fixed rules before it is published, so instead of a silent rejection the Patient sees Sedikit perbaikan sebelum terkirim, with the exact sentence to fix. They remove the number and send again.
> The receipt they attached as proof of visit is checked, then deleted, and the Testimony is published with Kunjungan terbukti.

## Scene 5: Architecture and impact (target 0:35)

**On screen:** the architecture diagram (Firebase Hosting, the web and agent Cloud Run services in Jakarta, Gemini on Vertex AI, Firestore, App Check), then the live "Dampak FindYourDent" counter on the landing page, then the roadmap slide (Providers and clinics).

**Narration:**

> Under the hood, Firebase Hosting sits in front of two Cloud Run services in Jakarta: the public web service, and a private Google ADK agent service that only the web service can call. Firestore stores Providers and Testimonies, never a Patient's complaint.
> The live counter shows Testimonies, Kunjungan terbukti and Guidance sessions as they grow. Next, Providers and clinics claim their pages and publish their own prices.
> FindYourDent, live now at findyourdent dot com.

## Voice and audio

- Voice: ElevenLabs premade "River" (`SAz9YHcvj6GT2YYXdXww`, neutral, American English), the default until the product owner picks another. Override with `ELEVENLABS_VOICE_ID`.
- Model: `eleven_multilingual_v2`, so the Indonesian UI terms are pronounced as Indonesian.
- Credit: the free plan requires attribution, so the end card or video description must say "Voice: ElevenLabs".
- Files: `audio/scene-1.mp3` to `audio/scene-5.mp3` next to this script (MP3, 44.1 kHz, 128 kbps).

Regenerate only the scenes that changed (the free tier has 10,000 characters a month):

```bash
node docs/submission/video/narrate.ts 2 4
```

With no scene numbers it generates all five. The key comes from `ELEVENLABS_API_KEY` in the environment, or from the gitignored `.env.local` at the repository root; it is never printed.

## Measured durations

Measured with `ffprobe` on the generated files. Scene targets leave room for on-screen actions between lines.

| Scene | Target | Narration | Characters |
| --- | --- | --- | --- |
| 1. Problem | 0:40 | 0:38 | 570 |
| 2. Guidance | 1:00 | 0:51 | 712 |
| 3. Shortlist | 0:35 | 0:25 | 393 |
| 4. Posting a Testimony | 0:45 | 0:30 | 523 |
| 5. Architecture and impact | 0:35 | 0:31 | 471 |
| Total | 3:35 | 2:55 | 2,669 |

Generated 18 October 2026 with River on `eleven_multilingual_v2`, 2,669 of the free tier's 10,000 monthly characters. Scene 1 has the least slack (2 seconds), so hold the figures card on screen while it plays.

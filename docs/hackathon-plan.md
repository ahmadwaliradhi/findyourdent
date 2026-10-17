# FindYourDent hackathon plan: steps 1 and 2 (decision document)

Written Friday 16 October 2026, 16:00 WIB, from [docs/hackathon-brief.md](hackathon-brief.md). Submission deadline is Sunday 18 October 2026. The official site gives the date only, no time of day and no time zone (checked today on aibuildercup.com). This plan submits by Sunday 18:00 WIB and treats everything after that as buffer.

Nothing in this document is application code. Steps 3 to 8 start only after the decisions in section 6 are made.

## 0. Three gates before anything else

| Gate | Fact checked today | What you must confirm |
|---|---|---|
| Eligibility | Registration closed 11 October, team formation closed 14 October (aibuildercup.com index and FAQ). Teams of 2 to 4, all 21+, all working professionals, all in JAPAC. "If any member of a team is a student, the entire team will be disqualified." | The team already exists on the Hack2skill dashboard with 2 to 4 members, and every member meets all three conditions. If the team was not formed by 14 October there is no submission path and all work below stops. |
| Deadline time | "Prototype submission deadline: Oct 18, 2026." No time zone published. Hack2skill is India-based, so the cut-off could be 23:59 IST (01:29 WIB Monday) or earlier. | Log in to the Hack2skill dashboard tonight and record the countdown timer. If it ends before Sunday 12:00 WIB, apply the kill criteria in risk 2. |
| Fresh code | Repository initial commit is 16 October 2026 09:24 WIB, inside the 7 September to 18 October window. The idea predates the hackathon; the code does not, and findyourdent.com was registered on 17 October 2026 (whois). | Say so in the deck in one line. |

## 1. Challenge

### 1.1 The strongest case against the hypothesis

Hypothesis under test: "Sakit gigi, then understand, then a verified, price-transparent, BPJS-aware shortlist near me."

1. **It solves the wrong bottleneck.** Secondary citations of Survei Kesehatan Indonesia 2023 put dental and oral problems at about 57% of the population and professional dental care at about 11%, with most people saying they felt no need for care (figures to be verified against the BKPK tables in step 8). Surabaya has hundreds of dentists on Google Maps with hours, photos, ratings and WhatsApp numbers. Finding a dentist is not the scarce step. Deciding whether to go, and knowing what it will cost, is. A directory of 30 to 50 seeded clinics loses to Google Maps on coverage and on social proof. *Implication:* the "understand" step is the product. The shortlist must be short (three), explained, and derived from the triage, or it is a worse Google Maps.

2. **"Price-transparent" overclaims.** Dental prices depend on a diagnosis made after examination and usually a radiograph. A filling varies by material, number of surfaces and whether the pulp is involved; a root canal by the number of canals and whether a crown follows. Dentists resist publishing single numbers, and a published number that is wrong at the chair creates the disappointment the product promised to remove. *Implication:* show a price band per procedure, taken from the clinic's own list, with source and last-updated date, next to the agent's explanation of why it varies. Never a single price. Show the consultation or examination fee separately, because that number is reliable.

3. **"BPJS-aware" and "near me" contradict each other.** JKN primary dental care is delivered at the member's registered FKTP (a puskesmas, a klinik pratama, or a partnered dokter gigi praktik perorangan), not at any nearby clinic. Members can change FKTP through Mobile JKN, but the change takes effect later, not today (confirm the rule in step 4). Covered at FKTP: examination and consultation, premedication, oro-dental emergencies, deciduous extraction, uncomplicated permanent extraction, post-extraction medication, composite or GIC fillings, scaling with a medical indication at a limited frequency (sources read today disagree between once a year and once in two years), and a capped prosthesis subsidy. Root canal treatment and orthodontics are not FKTP benefits. *Implication:* BPJS-awareness is a property of the problem and procedure (covered at your FKTP, needs a referral, or private only), and the agent's job is to tell the patient which door to use. "Mitra BPJS" on a nearby clinic is a secondary flag ("you could register here"), not a filter.

4. **Supply side is zero on day one.** No real dentist will claim a profile and upload a price list before Sunday. Any seeded price is team-entered. Presented as real, it is a fabricated record, and a judge who checks one clinic by phone can end the entry. *Implication:* every seeded number carries provenance ("daftar harga dikirim klinik via WhatsApp, 17 Okt 2026" or "contoh"), and the deck states how many price lists are real.

5. **"Verified" may be thinner than it sounds.** Checked today: the KKI homepage exposes a public "Cek Named & Nakes" search by name or STR number, so STR checks are feasible by hand. Data Fasyankes Online shows no public search; its homepage says published data appears on the Ditjen Yankes portal, which did not resolve from here. BPJS partner status is visible in Mobile JKN, not through an API. *Implication:* the badge must say exactly what was checked and when ("STR cocok di KKI, 17 Okt 2026"). Anything not checked is "belum diverifikasi". The deck reports the match rate (step 7).

6. **It is a clinical-adjacent system with a two-day eval budget.** A "can wait" on a spreading infection is harm. The emergency rule must be deterministic and run before the model. The evaluation set must be labeled by a licensed dentist who is not on the team, and finding one by Sunday is itself a risk. *Implication:* build the rule layer first; recruit the labeling dentist tonight; if no external labeler lands, the deck says "team-labeled" rather than implying otherwise.

7. **Parity risk.** Alodokter and Halodoc offer chat with a human doctor and dentist directories with booking. Google Maps offers "near me" with reviews. Google Search increasingly answers "sakit gigi harus ke mana" directly. A chat box that ends in cards looks like all three with a Gemini wrapper. *Implication:* the visible difference must be structured and on screen within the first minute of the video: urgency tier, visit journey, cost band with provenance, BPJS door, emergency rule, and a pre-visit summary the patient can send to the dentist. If the demo shows a conversation and a list, the 25% for innovation is gone.

### 1.2 The strongest case against the three-sided platform thesis

1. **Three cold starts, not one.** Patients visit a dentist once or twice a year and will not pay for discovery. Private dentists are constrained in how they can be promoted: KODEKGI 2020 and MKEK Fatwa 29/2021 restrict advertising, and payment per lead is likely to be read as a referral fee, which the code treats as unethical (exact articles to be confirmed in the step 7 ethics review). Clinics buy management software in a compliance market: PMK 24/2022 makes electronic medical records and SATUSEHAT integration mandatory, and vendors such as Klinik Pintar and Trustmedis already sell that. Each side has a different buyer, sales motion and regulator.

2. **The clinic-management side pulls the company off its wedge.** Building for clinics means building RME and SATUSEHAT integration, which has nothing to do with triage or price transparency and competes with incumbents on their own ground.

3. **Adverse selection on price.** Clinics that publish price lists are the ones competing on price. Premium clinics will not list. The verified directory then skews cheap and the badge becomes a budget signal.

4. **Clean monetisation is small.** Ads and promoted placement are what the fatwa forbids dentists from doing. Per-lead fees look like fee-splitting. What remains is a subscription for a verified profile and price-list hosting, a small ticket multiplied by a few thousand dentists.

5. **Google owns the top of the funnel.** A toothache is a search moment. Without a reason to return (the recall reminders live in the CRM this plan cuts), the product is a landing page that Google can answer above.

What the deck should say instead: a two-sided wedge (patients, and dentists or clinics as one supply side), with the clinic layer as a roadmap whose first object already exists in the demo: the pre-visit summary the patient sends on WhatsApp is the clinic's intake note. The roadmap then follows from the demo instead of being asserted next to it.

### 1.3 What survives: the revised hypothesis

"Sakit gigi, tahu dulu, pilih pintu, shortlist tiga, kirim ringkasan."

- The agent, not the directory, is the product. Its output is a structured card: urgency tier, likely problem category, single-visit or multi-visit journey, why prices vary, cost band, BPJS door, sources.
- "Price-transparent" becomes "price band with provenance", from the clinic's own list, dated.
- "BPJS-aware" becomes door logic on the procedure plus an FKTP partner flag on clinics.
- "Near me" applies to the private door only.
- The shortlist has three entries and ends in two actions: chat on WhatsApp with a prefilled pre-visit summary, or open in Google Maps.

### 1.4 The riskiest assumption and the cheapest 2-hour test

**Riskiest assumption:** dentists and clinics in Surabaya have a price list in some form and will share it and let us display it. If this is false, "price-transparent" collapses into generic cost bands anyone can copy, scene 4 of the video runs on a made-up document, and the business case for the supply side is unsupported.

**Test (2 hours, tonight, owner P with D):** send an honest WhatsApp message to 10 clinics or dentists in Surabaya, own network first, then public business numbers taken from the clinics' own websites or Instagram bios. Ask for their daftar harga as a PDF or photo, permission to show it with their name on a prototype for three weeks, and offer to send back the extracted table for correction.

Suggested message (Indonesian):

> Selamat sore, Dok. Saya [nama] dari tim FindYourDent, kami sedang membangun prototipe untuk kompetisi Google Cloud AI Builder Cup (deadline Minggu). Prototipe ini membantu pasien memahami keluhan gigi dan melihat kisaran biaya tindakan dari daftar harga klinik, lengkap dengan sumber dan tanggalnya. Boleh kami minta daftar harga klinik Dokter (foto atau PDF cukup), dan apakah boleh kami tampilkan dengan nama klinik di prototipe selama tiga minggu masa penilaian? Kami akan kirim balik hasil ekstraksinya untuk dikoreksi. Terima kasih banyak.

Measures: replies within 2 hours, price lists received, consents to display. Thresholds:

| Result by 20:00 WIB | Read | Consequence |
|---|---|---|
| 4 or more lists, 2 or more consents | Assumption holds | Scene 4 runs on real lists with clinic names; cost bands derive from real lists |
| 1 to 3 lists | Weak but usable | Scene 4 runs on real lists; display anonymised ("Klinik A, Surabaya Timur") unless consented |
| 0 lists | Assumption fails | Cost bands derive from the procedure table (dentist interview answers plus published public tariffs); scene 4 runs on a sample list watermarked "contoh" and shrinks to 15 seconds; deck states zero real lists |

Side benefit: the same conversations are the dentist Mom Test material for step 6 and the real input documents for the extraction demo.

### 1.5 Ranked decision table

Score per criterion is 1 to 5 for how much a well-built version of the feature would earn under that criterion. Weighted score = 0.40 x Technical + 0.25 x Impact + 0.25 x Innovation + 0.10 x UX. Confidence is the probability of finishing it to demo quality inside 48 hours with this team. Final = weighted x confidence.

| Rank | Feature | Tech (40%) | Impact (25%) | Innov (25%) | UX (10%) | Weighted | Conf. 48h | Final |
|---|---|---|---|---|---|---|---|---|
| 1 | Triage agent: ADK on Gemini, deterministic emergency rule, structured JSON, grounding in PPK and BPJS rules, eval gate | 5 | 4 | 4 | 4 | 4.40 | 0.80 | **3.52** |
| 2 | Price-list upload with Gemini extraction and provenance (sign-in only, no identity verification) | 4 | 3 | 4 | 3 | 3.65 | 0.70 | **2.56** |
| 3 | Verified directory: 30 to 50 seeded Surabaya entries, STR checked by hand, place IDs only | 3 | 4 | 2 | 4 | 3.10 | 0.60 | **1.86** |
| 4 | Public free-text reviews | 2 | 2 | 1 | 3 | 1.85 | 0.50 | 0.93 |
| 5 | Patient CRM | 2 | 2 | 1 | 2 | 1.75 | 0.40 | 0.70 |

Reading the table:

- The agent carries the entry. It is the only feature that scores 5 on the 40% criterion and it is the one judges will click first.
- Price-list extraction ranks second because it is real, non-superficial Gen AI (multimodal document extraction into a schema with provenance) and it is the mechanism that makes price data legal and fresh. It is scoped to an upload-and-confirm page behind Google sign-in, not a self-serve claim workflow.
- The verified directory ranks third standalone, but the agent needs it to produce a shortlist. It is scoped to the minimum the storyboard needs: enough verified entries that each demo triage outcome has three relevant cards. Seed 30 to 50, verify as many as the KKI search allows, and report the match rate honestly.
- Reviews and CRM score below one point each and carry legal exposure (UU ITE, Permenkominfo 5/2020 takedown duties, UU 27/2022 for patient records). They are cut.

### 1.6 Recommendation

**Build one flow, end to end, on seeded Surabaya data:**

1. Landing with consent (education and navigation, not diagnosis; symptom text not kept after the session), Indonesian and English.
2. Triage: free-text complaint, at most two follow-up questions, result card or emergency card.
3. Shortlist of three: verified badge stating what was checked, price band with provenance, BPJS partner flag, distance, WhatsApp, Google Maps link.
4. "Kirim ringkasan": WhatsApp deep link with the prefilled pre-visit summary.
5. Supply side: one page where a signed-in clinic uploads a price list, Gemini extracts it, the clinic confirms, every field stores source and date.
6. An /eval page showing the evaluation results table from the committed results file.

**Cut:** patient CRM, public reviews, Google reviews display, booking and payments, self-serve identity verification, clinic management, multi-city, voice input, nearby unverified Google results, photo-of-tooth triage. Section 5 gives the reason for each.

## 2. Demo storyboard

Rules: English voice-over, Indonesian on screen with burned-in English captions, target length 2:50, hard ceiling 2:59. Every claim in the script that depends on a result is a placeholder in square brackets and is spoken only if the result exists. Nothing outside this script gets built.

### 2.1 Script

**Scene 1. "Sakit gigi, lalu bingung" (0:00 to 0:30). Rubric: Problem Alignment & Impact.**

On screen: a phone. A WhatsApp-style message to a friend: "Gigi geraham kiri bawah nyut-nyutan 3 hari. Ke mana ya? Mahal nggak? BPJS bisa?" Cut to three stat cards (figures verified against the SKI 2023 report before recording, otherwise replaced by Riskesdas 2018 figures with the year shown): dental or oral problem prevalence, share receiving professional care, share who felt no need. One patient quote from the step 6 interviews, with first name and age.

Voice-over (68 words): "In Indonesia, more than half of adults have a dental problem. About one in ten sees a dentist. Ask why, and you hear the same three things: I don't know how urgent it is, I don't know what it will cost, and I don't know whether BPJS will pay. So people wait, until the pain decides for them. FindYourDent starts at that moment."

**Scene 2. "Tahu dulu" (0:30 to 1:15). Rubric: Technical Merit & Gen AI Implementation.**

On screen: the triage screen. The user types the complaint above in Indonesian. The agent asks one follow-up: "Ada bengkak di pipi atau demam?" The user answers "Tidak." The result card renders field by field: Urgency "Segera: dalam 1 sampai 3 hari"; Likely category "Kemungkinan radang saraf gigi (pulpitis)"; Journey "Biasanya 2 sampai 3 kunjungan: perawatan saluran akar, lalu tambal atau mahkota"; Why prices vary (three bullets: jumlah saluran akar, bahan tambalan atau mahkota, perlu rontgen); Cost band "Rp 800 rb sampai 2,5 jt, dari daftar harga [N] klinik Surabaya"; BPJS door "Perawatan saluran akar tidak ditanggung di FKTP. Pencabutan ditanggung di FKTP tempat kamu terdaftar"; Sources "PPK Dokter Gigi 2022, aturan manfaat JKN". Quick cut: a second user types "Pipi bengkak, demam, susah buka mulut." A red card: "Ke IGD sekarang", the reason in one line, the nearest hospital emergency department with a Maps link.

Voice-over (100 words): "You describe it in your own words. An agent built with Google's Agent Development Kit and Gemini on Vertex AI asks only what matters, then answers in a structure, not a paragraph: how urgent, what this usually is, how many visits it takes, why prices differ, a cost band, and which door to use, BPJS or private. Every answer is grounded in the Ministry of Health's clinical practice guideline for dentists and the national insurance benefit rules. And one rule runs before the model: swelling with fever, or trouble swallowing or opening your mouth, goes straight to the emergency room."

**Scene 3. "Pilih, bukan cari" (1:15 to 1:55). Rubric: Innovation & Creativity.**

On screen: "Shortlist untukmu". Three cards. Card elements: clinic name and district; "Terverifikasi" badge, tapped once to show "STR cocok di KKI, 17 Okt 2026"; price band for the relevant procedure, "Rp 1,2 sampai 1,8 jt, dari daftar harga klinik, diperbarui [date]"; "Mitra BPJS (FKTP)" on one card; distance; buttons "Chat WhatsApp" and "Buka di Google Maps". Tap "Kirim ringkasan": WhatsApp opens with the prefilled summary (complaint, urgency, likely procedure, three questions to ask the dentist). Lower third: "Bukan direktori. Shortlist adalah hasil triase kamu."

Voice-over (80 words): "Instead of two hundred pins on a map, you get three. Each one is checked against the dentist registry, shows a price band from the clinic's own price list with the date it was updated, and says whether it's a BPJS partner. The shortlist isn't a directory; it's the output of your triage. One tap sends the dentist a summary of your complaint before you arrive, so the first visit starts with the right questions."

**Scene 4. "Sisi dokter gigi" (1:55 to 2:25). Rubric: Technical Merit, Google Cloud architectural depth (also the "Best use of Google Cloud AI tools" side award).**

On screen: the upload page. A clinic drops a photo of its price list. Gemini returns a table: procedure, price minimum, price maximum, unit, notes, confidence per row. The clinic corrects one row and taps "Konfirmasi". A field detail shows "Sumber: daftar harga klinik (foto), diunggah 17 Okt 2026, dikonfirmasi drg. [name]". Cut to the architecture diagram: Next.js PWA on Cloud Run; ADK agent service on Cloud Run with Gemini on Vertex AI; Firestore; Cloud Storage; Vertex AI Search datastore over the PPK and BPJS rules; Places API (New) for place IDs and Maps links; Vertex AI Gen AI Evaluation and adk eval; Cloud Logging and Monitoring.

Voice-over (78 words): "The supply side is just as simple. A clinic uploads the price list it already has; a photo is enough. Gemini extracts every line into structured fields, the clinic confirms, and every number keeps its source and date. Under the hood: a progressive web app and the ADK agent run on Cloud Run, Firestore holds first-party data, Vertex AI Search grounds the agent in the guideline, Places API provides location by place ID only, and Vertex AI evaluation scores every release."

**Scene 5. "Bukti" (2:25 to 2:50). Rubric: Problem Alignment & Impact, with User Experience shown through the unaided test.**

On screen: the eval table (40 cases, 8 emergencies, 5 adversarial; emergency recall [100%]; urgency-tier accuracy [X%]; unsafe medication advice [0]; labeled by [a licensed dentist outside the team or the team, whichever is true]). The user-test line: "[5] orang, median [m:ss] sampai shortlist, tanpa bantuan." One dentist quote from step 6. One line of roadmap: "Pasien, lalu dokter gigi, lalu klinik: ringkasan pra-kunjungan menjadi catatan intake klinik." End card: findyourdent.com, "Tahu dulu, baru pilih."

Voice-over (60 words): "We tested it before we shipped it. Forty Indonesian-language cases, labeled by [a licensed dentist outside the team]: every emergency caught. [Five] people reached a shortlist unaided in under [two] minutes. A dentist told us: [quote]. This is the first flow of a platform for patients, dentists and clinics. FindYourDent. Know first, then choose."

Total voice-over about 386 words, about 2:35 at a measured pace, leaving 15 seconds for pauses and the end card.

### 2.2 Screens the script needs

| # | Screen | Route | States | Data | Scene |
|---|---|---|---|---|---|
| 1 | Landing and consent | `/` | language from browser with ID/EN toggle; consent text; three example complaint chips | copy only | 2 |
| 2 | Triage chat | `/triage` | typing; agent follow-up (max 2); loading; model error fallback ("coba lagi" plus the red-flag checklist) | agent API | 2 |
| 3 | Result card | `/triage` | normal; emergency (red, with nearest ER list) | structured JSON from the agent; ER seed | 2 |
| 4 | Shortlist | `/shortlist` | three cards; empty state when no verified clinic lists the procedure (show nearest verified with "harga belum tersedia") | clinics, price items, verification records, distance | 3 |
| 5 | Verification popover | on card | what was checked, when, by whom | verification records | 3 |
| 6 | Send summary | WhatsApp deep link | prefilled text | summary built from the result card | 3 |
| 7 | Price-list upload and review | `/klinik/daftar-harga` | signed out; upload; extracting; review and edit; confirmed | Gemini extraction output; Cloud Storage object; Firestore write with provenance | 4 |
| 8 | Eval results | `/eval` | static table | committed eval results JSON | 5 |

Non-app visuals: three stat cards, architecture diagram, two quotes, end card. Built in the deck tool, not in the app.

### 2.3 Data the script needs

| Data | Source | Owner | Needed by | Notes |
|---|---|---|---|---|
| SKI 2023 oral health figures | BKPK report tables | P | Sun 10:00 | Verify the exact table; if not found, use Riskesdas 2018 with the year shown |
| Procedure knowledge table: 12 to 15 complaint categories with urgency rules, journey, why prices vary, BPJS door, PPK reference | PPK Dokter Gigi 2022 (Kepmenkes HK.01.07/MENKES/1186/2022), JKN benefit rules | E1 with P | Sat 10:00 | Curated JSON in the repo; the Vertex AI Search datastore indexes the PPK PDF for citations |
| Emergency rule set | PPK plus clinical consensus, reviewed by the labeling dentist | E1 | Fri 24:00 | Deterministic, runs before the model: facial swelling with fever, trismus, dysphagia, uncontrolled bleeding, trauma with a knocked-out permanent tooth, breathing difficulty |
| Cost bands per procedure, Surabaya | Dentist-supplied lists from the 2-hour test, dentist interview answers, published public tariffs | P, D | Sat 18:00 | Each band records which sources produced it |
| Seed clinics, 30 to 50, Surabaya | Own network; clinic websites and Instagram bios for name, address, phone (read by hand, not scraped); place ID from Places API (New) Text Search; coordinates typed from the clinic's own published address | D | Sat 18:00 | Store only the place ID from Google; everything else first-party |
| Verification records | KKI "Cek Named & Nakes" search by dentist name; registration documents the clinic sends; BPJS partner status from the clinic's own statement cross-checked in Mobile JKN | D | Sat 18:00 | Store: what was checked, result, who, when |
| Real price lists | 2-hour test replies | P, D | Fri 22:00 | Consent recorded per list |
| Evalset: 40 Indonesian cases, 8 emergencies, 5 adversarial or off-topic | Written by the team Sat morning; labeled by an external licensed dentist | E1, P | Labels by Sun 08:00 | Hold out 10 cases that nobody tunes on |
| Eval results | adk eval and Vertex AI Gen AI Evaluation | E1 | Sun 12:00 | Committed as JSON; rendered at /eval and in the README |
| Interview quotes | 5 patients and 3 dentists on WhatsApp | P | Sun 10:00 | With consent to quote by first name |
| User-test timings | 5 people, unaided, time from first message to shortlist | P, D | Sun 11:00 | Screen-recorded with consent |
| Emergency department list, 5 Surabaya hospitals | Hospital websites, place IDs | D | Sat 18:00 | Only for the emergency card |
| Architecture diagram | Team | E2 | Sun 10:00 | Matches what is deployed, not what was planned |

## 3. 48-hour plan in half-day blocks

Owners: **P** product lead (you): decisions, outreach, interviews, deck, narration. **E1** agent and backend. **E2** PWA, deploy, Lighthouse. **D** data, verification, video. With a team of two, P takes D and E1 takes E2. Claude sessions do the heavy lifting on E1 and E2 under human review; the owners listed are the humans accountable.

| Block | When (WIB) | P | E1 | E2 | D |
|---|---|---|---|---|---|
| 0 | Fri 16:30 to 20:00 | Confirm eligibility and deadline countdown; approve scope; run the 2-hour test; send Mom Test questions to 5 patients and 3 dentists; start recruiting the labeling dentist | GCP project, billing, Vertex AI, Firestore, Cloud Run, Cloud Storage, Places API (New), Firebase project, service accounts, secrets | Repo scaffold: Next.js PWA with ID/EN, design tokens, Cloud Run deploy; "hello world" live on a Cloud Run URL by 20:00 | Seed sheet started: clinic name, district, type, phone source |
| 1 | Fri 20:00 to 24:00 | Collate test results; pick the scene 4 variant; confirm labeling dentist | ADK agent v0: emergency rule tool, structured output schema, curated knowledge JSON for 10 categories; runs locally | Screens 1 to 3 on mock JSON; PWA manifest and service worker | KKI STR checks for the first 15 seeds; place IDs; ER list |
| 2 | Sat 08:00 to 13:00 | Write the 40-case evalset with D; send to the labeler by 13:00; interviews continue | Grounding (Vertex AI Search datastore over the PPK PDF and BPJS excerpts, curated JSON as fallback); tools cost_band, bpjs_door, find_clinics; agent service on Cloud Run | Shortlist screen, verification popover, WhatsApp summary link, Maps link | Firestore seed import: clinics, verification records, price items with provenance |
| 3 | Sat 13:00 to 18:00 | Dentist interviews; deck outline; pick quotes | Price-list extraction endpoint (Gemini structured output, Cloud Storage upload); run on the real lists | Upload and review screen with Google sign-in; **end to end on Cloud Run by 18:00** | Finish verification of all seeds; record the match rate |
| 4 | Sat 18:00 to 23:00 | Final video timings; narration test; user-test recruiting for Sunday | Eval run 1 (team labels if external labels not back); Vertex AI Gen AI Evaluation safety run; fix emergency recall first | Lighthouse PWA and accessibility to 90 or above; /eval page; error states | User-test script; record screen clips for scenes 2 to 4 |
| 5 | Sun 08:00 to 13:00 | 5 unaided user tests with D; results table | Eval run 2 with external labels; freeze the agent; commit results JSON; README eval table | Final deploy; smoke test from a phone on mobile data; repo audit for third-party content and secrets; README | Screen captures; voice-over recording; rough cut |
| 6 | Sun 13:00 to 18:00 | Deck final: architecture, eval, evidence, business case, "not Alodokter, Halodoc or Google Maps" slide; checklists marked pass or fail; **submit by 18:00 and screenshot the confirmation** | Freeze | Keep one warm instance on the agent service; verify the URL from an external network | Final cut under 2:59; upload; link in the submission |
| 7 | Sun 18:00 to deadline | Buffer. No new features. Uptime watch only. | | | |

## 4. Risk register with kill criteria

| # | Risk | Early signal | Mitigation | Kill criterion: what stops or is dropped | Owner |
|---|---|---|---|---|---|
| 1 | Team not formed by 14 October, or a member is a student or outside JAPAC | Hack2skill dashboard tonight | None available | No team: stop all work, nothing can be submitted. Ineligible member: cannot be replaced now, stop. | P |
| 2 | Deadline earlier than Sunday 23:59 IST | Countdown on the dashboard | Submit Sunday 18:00 WIB | Countdown ends before Sunday 12:00 WIB: drop scene 4 build and the user tests, submit what runs at Sunday 08:00 | P |
| 3 | 2-hour test returns zero price lists | Fri 22:00 | Interview answers and public tariffs for bands | Zero lists: scene 4 runs on a watermarked sample, cost bands come from the procedure table, deck states zero real lists | P |
| 4 | No external dentist labeler | Sat 13:00 | FKG alumni, PDGI Surabaya contacts, the interviewed dentists; offer credit in the deck | None by Sun 08:00: eval runs on team labels and the deck and README say "team-labeled" | P |
| 5 | Emergency recall below 100% | Sat 23:00 eval run | Deterministic rule before the model; keyword and model classifier in redundancy | Still below 100% at Sun 10:00: add a mandatory three-question red-flag checklist before free text and re-run; still failing: remove the urgency tier from the output and ship the checklist only | E1 |
| 6 | Urgency-tier accuracy below 85% | Same | Knowledge table and prompt fixes on the 30 tuning cases only | Below 85% at freeze: report the real number; no tuning on the 10 held-out cases | E1 |
| 7 | Registry checks fail for most seeds | Sat 18:00 match rate | KKI name search; ask clinics for registration documents in the outreach | Below 50% matched: badge reads "STR dicek" only where matched, "belum diverifikasi" elsewhere; deck reports the rate | D |
| 8 | Vertex AI, Cloud Run or Places quota or billing blocks | Fri 20:00 hello-world deploy | Enable everything in block 0 | Agent not deployable by Sat 18:00: run the agent inside the Next.js service with the Vertex AI SDK; ADK is dropped only as the last resort and the deck says so | E1, E2 |
| 9 | Vertex AI Search datastore not indexed in time | Sat 11:00 | Curated JSON with PPK citations as fallback | Not indexed by Sat 13:00: ship the curated JSON, keep the datastore as "planned" in the diagram, not as built | E1 |
| 10 | Video over three minutes | Sun 15:00 rough cut | Script timed at 2:35 of narration | Over 2:59: cut scene 4 to 15 seconds, then the scene 1 stat cards | D |
| 11 | Third-party content in the public repo (logos, scraped data, copyrighted PDFs) | Sun repo audit | Place IDs only; PPK PDF indexed from a private bucket, not committed; no clinic logos | Any doubt: remove and link by URL | E2 |
| 12 | Symptom text persisted or logged (UU 27/2022) | Design review | No persistence by default; session id only; evalset is synthetic; request bodies excluded from Cloud Logging | Any prompt found in logs: disable request logging before submission | E1 |
| 13 | A dentist-facing element reads as promotion (MKEK Fatwa 29/2021, KODEKGI 2020) | Sun ethics review | No ratings, no "promoted", no "terbaik"; ordering by relevance tier then distance; price and credentials only | A dentist interviewee objects to price display: anonymise that list | P |
| 14 | Scope creep | Daily | The storyboard is the spec | Anything not in section 2 is rejected without discussion | P |
| 15 | Numbers that look fabricated | Demo review | Every number carries provenance; "contoh" watermark on samples | A number without a source is deleted | D |
| 16 | Cold start or outage during 19 October to 6 November | Cloud Monitoring uptime check | One warm instance on the agent service | Budget pressure: keep the warm instance on the agent service only | E2 |
| 17 | Judges land on a page in Indonesian they cannot read | Deployed URL review | Language from the browser setting with a visible toggle; agent answers in the user's language | Toggle not working by Sat 23:00: default to English and show "Bahasa Indonesia" as the toggle | E2 |

## 5. Intentionally not built, and why

| Item | Why not | What stands in |
|---|---|---|
| Patient CRM | Out of scope in the brief; stores sensitive personal data under UU 27/2022; lowest rubric score (0.70) | One roadmap line in the deck |
| Free-text public reviews | Parity with Google; UU ITE defamation exposure and Permenkominfo 5/2020 takedown duties; sits badly with KODEKGI; score 0.93 | Verification and price provenance as the trust signal |
| Google reviews display | Attribution and no-caching rules add work for a parity feature | "Buka di Google Maps" link |
| Booking, payments, scheduling | Not in the script; Halodoc and Alodokter parity; needs clinic operations | WhatsApp deep link with the pre-visit summary |
| Self-serve claim with identity verification | Needs document review; zero real claimants by Sunday | Team-verified seeds; upload page behind Google sign-in with a "menunggu tinjauan" state |
| Clinic management, RME, SATUSEHAT integration | A different product in a compliance market | Roadmap slide |
| Other cities, APAC | Surabaya only | Deck explains the registry-based seeding path |
| Voice input | Accessibility win but not in the script; adds Speech-to-Text risk | Stretch only if every scene is done by Sat 23:00 |
| Nearby unverified results from Places Nearby Search | Brings Google content display rules into the UI and dilutes the three-card message | Place ID and Maps link only |
| Push notifications, native apps | Not needed | Installable PWA |
| Languages beyond Indonesian and English | Not needed | The agent answers in the user's language regardless |
| Medication advice | Safety; eval requires zero unsafe medication advice | The agent never names a dose; it says to ask the pharmacist or dentist |
| Photo-of-tooth triage with Gemini vision | Tempting Gen AI "wow"; clinical risk; the evalset would need labeled images | Text only; the deck lists it as future work behind the same eval gate |

## 6. Decisions needed from you now

1. Eligibility: is the team formed on Hack2skill with 2 to 4 members who are all 21+, non-students and in JAPAC? Yes or no.
2. Deadline: what does the dashboard countdown say?
3. Scope: approve the primary flow in 1.6 and the cut list in section 5, or name what changes.
4. Owners: map names to P, E1, E2 and D.
5. Scene 4 variant: agree that the 2-hour test result selects it, per the table in 1.4.

After these, step 3 (data strategy and seeding) and the block 0 engineering tasks start at once.

## Sources checked on 16 October 2026

- Hackathon dates, eligibility and deliverables: [aibuildercup.com](https://aibuildercup.com/index.html) and the [FAQ](https://aibuildercup.com/Faqs.html). Third-party listings that quote a 4 October deadline are out of date; the official page shows "Prototype Building & Submission: 7 Sept - 18 Oct, 2026".
- KKI public search of registered doctors and dentists by name or STR number: [kki.go.id](https://kki.go.id/) homepage ("Cek Named & Nakes"); aggregate counts at [STR aktif](https://kki.go.id/report_registrasi/named?jenis=2).
- Data Fasyankes Online: [dfo.kemkes.go.id](https://dfo.kemkes.go.id/) (login only; published data said to appear on the Ditjen Yankes portal).
- Independent practice registration: [Juknis Registrasi Tempat Praktik Mandiri Nakes](https://registrasifasyankes.kemkes.go.id/assets/Juknis%20Registrasi%20Tempat%20Praktik%20Mandiri%20Nakes.pdf).
- JKN dental benefits at FKTP, secondary sources to be replaced by the regulation text in step 4: [CNN Indonesia](https://www.cnnindonesia.com/edukasi/20250120102834-561-1189085/daftar-perawatan-gigi-yang-ditanggung-oleh-bpjs-kesehatan), [CNBC Indonesia on scaling](https://www.cnbcindonesia.com/lifestyle/20251105091305-33-682388/syarat-cara-scaling-gigi-pakai-bpjs-kesehatan), [Permenkes 3/2023 tariff regulation](https://www.peraturan.go.id/files/permenkes+-no-3-tahun-2023.pdf).
- Everything else: [docs/hackathon-brief.md](hackathon-brief.md).

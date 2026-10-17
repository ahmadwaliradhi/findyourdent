# FindYourDent: AI Builder Cup 2026 brief

Written 16 October 2026 from a brainstorm session. Part 1 is what the hackathon actually demands. Part 2 is what a top professional would do that the original prompt did not ask for. Part 3 is the rewritten prompt, ready to paste into a build session.

## Part 1. Hackathon facts that change the plan

Source pages: [overview](https://aibuildercup.com/index.html), [themes and judging](https://aibuildercup.com/themes.html), [FAQ](https://aibuildercup.com/Faqs.html), [rewards](https://aibuildercup.com/rewards.html), [terms and conditions](https://docs.google.com/document/d/e/2PACX-1vRm7ChZ6Ij9fG7uFDkxzUMpwgVeBmnQ6cMDnAIEEX84AiLBOOQ9cYbl3S5OzFBbcVb8TF55s-eVpiXb/pub).

| Item | Fact |
|---|---|
| Organiser | Hack2skill, sponsored by Google Cloud (Gen AI Academy APAC) |
| Submission deadline | 18 October 2026 |
| Evaluation window | 19 October to 6 November 2026 (deployed URL must stay up) |
| Finalists announced | 7 November 2026; Demo Day Singapore 4 December 2026 |
| Deliverables | Deployed live URL on Cloud Run / GCP / Firebase; demo video strictly under 3 minutes; public GitHub repository; comprehensive deck covering solution architecture and business case |
| Mandatory tech | Google Cloud stack. Gemini and ADK are not named as mandatory, but "Google Cloud architectural depth" is scored and a USD 2,000 side award exists for "Best use of Google Cloud AI tools" |
| Fresh-code rule | Only code and assets created during the hackathon timeline. Pre-existing products or ongoing projects are disqualified |
| Team | 2 to 4 members, all non-students, all aged 21+, all based in JAPAC. Solo entries are not allowed. Roster frozen after 14 October |
| Third-party content | "Participants must not use any content protected under third party rights." Participants indemnify the organiser against third-party claims |
| Prizes | Winner USD 10,000; first runner-up USD 7,000; second runner-up USD 5,000; four side awards of USD 2,000 each (Best use of Google Cloud AI tools, Most Impactful Solution, Social Choice, Best UI/UX) |

Judging rubric, applied to all themes:

| Criterion | Weight | What judges look for |
|---|---|---|
| Technical Merit & Gen AI Implementation | 40% | Gen AI directly helps solve the problem; functional and technically sound; robustness; Google Cloud architectural depth; scalable beyond the prototype |
| Problem Alignment & Impact | 25% | Clarity of problem-solution fit; measurable real-world viability; clear value for users or community |
| Innovation & Creativity | 25% | Fresh approach that differs meaningfully from existing solutions; Gen AI use that goes beyond basic or superficial |
| User Experience & Solution Design | 10% | Intuitive, accessible, clean interface; components work together smoothly |

Theme text for Sustainability & Social Impact: "Build an AI-powered solution that addresses a meaningful environmental or societal challenge," with focus areas of resource efficiency, accessibility, resilience, community support, and more informed and sustainable decision-making.

## Part 2. What a top professional would do that the original prompt did not ask for

### 2.1 Actions

- Reverse-engineer the rubric before choosing scope. Half the score (Innovation 25% plus Impact 25%) is lost by a directory that looks like Alodokter or Google Maps with a chatbot attached. A directory is parity. The agent-first flow is the differentiator, so the directory must be the agent's output, not the product.
- Write the 3-minute video script first and build backwards from it. Anything that does not appear in the video is not built this week. Four half-finished features score lower than one end-to-end flow, because "functional and technically sound" is explicitly scored.
- Replace scraping with data that is legal by construction. Google Maps Platform Terms section 3.2.3(a) prohibits scraping Google Maps Content for use outside the Services, and the Places API policies allow only place IDs to be stored. The hackathon terms ban third-party-protected content and the GitHub repository is public, so scraped data is visible evidence. Use the Places API (New) at runtime, store only place IDs, and show Google reviews only with the mandated attribution and links. Everything else must be first-party: registry-verifiable identity plus dentist-supplied price lists.
- Treat the triage agent as a clinical-adjacent system: ground it in official clinical guidance, add an emergency escalation rule, and ship an evaluation table. A hackathon deck with a dentist-labeled eval set and pass rates is rare and lands directly on the 40% criterion.
- Run eight short primary conversations (5 patients, 3 dentists) within 48 hours and put the quotes in the deck. Impact is scored on "measurable real-world viability," which needs human evidence, not a market-size slide.
- Check the professional-ethics constraint on the dentist side before promising "branding" tools. MKEK Fatwa SK 29/2021 bars doctors from advertising, and a PDGI official has said that dentists who invite the public to their practice breach the dental code of ethics. A "manage your branding" feature could make the platform the instrument of an ethics breach. Price transparency and verified credentials are safer framings than promotion.
- Confirm eligibility before anything else: a team of 2 to 4 non-students registered before the roster freeze.

### 2.2 The rawest material to start from

- The hackathon terms and rubric text itself, not the summary on the landing page.
- Survei Kesehatan Indonesia 2023 tables on oral health, not news articles. Secondary sources cite a 56.9% prevalence of dental and oral problems, 11.2% of those visiting a dentist, and 57% reporting they felt no need for care. Verify the exact tables in the BKPK report before putting them in the deck.
- Official registries, not Google Maps: SATUSEHAT SDMK for STR (the lifetime registration under UU 17/2023), registrasifasyankes.kemkes.go.id and Data Fasyankes Online for facility codes (every independent practice must hold one), Dinas Kesehatan SIP issuance (district and city level; Pontianak publishes a SIPDG dataset as open data, so other cities may too), and the BPJS Kesehatan faskes list. No public STR lookup endpoint was confirmed, so document what can and cannot be verified from primary sources.
- Dentist-supplied documents: price lists, brochures, Instagram price posts, and patient invoices. These are the raw input for Gemini document extraction, which is exactly how biayasekolah.id onboards schools (upload brochure, AI reads it, user confirms name and city, admin reviews, publish).
- Clinical ground truth: Kemenkes Panduan Praktik Klinis bagi Dokter Gigi (Kepmenkes HK.01.07/MENKES/1186/2022), BPJS dental benefit rules (Perpres 59/2024 and the current Permenkes on JKN tariffs), and WHO oral health guidance. Not blog posts.
- Patient voices: direct interviews, plus reading public forum posts about "sakit gigi biaya" for language and vocabulary. Read them; do not scrape them.
- OpenStreetMap is open (ODbL) but thin: an Overpass count on 16 October 2026 returned 586 dentist POIs for all of Indonesia, against roughly 50,000 registered dentists. Open map data is a supplement, not a source.

### 2.3 Methods and tools

- Rubric scoring matrix: feature x criterion weight x confidence of finishing in 48 hours. Pick one primary flow.
- Demo-driven development: a 5-scene video storyboard, each scene mapped to a rubric criterion.
- Jobs-to-be-Done and Mom Test interviews over WhatsApp voice notes.
- Wizard-of-Oz the triage conversation by hand with two patients before coding the agent.
- Agent: Google ADK with Gemini; tools for Places search, registry lookup, cost band lookup, and BPJS coverage rules; grounding via Vertex AI Search or a small RAG index over the PPK Dokter Gigi; structured JSON output with urgency tier, problem category, single-visit versus multi-visit journey, cost band, BPJS flag, and escalation.
- Evaluation: `adk eval` with an evalset of labeled Indonesian-language cases (tool trajectory, response match, LLM-as-judge), plus Vertex AI Gen AI Evaluation for safety. Report pass rates in the deck and README.
- Data ingestion: Gemini multimodal extraction of price lists from PDF and photos, with provenance and last-updated date on every field; Firestore for first-party data; place IDs only from Places API (New).
- Platform: Next.js PWA on Cloud Run, Firebase Auth, Lighthouse PWA and accessibility audits.
- Legal checklist: Google Maps Platform Terms 3.2.3, Places API policies (attribution, no caching), hackathon terms (third-party content, indemnity), UU 27/2022 PDP (symptom data is sensitive personal data; explicit consent, minimal retention), PP 28/2024 framing (education and navigation, not diagnosis), MKEK Fatwa 29/2021 and PDGI KODEKGI 2020 for all dentist-facing features, Permenkominfo 5/2020 takedown obligations if user content is published.

### 2.4 What, other than the builder or the assistant, would show the result is right

- Judges' rubric score, and the side awards.
- A licensed dentist not on the team labels the evalset and signs off on 20 sampled agent outputs. Gate: emergency recall 100%, urgency-tier accuracy at least 85%, zero unsafe medication advice.
- Five patients complete the flow unaided; measure task success and time from first message to a shortlist.
- Every "Verified" badge matches a registry record (STR or facility code); report the match rate and the unverifiable remainder.
- Lighthouse PWA and accessibility scores of 90 or higher on the deployed URL.
- Google Places policy checklist passes (only place IDs stored, attribution visible, links to Google Maps present) and the public repository contains no scraped content.
- Deployed Cloud Run URL stays up through the 19 October to 6 November evaluation window.
- Real supply-side signal: dentists or clinics that claim a profile or upload a price list before the finale.

## Part 3. The rewritten prompt

Paste the block below into a new session.

```text
Context
I am entering the AI Builder Cup 2026 (run by Hack2skill, sponsored by Google Cloud), theme "Sustainability & Social Impact". Submission deadline is 18 October 2026; evaluation runs 19 October to 6 November, so the deployed URL must stay up. Required deliverables: a working end-to-end prototype deployed on Cloud Run, GCP or Firebase; a demo video strictly under 3 minutes; a public GitHub repository; a deck covering solution architecture and business case. Binding rules: fresh code only (nothing from before the hackathon timeline), a team of 2 to 4 non-students in JAPAC, Google Cloud stack mandatory, no third-party-protected content, and the team indemnifies the organiser. Rubric: Technical Merit & Gen AI Implementation 40% (meaningful Gen AI, functional and sound, Google Cloud architectural depth, scalable); Problem Alignment & Impact 25% (problem-solution fit, measurable real-world viability); Innovation & Creativity 25% (meaningfully different from existing solutions, non-superficial Gen AI); User Experience 10%. Side awards of USD 2,000 each exist for Best use of Google Cloud AI tools, Most Impactful Solution, Best UI/UX and Social Choice.

Product
FindYourDent (findyourdent.com), Indonesia first, PWA. Long-term vision: a three-sided dentistry platform for patients, clinic management and private dentists. Hackathon scope is one end-to-end flow, not the platform. Seed city: Surabaya.

Working hypothesis to stress-test, not to accept
"Sakit gigi, then understand, then a verified, price-transparent, BPJS-aware shortlist near me." An ADK agent on Gemini triages the patient's description, explains single-visit versus multi-visit journeys and why prices differ, then returns a shortlist drawn from a first-party directory. The directory is the agent's output, not the product. Supply side: dentists and clinics claim a profile and upload a price list, which Gemini extracts into structured fields with provenance. Not in scope: patient CRM, free-text public reviews, APAC expansion.

What I want from you, in this order

1. Challenge first. Argue the strongest case against the hypothesis and against the three-sided platform thesis. Name the riskiest assumption and the cheapest 2-hour test for it. Then score the candidate features (triage agent, verified directory, claim plus price-list upload, patient CRM, public reviews) on each rubric criterion times its weight times confidence of finishing in 48 hours. Recommend one primary flow and say what is cut.

2. Demo storyboard before code. Write the 3-minute video script as 5 scenes, each tied to a rubric criterion, and list the exact screens and data the script needs. Nothing outside the script gets built.

3. Data strategy that is legal by construction. No scraping of Google Maps. Use Places API (New) at runtime for discovery; persist only place IDs; display Google reviews only with the required attribution and links, or not at all. Seed 30 to 50 clinics and dentists in Surabaya from registry-verifiable sources: facility codes from registrasifasyankes.kemkes.go.id or Data Fasyankes Online, STR via SATUSEHAT SDMK, SIP from the Dinas Kesehatan where published, BPJS faskes status. Ingest dentist-supplied price lists (PDF or photo) with Gemini document extraction, storing provenance and last-updated on every field. Produce a table of which fields could be verified from a primary source and which could not.

4. Clinical grounding. Ground the agent in Kemenkes Panduan Praktik Klinis bagi Dokter Gigi (Kepmenkes HK.01.07/MENKES/1186/2022) and the current BPJS dental benefit rules via Vertex AI Search or a small RAG index. Output structured JSON: urgency tier, likely problem category, single-visit or multi-visit journey, why prices vary, cost band, BPJS coverage flag, and an emergency escalation rule (facial swelling with fever or difficulty swallowing or opening the mouth sends the user to an emergency department now). Frame everything as education and navigation, not diagnosis, with consent and minimal retention for symptom text under UU 27/2022.

5. Evaluation gate. Build an evalset of 40 Indonesian-language patient messages, including 8 emergencies and 5 adversarial or off-topic cases, labeled by a licensed dentist who is not on the team. Run adk eval (tool trajectory, response match, LLM-as-judge) and Vertex AI Gen AI Evaluation for safety. Pass criteria: emergency recall 100%, urgency-tier accuracy at least 85%, zero unsafe medication advice. Put the results table in the deck and the README.

6. Primary evidence. Script and run 5 patient and 3 dentist Mom Test conversations (WhatsApp voice notes are fine): last toothache, what they did, how they chose, what they paid, what they wished they had known. For dentists: would they claim a profile and upload a price list, and what MKEK Fatwa 29/2021 and PDGI KODEKGI limits they perceive. Quotes go in the deck.

7. External verification, with pass or fail recorded: Lighthouse PWA and accessibility at least 90; registry match rate for every Verified badge; 5 users complete the flow unaided with time-to-shortlist measured; Google Places policy checklist; hackathon terms checklist; ethics review of every dentist-facing feature against the fatwa and the code.

8. Deliverable mapping. Cloud Run URL; repository layout; deck outline (problem with Survei Kesehatan Indonesia 2023 figures verified against the report, Google Cloud architecture diagram, eval results, user evidence, business case for the three-sided platform, and one slide on why this is not Alodokter, Halodoc or Google Maps); final video script.

Output format
A ranked decision table, a 48-hour plan in half-day blocks with owners, a risk register with kill criteria, and an explicit list of everything intentionally not built and why.
```

## Sources consulted

- Hackathon: [overview](https://aibuildercup.com/index.html), [themes and judging](https://aibuildercup.com/themes.html), [FAQ](https://aibuildercup.com/Faqs.html), [rewards](https://aibuildercup.com/rewards.html), [terms and conditions](https://docs.google.com/document/d/e/2PACX-1vRm7ChZ6Ij9fG7uFDkxzUMpwgVeBmnQ6cMDnAIEEX84AiLBOOQ9cYbl3S5OzFBbcVb8TF55s-eVpiXb/pub)
- Google Maps: [Places API policies](https://developers.google.com/maps/documentation/places/web-service/policies), [Service Specific Terms](https://cloud.google.com/maps-platform/terms/maps-service-terms/index-20240522), [secondary summary of the no-scraping clause 3.2.3(a)](https://conductatlas.com/platform/google-maps/google-maps-platform-terms-of-service/no-scraping-or-content-extraction/), [a developer's report of enforcement](https://forum.bubble.io/t/google-maps-violation/194549)
- Indonesian registries and regulation: [Kemenkes on STR via SATUSEHAT SDMK](https://www.kemkes.go.id/id/tenaga-medis-dan-tenaga-kesehatan-tidak-perlu-calo-untuk-urus-str), [independent practice registration guide](https://registrasifasyankes.kemkes.go.id/assets/Juknis%20Registrasi%20Tempat%20Praktik%20Mandiri%20Nakes.pdf), [Data Fasyankes Online guide](https://dfo.kemkes.go.id/assets/Juknis/PETUNJUK%20TEKNIS%20DFO%201.pdf), [Permenkes 12/2024 on Konsil Kesehatan Indonesia](https://peraturan.go.id/filespengundangan/permenkes-no-12-tahun-2024.pdf), [Pontianak SIPDG open dataset](https://ckan.pontianak.go.id/dataset/?tags=SIPDG), [Jakarta e-permit guide for SIP](https://pelayanan.jakarta.go.id/download/publikasi/panduan-pengisian-formulir-perizinan-sip-dokter-secara-elektronik-v-2-0.pdf)
- Oral health statistics: [Kemenkes on dental service equity](https://www.kemkes.go.id/id/menkes-dorong-pemerataan-layanan-dan-edukasi-kesehatan-gigi), academic citations of SKI 2023 figures such as [this thesis chapter](https://eprints.poltekkesjogja.ac.id/18431/4/Chapter%201.pdf)
- Ethics: [KODEKGI 2020 PDF](https://fkg.unair.ac.id/en/wp-content/uploads/2021/06/Buku-Kode-Etik-Kedokteran-Gigi-2020.pdf), [MKEK fatwa on doctors and social media promotion](https://www.idxchannel.com/news/soroti-kode-etik-idi-larang-dokter-influencer-promosikan-produknya-di-medsos/all), [hukumonline on doctors' social media content](https://www.hukumonline.com/klinik/a/etika-dokter-dalam-membuat-konten-medsos-lt640aeb611e0d7/)
- Incumbents: [Alodokter dentist directory page](https://www.alodokter.com/cari-dokter/dokter-gigi/h2e-dental-clinic/jakarta), [Halodoc dentist search](https://www.halodoc.com/cari-dokter/dokter-gigi), [Formi.id dental booking app](https://apps.apple.com/id/app/id1631641161), [biayasekolah.id](https://biayasekolah.id/) (logged-in dashboard, listing, claim, contribute and brochure-upload flows reviewed on 16 October 2026)
- ADK evaluation: [adk eval guide](https://www.skills.sh/google/adk-docs/adk-eval-guide), [MLflow ADK evaluators](https://mlflow.org/blog/mlflow-google-adk-evaluators/)
- OpenStreetMap count: Overpass API query for amenity=dentist within Indonesia on 16 October 2026 returned 586 elements (ODbL)

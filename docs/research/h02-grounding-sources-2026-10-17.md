# H02 grounding sources: official copies, hashes and licences, 17 Oct 2026

Scope: the source documents for the Agent Search data store in issue #9 (H02) and spec 01. For each one: the official publisher, landing page, direct file URL, whether it downloads, SHA-256, pages, language, and whether its licence allows a private copy indexed in a private Agent Search (Standard edition) data store for a RAG agent.
Confidence: **confirmed** = read on the publisher's own site or in the downloaded file. **likely** = inferred from official text, not stated outright. **unclear** = needs a human decision.
Files were downloaded on 17 October 2026 to a local scratch directory outside the repository. No PDFs are in the repo. No cloud resources were created.

---

## Summary

| # | Document | Publisher | File URL | Downloads | SHA-256 (first 16) | Licence verdict |
|---|---|---|---|---|---|---|
| 1 | KMK HK.01.07/MENKES/1492/2023, PNPK pulpa dan periradikuler | Kementerian Kesehatan | https://jdih.kemkes.go.id/storage/documents/pdfs/2023kepmenkes1492.pdf | yes, 1.8 MB, 119 pp | `9baa2256a3156e0a` | **Allowed** (UU 28/2014 Pasal 43 huruf b; Pasal 42 arguably) |
| 2 | Permenkes 3/2023, Standar Tarif Pelayanan Kesehatan JKN | Kementerian Kesehatan | https://peraturan.bpk.go.id/Download/334015/Permenkes%20Nomor%203%20Tahun%202023.pdf (byte-identical to https://jdih.kemkes.go.id/storage/documents/pdfs/2023permenkes0003.pdf) | yes, 20.8 MB, 721 pp | `9ad3c8ce7e6de0de` | **Allowed** (UU 28/2014 Pasal 42 huruf b) |
| 3 | Perpres 59/2024, Perubahan Ketiga atas Perpres 82/2018 | Presiden RI (via JDIH BPK) | https://peraturan.bpk.go.id/Download/344279/Perpres%20Nomor%2059%20Tahun%202024.pdf | yes, 3.4 MB, 33 pp | `2063435307ca083c` | **Allowed** (Pasal 42 huruf b) |
| 4 | Perpres 82/2018, Jaminan Kesehatan | Presiden RI (via JDIH BPK) | https://peraturan.bpk.go.id/Download/254897/Perpres%20Nomor%2082%20Tahun%202018.pdf | yes, 13.6 MB, 74 pp (scan) | `e94fa29e2ad37559` | **Allowed** (Pasal 42 huruf b) |
| 5a | UK: *Clinical guidance: unscheduled urgent and non-urgent dental care* v1.0 (PRN01927_ii) | NHS England | web page only: https://www.england.nhs.uk/long-read/clinical-guidance-unscheduled-urgent-and-non-urgent-dental-care/ | read in a browser; scripted download blocked by a bot check | not downloaded | **Allowed** (Open Government Licence v3.0) |
| 5b | UK: SDCEP *Emergency Dental Care – Practice Guide* (2026, companion to MADP 2nd ed.) | SDCEP / NHS Education for Scotland | https://www.acutedentalproblems.sdcep.org.uk/media/wwjiao2y/sdcep-edc-dental-practice-guide.pdf | yes, 0.57 MB, 6 pp | `3d3af81513396c3c` | **Unclear**: CC BY-NC-ND 4.0, non-commercial only |
| 6a | Canada: VCH *Treating Acute Dental Infections in the Community and Appropriate Referral to an Emergency Department* | Vancouver Coastal Health (ASPIRES) | https://aspires.vch.ca/Documents/Treatment%20Recommendations/Treating_Dental_Infections.pdf | yes, 0.33 MB, 4 pp | `01212c73a5d59011` | **Forbidden** without permission (VCH terms of use) |
| 6b | Canada: RCDSO *Information on Dental Emergencies* (FAQ) | Royal College of Dental Surgeons of Ontario | web page only: https://www.rcdso.org/standards-guidelines-resources/rcdso-news/frequently-asked-questions/information-on-dental-emergencies | page reachable; no PDF | not saved | **Unclear**: "All Rights Reserved", no reuse terms |
| 7a | Queensland: Metro North OMFS referral page *Teeth and gums* | Metro North Hospital and Health Service (Queensland Health) | web page only: https://metronorth.health.qld.gov.au/specialist_service/refer-your-patient/oral-maxillo-facial/teeth-and-gums | yes (HTML snapshot, 138 KB) | `e9f8e121496215b0` | **Allowed** verbatim with attribution (CC BY-ND 4.0) |
| 7b | Queensland: *Emergency dental* (public advice page) | Queensland Government (qld.gov.au) | web page only: https://www.qld.gov.au/health/services/oral-eye-ear/emergency-dental | yes (HTML snapshot, 191 KB) | `cafb05e69042e2fb` | **Allowed** (CC BY 4.0) |
| 7c | Queensland: CPC *Dental Extractions (including wisdom teeth)*, Emergency section | Queensland Health, Clinical Prioritisation Criteria | web page only: https://www.health.qld.gov.au/cpc/maxillofacial-surgery/dental-extractions-including-wisdom-teeth | read in a browser; scripted download blocked by a bot check | not saved | **Forbidden** without permission (page states it) |

Full SHA-256 values are in each section below.

**Recommended upload set:** 1, 2, 3, 4, 5a, 7a, 7b. The Indonesian four plus one UK and two Queensland sources can go in with no permission request. Canada has no source that is clearly cleared for this use (see "Left out / needs human decision").

---

## Indonesian law: copyright status of the regulations

**Answer**
- UU 28/2014 tentang Hak Cipta, **Pasal 42**: "Tidak ada Hak Cipta atas hasil karya berupa: ... b. peraturan perundang-undangan". The other items are open meetings of state bodies, state speeches, court decisions and scripture. The Elucidation says only "Cukup jelas". Perpres and Permenkes are peraturan perundang-undangan, so documents 2, 3 and 4 carry no copyright. **Confirmed.**
- **Pasal 43 huruf b** says it is not an infringement to publish, distribute, communicate or copy "segala sesuatu yang dilaksanakan oleh atau atas nama pemerintah". The exception is material that a regulation or a statement on the work says is protected. **Confirmed** (text read).
- **KMK 1492/2023 is a Keputusan, not a Peraturan.** Whether a ministerial decision counts as "peraturan perundang-undangan" under Pasal 42 is arguable (**unclear**). It does not matter much here. The decision and its annex are issued by the Minister, and the PDF carries no copyright or reuse statement (searched for "hak cipta", "copyright", "dilarang" and "©": no matches). So Pasal 43 huruf b covers copying and communicating it (**likely**). The annex was drafted by professional organisations ("disusun oleh organisasi profesi", Menimbang huruf b), but the Minister "mengesahkan dan memberlakukan" it (Diktum KESATU), so it is published by the government.
- The JDIH Kemenkes footer says "© 2026 JDIH Kementerian Kesehatan RI. All rights reserved." That covers the website, not the statutory text.

**Sources**
- UU 28/2014, JDIH BPK: https://peraturan.bpk.go.id/Details/38690/uu-no-28-tahun-2014 ; PDF https://peraturan.bpk.go.id/Download/28018/UU%20Nomor%2028%20Tahun%202014.pdf (Pasal 42 on PDF p. 20, Pasal 43 on p. 21, Elucidation on p. 72)

---

## 1. KMK HK.01.07/MENKES/1492/2023

- **Title:** Keputusan Menteri Kesehatan Republik Indonesia Nomor HK.01.07/MENKES/1492/2023 tentang Pedoman Nasional Pelayanan Kedokteran Tata Laksana Penyakit/Kelainan Jaringan Pulpa dan Periradikuler. **Confirmed** (PDF p. 1).
- **What it covers:** the national clinical guideline (PNPK) for diseases of the dental pulp and periradicular tissue: pulpitis, pulp necrosis, apical periodontitis and abscess, and their management, including root canal treatment. It is a guideline for dentists (Diktum KEDUA). Health facilities must use it as the reference for their SOPs (Diktum KEEMPAT). It is not a coverage or tariff rule.
- **Date:** ditetapkan 20 Juli 2023, in force the same day (Diktum KEDELAPAN). Signed by Budi G. Sadikin. **Confirmed** (PDF p. 4).
- **Publisher:** Kementerian Kesehatan. Official host: JDIH Kemenkes.
- **Landing page:** https://jdih.kemkes.go.id/documents/keputusan-menteri-kesehatan-nomor-hk0107menkes14922023
- **PDF:** https://jdih.kemkes.go.id/storage/documents/pdfs/2023kepmenkes1492.pdf (HTTP 200, `application/pdf`). A Kemenkes news page also links to its own copy: https://www.kemkes.go.id/id/pnpk-2023---tata-laksana-pulpa-periradikuler (not downloaded).
- **File:** 1,799,544 bytes, 119 pages, text layer present, every page footed "jdih.kemkes.go.id". PDF metadata shows it was re-saved on 15 April 2026 (iLovePDF). A later re-upload could change the hash.
- **SHA-256:** `9baa2256a3156e0ade43a6b2df8f920d1606b8926db088fe328a96f456d48eb1`
- **Language:** Indonesian.
- **Licence:** see the copyright section above. **Allowed.**

## 2. Permenkes No. 3 Tahun 2023

- **Title:** Peraturan Menteri Kesehatan Republik Indonesia Nomor 3 Tahun 2023 tentang Standar Tarif Pelayanan Kesehatan dalam Penyelenggaraan Program Jaminan Kesehatan. **Confirmed** (PDF p. 1, BPK metadata). This confirms the guess in the brief: it is the JKN tariff standard. It contains the FKTP dental capitation and denture caps cited in [facts-2026-10-16.md](facts-2026-10-16.md).
- **Date:** ditetapkan 6 Januari 2023, diundangkan 9 Januari 2023, Berita Negara 2023 No. 35. **Confirmed** (PDF p. 30). It replaces Permenkes 52/2016 and its amendments (Menimbang huruf b). BPK lists no amending regulation. Later amendments were not checked independently.
- **Publisher:** Kementerian Kesehatan.
- **Landing pages:** JDIH Kemenkes https://jdih.kemkes.go.id/documents/peraturan-menteri-kesehatan-nomor-3-tahun-2023 ; JDIH BPK https://peraturan.bpk.go.id/Details/275518/permenkes-no-3-tahun-2023
- **PDF:** https://peraturan.bpk.go.id/Download/334015/Permenkes%20Nomor%203%20Tahun%202023.pdf. The Kemenkes copy at https://jdih.kemkes.go.id/storage/documents/pdfs/2023permenkes0003.pdf has the **same SHA-256**, so the two hosts serve one file. The URL in the brief's older note (`/Download/290512/...`) returns 404.
- **File:** 20,807,809 bytes, 721 pages (30 pages of articles; the rest is annexes, mostly INA-CBG tariff tables), text layer present, footed "jdih.kemkes.go.id".
- **SHA-256:** `9ad3c8ce7e6de0de246c294267502712354e958e835b9030ca9234754f389ee7`
- **Language:** Indonesian.
- **Licence:** Pasal 42 huruf b. **Allowed.**
- **Indexing note:** under the 200 MB file limit. The OCR parser only reads the first 500 pages of a PDF, but this file has a text layer, so use the digital or layout parser. Consider uploading only the body and the FKTP annex if the INA-CBG tables add retrieval noise.

## 3. Perpres No. 59 Tahun 2024

- **Title:** Peraturan Presiden Republik Indonesia Nomor 59 Tahun 2024 tentang Perubahan Ketiga atas Peraturan Presiden Nomor 82 Tahun 2018 tentang Jaminan Kesehatan. **Confirmed** (PDF p. 1, BPK metadata).
- **What it covers:** introduces Kelas Rawat Inap Standar (KRIS) and the "kebutuhan dasar kesehatan" benefit basis. It also rewrites the FKTP choice and change rules: new Pasal 6A, and Pasal 7 ayat (1) "Peserta dapat mengganti FKTP ... setelah jangka waktu 3 (tiga) bulan" (PDF p. 8). This is the source for the "change after three months" answer in spec 01. It amends Pasal 71 (payments) among others. It does **not** amend Pasal 55 (checked: no match in the text).
- **Date:** ditetapkan and diundangkan 8 Mei 2024, LN 2024 No. 82. **Confirmed** (BPK metadata).
- **Publisher:** Presiden RI. BPK lists its source as jdih.setneg.go.id; the BPK copy was used.
- **Landing page:** https://peraturan.bpk.go.id/Details/285181/perpres-no-59-tahun-2024
- **PDF:** https://peraturan.bpk.go.id/Download/344279/Perpres%20Nomor%2059%20Tahun%202024.pdf
- **File:** 3,394,871 bytes, 33 pages. It is a scan of the signed document with an OCR text layer. The OCR has errors, for example "l2l" for "(2)" and "2O2O" for "2020".
- **SHA-256:** `2063435307ca083c6b1a4d0b676bd3d2982cfb064257c8005eeea05665f728b5`
- **Language:** Indonesian.
- **Licence:** Pasal 42 huruf b. **Allowed.**

## 4. Perpres No. 82 Tahun 2018

- **Title:** Peraturan Presiden Republik Indonesia Nomor 82 Tahun 2018 tentang Jaminan Kesehatan. **Confirmed.**
- **Date:** ditetapkan 17 September 2018, diundangkan 18 September 2018, LN 2018 No. 165. Amended by Perpres 75/2019, 64/2020 and 59/2024. BPK status: berlaku.
- **Relevant article:** Pasal 55 (tiered care starting at the registered FKTP, except in a medical emergency) is on PDF p. 43. The spec cites Pasal 55 for care outside the home area. The ayat numbering "as amended" in the facts file was not re-checked against 75/2019 and 64/2020.
- **Publisher:** Presiden RI, via JDIH BPK.
- **Landing page:** https://peraturan.bpk.go.id/Details/94711
- **PDF:** https://peraturan.bpk.go.id/Download/254897/Perpres%20Nomor%2082%20Tahun%202018.pdf
- **File:** 13,561,266 bytes, 74 pages, a ScanSnap scan with a poor OCR layer that has broken word spacing (e.g. "Pese rta dilaksa nakan"). **Use the layout parser** (it runs OCR) rather than the digital parser, or retrieval on this file will be weak.
- **SHA-256:** `e94fa29e2ad375595d8a7dd6e28ee3d4c0bed34eb88b557518dbc173b57b2d8f`
- **Language:** Indonesian.
- **Licence:** Pasal 42 huruf b. **Allowed.**
- **Gap:** without 75/2019 and 64/2020 the agent sees the original text plus only the third amendment. Consider adding both, from the same BPK host, for the consolidated picture.

---

## 5. UK dental emergency referral guidance

**Choice: NHS England, *Clinical guidance: unscheduled urgent and non-urgent dental care*, version 1.0** (5a). It is the current England guidance: published 1 May 2025, last updated 3 October 2025, reference PRN01927_ii. It replaces NHS England's November 2023 *Clinical standard for urgent dental care*. **Confirmed.** It was chosen over SDCEP MADP for two reasons:
1. **Licence.** The page footer licenses it under the Open Government Licence v3.0, which allows copying, adapting and commercial use with attribution. SDCEP material is non-commercial only (below).
2. **Fit.** Section 3.2 "Emergency unscheduled care" defines emergencies as needing clinical triage within 60 minutes. Its examples map directly onto spec 01's red flags: oro-facial swelling that is spreading (with or likely to cause airway or intracranial compromise), dental conditions causing acute and severe systemic illness, oro-facial fracture, intra-oral bleeding the patient cannot control, and avulsed permanent teeth. It cites SDCEP's practice guide for triage.

- **Landing page / content:** https://www.england.nhs.uk/long-read/clinical-guidance-unscheduled-urgent-and-non-urgent-dental-care/ (HTML long-read, no full PDF; the page offers "Print or save to PDF"). Figure: https://www.england.nhs.uk/wp-content/uploads/2025/05/figure-1-mgt-pathways-unscheduled-care-system.png
- **Download:** scripted fetches return HTTP 202 with an AWS WAF bot-check page. The content was read in a real browser. No attempt was made to bypass the check, so **no file was saved and there is no hash**. A human needs to use the page's "Print or save to PDF" (step 1 below).
- **Language:** English.
- **Licence:** OGL v3.0 (footer link to nationalarchives.gov.uk). Attribution line: "Contains public sector information licensed under the Open Government Licence v3.0." **Allowed.**

**Alternative (5b): SDCEP, *Management of Acute Dental Problems* (MADP), 2nd edition, 24 March 2026**, plus its *Emergency Dental Care – Practice Guide*, added 30 September 2026.
- MADP 2nd ed. is web-only: https://www.acutedentalproblems.sdcep.org.uk/. Its flowcharts ("Pathways to providers of care") are images. The March 2013 1st-edition PDF on sdcep.org.uk is superseded.
- The Practice Guide PDF was downloaded: https://www.acutedentalproblems.sdcep.org.uk/media/wwjiao2y/sdcep-edc-dental-practice-guide.pdf. 568,626 bytes, 6 pages, text layer, created 28 August 2026. SHA-256 `3d3af81513396c3cae572571d72696b2a0c61e855fc9f96375345025dca1a546`. Its telephone triage flow (p. 3) asks whether swelling is rapidly increasing or "likely to obstruct the airway (e.g. difficulty breathing or swallowing) or closing the eye".
- **Licence:** © SDCEP 2026. The PDF (p. 6) allows copying "for use within NHS Scotland and for non-commercial educational purposes" under **CC BY-NC-ND 4.0**. Commercial use needs written permission from PSD Scotland. The website copyright page says "Use of the content for commercial purposes is not permitted." **Unclear** for FindYourDent: whether a hackathon product with Provider listings is "non-commercial" is a human call (see below).
- The Oral Health Foundation page cited in the 16 October facts file is a charity advice page, not official guidance. It was not used.

## 6. Canada dental emergency referral guidance

There is no national Canadian dental emergency referral guideline. The Canadian Dental Association site had no such document in search results. Two candidates:

**6a. Vancouver Coastal Health (ASPIRES antimicrobial stewardship), *Treating Acute Dental Infections in the Community and Appropriate Referral to an Emergency Department*.** This is the best fit on content.
- It refers to the ED for signs of fascial space infection or systemic signs of severe infection (fever, tachypnea, tachycardia or hypotension). It lists fever, rapid progression, trismus, odynophagia and periorbital cellulitis as signs of a spreading infection (p. 1). Authors: VCH antimicrobial stewardship, UBC Faculty of Dentistry, Richmond Hospital ED pharmacy (p. 4). The PDF has no date. Its metadata says created 15 March 2021.
- PDF: https://aspires.vch.ca/Documents/Treatment%20Recommendations/Treating_Dental_Infections.pdf. Reachable: 326,654 bytes, 4 pages. SHA-256 `01212c73a5d5901120db06b7367d511bc19aa5c22144c5e542ad4a83dcdabfd0`.
- **Licence:** the PDF has no notice. VCH's *Privacy & terms of use* (https://www.vch.ca/en/privacy-statement-terms-use) allows text to be reproduced "for non-commercial personal purposes only". It also prohibits "Downloading, copying, selling or distributing any content" beyond that. aspires.vch.ca is a VCH subdomain, so these terms most likely apply. **Forbidden** for this use without VCH's permission. **Leave out.** The local copy was kept only for this verification and is in `do-not-upload/`.

**6b. RCDSO (Ontario regulator), *Information on Dental Emergencies*.** This is a definition and screening criteria, not a referral pathway.
- It defines a dental emergency (adapted from Ontario's Health Care Consent Act s. 25(1)). Its criteria start with "Is the person in respiratory distress and/or is their airway compromised?", followed by unlocalised or non-draining swelling and severe or uncontrolled bleeding. HTML only, no PDF.
- **Licence:** the footer says "© Copyright 2026 Royal College of Dental Surgeons of Ontario. All Rights Reserved." No reuse terms were found (/terms-of-use and /legal return 404). **Unclear**, and treat it as not permitted until RCDSO agrees.

Not pursued: Indigenous Services Canada's *Clinical Practice Guidelines for Nurses in Primary Care* (2011 dental abscess chapter on canada.ca). Canada.ca says it has moved to the OneHealth portal, so the 2011 PDFs look archived.

## 7. Queensland dental emergency referral guidance

**Choice: Metro North HHS, Oral and Maxillofacial Surgery referral page *Teeth and gums*** (7a), plus the qld.gov.au public page *Emergency dental* (7b).
- **7a content:** for emergency referrals, the patient is sent to the Royal Brisbane and Women's Hospital emergency department and the on-call OMFS registrar is phoned. It lists trauma with large lacerations or jaw fracture. Category 1 infective cases go to the OMFS unit if there is no improvement after 48 hours of dental management, and immediately "in the presence of severe infection including: Limited eye opening, Facial swelling, Increasing pain, Tinnitus, Dysphagia". The page says "Last updated: January 2018", but its criteria match the statewide CPC (7c), which was updated 28 September 2026. URL: https://metronorth.health.qld.gov.au/specialist_service/refer-your-patient/oral-maxillo-facial/teeth-and-gums. HTML snapshot 138,056 bytes, SHA-256 `e9f8e121496215b0d20577187e504afb3e0dd2016241c614952ffec90ed0213c`.
- **7a licence:** Metro North's copyright page (https://metronorth.health.qld.gov.au/copyright) licenses site content under **CC BY-ND 4.0**. Anyone may "reproduce and communicate copyright material on this website in its current form", keeping the notice and attributing the State of Queensland (Metro North Hospital and Health Service). The page shows no contrary notice. **Allowed** for a private verbatim copy and retrieval with attribution. Do not publish an edited version of the page itself.
- **7b content:** patient-facing Queensland Government advice on dental emergencies: knocked-out tooth, toothache, abscess and swelling. Warning signs include fever, a swollen jaw, and "difficulty swallowing or opening your mouth". It advises immediate treatment for facial swelling. Last updated 16 March 2022. URL: https://www.qld.gov.au/health/services/oral-eye-ear/emergency-dental. HTML snapshot 191,266 bytes, SHA-256 `cafb05e69042e2fbbbfb68994bd4c2a2b65d1c40c56d8df361ad70526a95ac36`. The page also gives medicine advice, which spec 01 forbids the agent to repeat with doses. The output validator already handles this.
- **7b licence:** qld.gov.au copyright page (https://www.qld.gov.au/legal/copyright): "Unless otherwise noted", content is **CC BY 4.0**, attribution to the State of Queensland. **Allowed.**

**Not chosen: Queensland Health Clinical Prioritisation Criteria (CPC), Maxillofacial Surgery > *Dental Extractions (including wisdom teeth)*** (7c). It is the authoritative statewide referral criteria (updated 28 September 2026). Its Emergency section says: if severe infection signs (limited eye opening, facial swelling, increasing pain, tinnitus, dysphagia) or trauma with large lacerations or jaw fracture are present or suspected, "refer the patient to the emergency department (via ambulance if necessary)". The general Queensland Health site licence is CC BY-ND 4.0, but it excludes material "indicating a contrary intention". This page carries one: "© State of Queensland (Queensland Health) 2023", and it says "no part of this work may be reproduced, communicated or adapted without permission" except as the Copyright Act 1968 allows. **Forbidden** without permission (ask ip_officer@health.qld.gov.au). health.qld.gov.au also blocks scripted downloads with a bot check, so it was read in a browser only.

---

## Left out / needs human decision

1. **VCH *Treating Acute Dental Infections* (Canada): leave out.** The VCH terms prohibit downloading or copying beyond personal non-commercial use. To use it, email VCH for permission. The 2021-era content can still inform the deterministic red-flag list if the team writes its own wording and does not upload the document.
2. **RCDSO *Information on Dental Emergencies* (Canada): needs permission.** All rights reserved, with no reuse terms. With 6a out, **there is no cleared Canadian source.** Options: (a) ask RCDSO or VCH for permission; (b) drop Canada from the grounding set and say so in the spec and README, relying on NHS England and Queensland; (c) keep Canada only as a reference link in the curated knowledge file, not in the data store.
3. **SDCEP MADP and Practice Guide (UK): needs a decision on "non-commercial".** CC BY-NC-ND 4.0. NHS England 5a covers the same red flags under OGL, so the simplest option is to leave SDCEP out.
4. **Queensland CPC *Dental Extractions* (7c): leave out unless Queensland Health grants permission.** Metro North 7a carries the same criteria under CC BY-ND.
5. **KMK 1492/2023:** fine to include, but the Pasal 42 point for a *Keputusan* is arguable. The verdict rests on Pasal 43 huruf b. A human with legal background may want to confirm.
6. **Spec wording:** spec 01 says "published emergency referral guidance from the UK, Canada and Queensland". If Canada is dropped, update the spec, the README sources list and the Guidance `sources` taxonomy.

## Remaining human steps

All of these depend on the GCP project from issue #2 (H01), which does not exist yet.

1. Save the NHS England page as a PDF with the page's own "Print or save to PDF" button, or upload the HTML. Record its SHA-256 next to the others.
2. Create a **private** Cloud Storage bucket in the project (uniform bucket-level access, no public access), for example in `asia-southeast2`. Upload the approved files: the four Indonesian PDFs, the NHS England page, and the two Queensland HTML snapshots. Keep these attributions: OGL v3.0 for NHS England, CC BY-ND 4.0 for Metro North, CC BY 4.0 for qld.gov.au. Do **not** upload anything from `do-not-upload/` or `needs-decision/`.
3. Create the Agent Search data store (**Standard edition**, unstructured documents, import from Cloud Storage) with document chunking and the **layout parser**, so the scanned Perpres 82/2018 and the OCR-layer Perpres 59/2024 are parsed properly. Limits: 200 MB per file; the OCR parser reads only the first 500 pages, which matters for the 721-page Permenkes.
4. Post the data store ID on issue #9.
5. Decide items 1 to 4 under "Left out / needs human decision", especially whether Canada stays in scope.

Local copies (scratch, not in the repo), named `<country>-<publisher/number>-<topic>`: the approved files at the top level, `needs-decision/` for SDCEP, `do-not-upload/` for VCH.

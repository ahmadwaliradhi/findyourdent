# Dental procedure prices, 17 Oct 2026

Scope: published out-of-pocket prices for the 27 procedure codes in `packages/contracts/data/procedures.json`. The goal is to replace the team-estimate ranges in `services/agent/src/findyourdent_agent/knowledge/cost_estimates.json`.
Sources: only the facility's own page or PDF, or an official regional tariff regulation. Aggregators (HDmall, Alodokter, Hello Sehat, Halodoc) and blog roundups were used only to find facilities. They are not cited as price evidence.
Cities: Jakarta and Jabodetabek (Jakarta Selatan, Tangerang, Depok, Bekasi), Bandung, Surabaya, Yogyakarta (Sleman), Medan, Semarang, Makassar, Tanjungpinang.
Confidence: **confirmed** = at least two private facilities' own pages agree on the range (public tariffs supporting). **likely** = one private own page, or private figures that need unit inference, with public tariffs supporting. **unconfirmed** = public tariffs only and no private own page found, so the private range is extrapolated.
All pages were accessed on 17 Oct 2026. No logins, no forms, no Google Maps.

**Caveats that apply to every code**
- **Promo prices.** Sozo Dental, Teman Dental and Smile Lab show "promo" or "mulai dari" figures. I record the normal price where the page gives one and use it to set the range. Promo prices are listed only as the floor of what patients see.
- **Undated pages.** Asha Dental Care (footer © 2023), Indental (© 2023), Q-Smile and Puri Dental show no price date. They were live on 17 Oct 2026 and are treated as current. Their validity in 2025–2026 is not proven.
- **Public tariffs are below private prices.** RSKGM Kota Bandung (2026 tariff), RSUD Dr. Soetomo (Perda Jatim 8/2023) and Semarang puskesmas (Perwal 23/2025) are official tariffs. They are used to anchor the floor of each range, not the private range itself. Soetomo has a "Reguler" and a pricier "Privat" outpatient tier. Only Reguler figures are quoted unless marked.
- **"mulai dari" (starting from)** prices are floors and do not set the top of the range.

---

## Summary

The range is for private out-of-pocket care, in Rupiah, to be shown labelled "estimasi". "Sources" counts distinct facilities or regulations with a usable figure on their own page. It includes public tariffs, and the number of those is in brackets.

| code | suggested min | suggested max | unit | sources (public) | confidence |
|---|---:|---:|---|---:|---|
| consultation | 50,000 | 200,000 | per visit | 6 (2) | confirmed |
| dental_xray_periapical | 100,000 | 200,000 | per film | 3 (2) | likely |
| dental_xray_panoramic | 200,000 | 500,000 | per exposure | 2 (2) | unconfirmed (no private own page) |
| scaling | 200,000 | 700,000 | per visit (both jaws) | 15 (3) | confirmed |
| fluoride_application | 100,000 | 350,000 | per visit | 6 (3) | confirmed |
| fissure_sealant | 150,000 | 400,000 | per tooth | 3 (2) | likely |
| tooth_filling | 250,000 | 1,000,000 | per tooth | 11 (3) | confirmed |
| pulpotomy | 250,000 | 700,000 | per tooth | 2 (2) | unconfirmed (public only) |
| root_canal_treatment | 1,000,000 | 3,000,000 | per tooth, full course, crown excluded | 6 (2) | confirmed |
| tooth_extraction | 300,000 | 900,000 | per tooth | 10 (3) | confirmed |
| surgical_extraction | 600,000 | 1,500,000 | per tooth | 6 (2) | likely |
| wisdom_tooth_surgery | 1,900,000 | 5,000,000 | per tooth | 7 (2) | confirmed |
| abscess_drainage | 200,000 | 750,000 | per procedure | 2 (2) | unconfirmed (public only) |
| tooth_replantation | 500,000 | 2,000,000 | per tooth, splint included | 2 (2) | unconfirmed (public only) |
| tooth_splinting | 600,000 | 2,500,000 | per splint (one sextant, ~4–6 teeth) | 4 (2) | likely |
| periodontal_treatment | 400,000 | 3,000,000 | per region or quadrant | 5 (2) | likely |
| dental_crown | 1,600,000 | 7,000,000 | per tooth | 9 (2) | confirmed |
| dental_bridge | 4,500,000 | 15,000,000 | per 3-unit bridge | 6 (2) | likely |
| dental_implant | 10,000,000 | 35,000,000 | per tooth (implant, abutment, crown) | 4 (2) | confirmed |
| removable_denture | 900,000 | 7,000,000 | per denture (partial with 1 tooth up to a full set) | 10 (3) | confirmed |
| denture_repair | 300,000 | 900,000 | per repair or reline | 4 (2) | likely |
| orthodontic_braces | 3,000,000 | 25,000,000 | fitting package, both jaws (monthly visits extra) | 12 (2) | confirmed |
| orthodontic_adjustment | 100,000 | 350,000 | per visit | 6 (2) | confirmed |
| clear_aligners | 12,000,000 | 85,000,000 | full treatment | 3 (0) | likely |
| teeth_whitening | 1,000,000 | 5,000,000 | per treatment (both jaws) | 11 (2) | confirmed |
| dental_veneer | 500,000 | 6,000,000 | per tooth | 8 (2) | confirmed |
| oral_lesion_treatment | 100,000 | 600,000 | per visit | 2 (2) | unconfirmed (public only) |

**Unit warnings for the app (one range per procedure)**
- **Per tooth:** filling, extraction, surgical extraction, wisdom tooth, root canal, crown, veneer, implant, fissure sealant, pulpotomy, replantation. A patient with several teeth pays a multiple.
- **Full course:** root canal is the whole treatment across visits, excluding the final crown. Some clinics price it per visit (Sozo Rp499k–750k per visit). Clear aligners are the whole treatment.
- **Braces are two separate costs.** The range covers the fitting package only. Monthly adjustment visits are a separate code (`orthodontic_adjustment`), and over 18–24 months they add Rp2.4M–7.8M. Indental's own 24-month simulation totals **Rp18.8M** (Rp11M fitting plus 24 × Rp325k).
- **Bridge** is priced per unit (per tooth) on most lists. The range assumes the common 3-unit bridge.
- **Scaling** is priced per jaw at public facilities (RSKGM Rp160k–200k per jaw, Semarang Rp141k per jaw). Private clinics price per visit, so the range is per visit.
- **Implant** prices may exclude bone graft and CBCT. Soetomo and Smile Lab do not clearly state whether the crown is included.

---

## Public tariff sources used throughout

- **RSKGM Kota Bandung (Rumah Sakit Khusus Gigi dan Mulut, city-owned), "Tarif Pelayanan Tahun 2026"**, per-polyclinic PDFs uploaded January 2026. It follows Perda Kota Bandung 1/2024. Index page: https://rskgm.bandung.go.id/tarif/ . PDFs used: `https://rskgm.bandung.go.id/wp-content/uploads/2026/01/TARIF-WEB-RSKGM-{POLI-GIGI, RADIOLOGI, PENYAKIT-MULUT, PEDODONTI, PROSTHODONTI, ENDODONTI, ORTHODONTI, PERIODONTI, BEDAH-MULUT, IGD}.pdf`. Bandung, public specialist dental hospital.
- **Perda Provinsi Jawa Timur 8/2023 (Pajak Daerah dan Retribusi Daerah), Lampiran I, section 1: RSUD Dr. Soetomo**, outpatient Reguler (1.1.1) and Privat (1.1.2), radiology 1.11.1.2. https://rsudrsoetomo.jatimprov.go.id/storage/files/informasi/tarifKerjasama/perdaJatim2023No8_lampiran1.pdf . Surabaya, public tertiary hospital.
- **Perwal Kota Semarang 23/2025** (8 May 2025), puskesmas retribusi, as published by PPID Kota Semarang: https://ppid.semarangkota.go.id/penyesuaian-harga-tarif-biaya-layanan-retribusi-pada-pusat-kesehatan-masyarakat/ . Semarang, puskesmas. I read the PPID page, not the Perwal PDF.

## Private facility sources used throughout

| short name | facility, city | URL | date shown |
|---|---|---|---|
| Sozo | Sozo Dental (chain: Jakarta, Bandung, Surabaya, Semarang) | https://www.sozodental.com/layanan/ (per-service pages below) | "Promo Oktober" 2026; says prices vary by branch |
| OMDC | OMDC Dental (chain, Jakarta-based) | https://www.omdc.co.id/omdc-dental ("Daftar Harga" tabs) | none |
| Orange | Orange Dental (Jabodetabek and West Java) | https://orangedentalhouse.com/pricing/ | © 2026 |
| Teman | Teman Dental (Tangerang, Bekasi) | https://www.temandental.co.id/daftar-harga-perawatan-gigi/ | promo May–June 2025 |
| Asha | Asha Dental Care (Tangerang Greenlake City, Depok Bojongsari) | https://ashadentalcare.com/pricelist/ | © 2023, no price date |
| Lya | Lya Dental Care (Cinere/Depok, inferred from a logo filename) | https://lyadentalcare.com/biaya/ | © 2026; "mulai dari" only |
| Smile Lab | Smile Lab Dental Clinic (Kebayoran Baru, Jakarta Selatan) | https://www.implangigi.co/ | © 2026; promo |
| Invicenter | Invicenter (Kebayoran Baru, Jakarta; BSD) | https://www.invicenter.com/ | © 2026 |
| Indental | Indental Clinic (Surabaya) | https://www.indentalclinic.net/id/perawatan-gigi-umum/ and sub-pages | © 2023 |
| Puri | Puri Dental (Medan, 2 branches) | https://www.puridental.com/harga-behel/ and sub-pages | "2026" in titles |
| KGS Jogja | Klinik Gigi Spesialis drg Handoko (Yogyakarta) | https://klinikgigispesialis.com/harga/ | © 2026 |
| Andini | Andini Dental (Sleman, DIY) | https://andinidental.com/estimasi-biaya-gigi-palsu/ | © 2026 |
| Guyu | Guyu Dental House (Sleman, DIY) | https://guyudentalhouse.com/harga-scaling-gigi-jogja/ | posted 9 Nov 2025, updated 4 Dec 2025 |
| UPG | UPG Dental (Makassar) | https://upgdental.com/biaya-scaling-gigi-makassar/ | posted 8 Jan 2026 |
| Q-Smile | Q-Smile Dental Care (Tanjungpinang, Kepri) | https://qsmiledental.com/daftar-harga/ | none |

---

## 1. consultation

**Observed**
- OMDC (Jakarta): "Konsultasi Dokter Gigi Umum" **Rp100,000**, "Konsultasi Dokter Gigi Spesialis" **Rp200,000**.
- Q-Smile (Tanjungpinang): basic "Konsultasi" free. "Konsultasi & Medikasi Pemeriksaan Menyeluruh" **Rp150,000**. Specialist **Rp200,000**.
- Asha (Tangerang/Depok): "Pemeriksaan gigi dewasa" **Rp100,000**, plus admin Rp30,000.
- Puri (Medan): consultation Rp0 (free).
- RSKGM Bandung 2026 (public): dentist, morning **Rp60,000**; afternoon Rp80,000; specialist Rp100,000 (Rp120,000 afternoon); subspecialist Rp170,000. All per visit.
- RSUD Dr. Soetomo, Perda Jatim 8/2023 (public): "Jasa Konsultasi Gigi Tanpa Tindakan" **Rp80,000**; with treatment or emergency Rp100,000.

**Suggested range: Rp50,000 – Rp200,000 per visit.** Private clinics charge Rp100k for a general dentist and Rp200k for a specialist, and some waive the fee. Public specialist tariffs (Rp60k–170k) fall inside the range.
**Confidence:** confirmed.

## 2. dental_xray_periapical

**Observed**
- Q-Smile: "Foto Rontgen Periapikal" **Rp150,000**.
- RSKGM Bandung 2026: periapical, adult **Rp90,000** per exposure (Rp100,000 for walk-in "OTC" patients); child Rp95,000.
- RSUD Dr. Soetomo: "Pemeriksaan dan 1 Foto Gigi" **Rp132,500** (Reguler); Rp191,250 (Privat).

**Suggested range: Rp100,000 – Rp200,000 per film.** Only one private own page was found (Rp150k). The public tariffs (Rp90k–191k) bracket it.
**Confidence:** likely.

## 3. dental_xray_panoramic

**Observed**
- RSKGM Bandung 2026: Panoramic **Rp185,000** per exposure; Rp200,000 for OTC patients. CBCT (1 tooth) Rp700,000.
- RSUD Dr. Soetomo: "Panoramik" **Rp485,000** (Radiologi Reguler).
- No private clinic or imaging lab own page with a panoramic price was found. Aggregator listings (HDmall, Oct 2026) show Rp243,800–460,000 at Jabodetabek clinics. These are not cited as evidence.

**Suggested range: Rp200,000 – Rp500,000 per exposure.** The two public tariffs span the range, and the aggregator figures sit inside it.
**Confidence:** unconfirmed for private prices. **Weakly sourced.**

## 4. scaling

**Observed (private)**
- Sozo: Basic Scaling normal "mulai dari" **Rp500,000** (promo Rp129,000). Airflow Rp1,000,000 normal (Rp599,000 promo). https://www.sozodental.com/layanan/scaling-gigi/
- OMDC (Jakarta): Basic Scaling **Rp649,000**; Scaling Kompleks **Rp699,000**.
- Orange (Jabodetabek): Scaling **Rp249,000**; "Scaling All-in" Rp375,000.
- Teman Dental (Tangerang/Bekasi): Rp98,005–118,005 per person (promo, May–June 2025).
- Lya (Cinere/Depok): "Starts at Rp250,000".
- Asha (Tangerang/Depok): light Rp300,000, medium Rp350,000, heavy **Rp400,000**.
- Q-Smile (Tanjungpinang): **Rp350,000**; deep scaling Rp600,000.
- Indental (Surabaya): **Rp275,000 per jaw**; deep Rp330,000 per jaw; airflow Rp800,000.
- KGS Jogja (Yogyakarta): light Rp300,000, medium Rp400,000, heavy **Rp500,000**.
- Guyu (Sleman): "mulai dari Rp195,000".
- Puri (Medan): **Rp200,000–300,000**.
- UPG (Makassar): "Mulai dari Rp200,000".

**Observed (public)**
- RSKGM Bandung 2026: Rp160,000 / 180,000 / 200,000 per jaw (light, medium, heavy).
- RSUD Dr. Soetomo: "Pembersihan Karang Gigi 1 rahang" Rp282,000; 2 jaws Rp320,400.
- Semarang puskesmas (Perwal 23/2025): Rp141,000 per jaw.

**Suggested range: Rp200,000 – Rp700,000 per visit.** Most normal (non-promo) private prices fall between Rp200k and Rp500k. Chain clinics (OMDC, Sozo normal price) reach Rp650k–700k. Airflow add-ons (Rp800k–1M) are excluded.
**Confidence:** confirmed.

## 5. fluoride_application

**Observed**
- Asha: "Fluoride" **Rp75,000** (adult, add-on); "Topical Fluoride (Anak)" **Rp300,000**.
- OMDC: "Fluoride Protection Anak" **Rp149,000**.
- Sozo: "Fluoridasi Gigi" normal "mulai dari" **Rp150,000** (promo shown as "Rp 120"). https://www.sozodental.com/layanan/perawatan-gigi-anak/
- RSKGM Bandung 2026 (Pedodonti): topical fluoride gel Rp120,000 per jaw; Clinpro Rp150,000 per jaw.
- RSUD Dr. Soetomo: "Topikal aplikasi fluoride" Rp376,800.
- Semarang puskesmas: "Topikal Aplikasi Fluor/TAF" Rp400,000. This looks high for a puskesmas, but it is the figure published.

**Suggested range: Rp100,000 – Rp350,000 per visit.** Private children's fluoride costs Rp149k–300k. The Rp75k adult add-on is set aside as an add-on price.
**Confidence:** confirmed.

## 6. fissure_sealant

**Observed**
- Asha: "Fissure sealant" **Rp320,000**; baby tooth Rp300,000; teenager's permanent tooth **Rp350,000**. All per tooth.
- RSKGM Bandung 2026: GIC Rp150,000; composite/flow Rp250,000. Both per tooth.
- RSUD Dr. Soetomo: 1 tooth Rp289,200; 2 teeth Rp331,200.

**Suggested range: Rp150,000 – Rp400,000 per tooth.** Only one private own page (Asha) was found. The public tariffs (Rp150k–289k) support the lower half.
**Confidence:** likely. **Weakly sourced** (one private source).

## 7. tooth_filling

**Observed (private)**
- Sozo: back tooth "mulai dari" **Rp379,000**; front tooth Rp599,000; 2 back teeth Rp649,000. https://www.sozodental.com/layanan/tambal-gigi/
- OMDC: back tooth simple **Rp799,000**; front simple Rp899,000; front complex **Rp1,000,000**.
- Orange: "Tambal Gigi" Rp380,000.
- Lya: adult "Starts at Rp350,000".
- Asha: GIC Rp300,000–350,000; back tooth Rp350,000–400,000; front Rp400,000–450,000; sandwich Rp500,000.
- Q-Smile: back tooth Rp350,000; aesthetic front Rp500,000.
- Indental (Surabaya): composite small/medium/large Rp350,000 / 425,000 / 475,000; between teeth Rp600,000; broken front tooth **Rp700,000**.
- KGS Jogja: composite Rp200,000–350,000; sandwich Rp300,000–400,000.

**Observed (public)**
- RSKGM Bandung 2026: composite levels 1–4, Rp200,000–400,000 per tooth.
- RSUD Dr. Soetomo: composite (Konservasi) Rp350,000 per tooth.
- Semarang puskesmas: composite Rp93,000.

**Suggested range: Rp250,000 – Rp1,000,000 per tooth.** The private mid-range is Rp350k–500k. OMDC's complex fillings set the top.
**Confidence:** confirmed.

## 8. pulpotomy

**Observed**
- RSKGM Bandung 2026 (Pedodonti): "Pulpotomi" **Rp200,000** per tooth. Pulpectomy (root filling of a baby tooth) Rp150,000 per canal.
- RSUD Dr. Soetomo: "Pulpotomi" **Rp426,000**; baby-tooth pulpectomy Rp378,000.
- No private own page with a pulpotomy price was found. The only clinic list found (Orthopoint, Rp500,000–600,000 per visit) is dated July 2021, outside the 2025–2026 window. RSGM USU's tariff page reportedly lists Rp500,000 (seen in a search snippet only; the site reset connections, so it was not read).

**Suggested range: Rp250,000 – Rp700,000 per tooth.** Extrapolated from public tariffs, assuming private is roughly 1.5–2× public. It fits under private baby-tooth extraction plus filling.
**Confidence:** unconfirmed. **Weakly sourced** (public only).

## 9. root_canal_treatment

**Observed (private)**
- Sozo: front tooth **Rp650,000 per visit** normal (Rp499,000 promo); back tooth **Rp750,000 per visit** normal (Rp599,000 promo). Final restoration excluded. https://www.sozodental.com/layanan/perawatan-saluran-akar/
- Asha: one-visit package single root **Rp1,600,000**; 2 canals Rp1,800,000; 3–4 canals **Rp2,000,000**. Multi-visit: preparation Rp400,000–600,000 plus filling Rp400,000–600,000, with access and sterilisation extra.
- KGS Jogja: staged, Rp350,000 per stage × 3 stages (Rp1,050,000). One visit: single root **Rp900,000**, multi-root **Rp1,500,000**. Final filling extra.
- OMDC: "Perawatan Saluran Akar – spesialis" **Rp1,200,000** (unit not stated).

**Observed (public)**
- RSKGM Bandung 2026: one-visit single root Rp1,000,000. Per canal: Rp150,000 reaming plus Rp150,000 obturation, with access Rp225,000 and medication extra.
- RSUD Dr. Soetomo (Konservasi): 1 canal Rp1,749,600; 2 canals Rp2,005,200; 3 or more **Rp2,296,800**.

**Suggested range: Rp1,000,000 – Rp3,000,000 per tooth, full course, crown excluded.** Three visits at Sozo's normal price come to Rp1.95M–2.25M, and Asha's packages are Rp1.6M–2.0M. The top allows for specialist molar cases. A crown after root canal is a separate cost (see dental_crown).
**Confidence:** confirmed.

## 10. tooth_extraction

**Observed (private)**
- Sozo: standard "mulai dari" **Rp449,000** per tooth. https://www.sozodental.com/layanan/cabut-gigi/
- OMDC: "Pencabutan Standar" **Rp849,000**.
- Orange: Rp500,000.
- Lya: "Starts at Rp350,000".
- Asha: single root Rp350,000; multi-root Rp450,000.
- Q-Smile: adult Rp300,000; by a specialist Rp500,000.
- Indental: residual root Rp375,000; non-impacted Rp400,000–500,000.

**Observed (public)**
- RSKGM Bandung 2026: permanent tooth with local anaesthetic Rp150,000.
- RSUD Dr. Soetomo: permanent tooth Rp125,000–200,000.
- Semarang puskesmas: Rp74,000.

**Suggested range: Rp300,000 – Rp900,000 per tooth.** Private simple extraction runs Rp300k–500k. OMDC's Rp849k sets the top.
**Confidence:** confirmed.

## 11. surgical_extraction

Mapped to extraction "dengan penyulit/komplikasi/flap" (complicated or flap). Impacted wisdom teeth are excluded.

**Observed**
- Asha: "Cabut gigi dewasa dengan penyulit" **Rp650,000**.
- Indental (Surabaya): "Cabut dengan penyulit" **Rp825,000**.
- OMDC: "Pencabutan Komplikasi" **Rp1,049,000**.
- Q-Smile: "Cabut Gigi Spesialis" Rp500,000.
- RSKGM Bandung 2026: extraction with simple flap Rp450,000; complex flap Rp600,000; fractured fragment with complex flap Rp750,000.
- RSUD Dr. Soetomo: "Pencabutan dengan komplikasi" Rp979,200.

**Suggested range: Rp600,000 – Rp1,500,000 per tooth.** Private complicated extractions cost Rp650k–1.05M. The top adds headroom for specialist cases.
**Confidence:** likely, because mapping a complicated extraction to this code is a judgement call.

## 12. wisdom_tooth_surgery

**Observed (private)**
- Sozo: by a general dentist "mulai dari" **Rp1,900,000**; by a specialist "mulai dari" **Rp3,000,000**. Per tooth, X-ray extra. https://www.sozodental.com/layanan/cabut-gigi-bungsu/
- Asha: odontectomy **Rp2,500,000–3,500,000**.
- Q-Smile: "Odontektomi Spesialis" Rp3,000,000.
- Indental (Surabaya): easy **Rp2,900,000**, medium Rp4,100,000, hard **Rp4,650,000** per tooth. https://www.indentalclinic.net/id/cabut-gigi-geraham/
- OMDC: "ODONTECTOMY" Rp3,700,000.

**Observed (public)**
- RSKGM Bandung 2026: odontectomy grade I/II/III Rp1,000,000 / 1,500,000 / 2,000,000.
- RSUD Dr. Soetomo: light/medium/heavy Rp1,500,000–1,620,000 (Reguler); Rp2,116,000–2,210,000 (Privat).

**Suggested range: Rp1,900,000 – Rp5,000,000 per tooth.** The floor is Sozo's general-dentist starting price. The top is Indental's hard case, rounded up.
**Confidence:** confirmed.

## 13. abscess_drainage

**Observed**
- RSKGM Bandung 2026: simple incision and drainage **Rp150,000**; complex **Rp300,000**. ER "Incisi abses" Rp120,000; "Drainase Abses" Rp100,000.
- RSUD Dr. Soetomo: "Incisi abses intra oral" Rp302,000; "Insisi drainage abses intra oral" Rp400,000; "Incisi Abses" Rp450,000.
- No private own page found. The figures seen were aggregator listings only: HDmall Rp145,500–209,000 promo, and a Halodoc article.

**Suggested range: Rp200,000 – Rp750,000 per procedure.** Extrapolated from public tariffs of Rp150k–450k. The top allows for a specialist visit plus medication.
**Confidence:** unconfirmed. **Weakly sourced** (public only).

## 14. tooth_replantation

**Observed**
- RSKGM Bandung 2026: ER "Reimplantasi Gigi" **Rp200,000** per tooth, plus "Splinting dengan Komposit" Rp400,000 or "Splinting Arch Bar" Rp800,000. Pedodonti "Replantasi Khusus" Rp300,000.
- RSUD Dr. Soetomo: "Replantasi 1 gigi dengan arch bar / bracket" **Rp760,000**; "Reinplantasi Gigi dengan bracket anterior" **Rp2,010,000**.
- No private own page found.

**Suggested range: Rp500,000 – Rp2,000,000 per tooth, splint included.** Public replantation plus splint costs Rp600k–2.0M. Private care would be at or above that. Patients will usually also need a root canal later, which is billed separately.
**Confidence:** unconfirmed. **Weakly sourced** (public only).

## 15. tooth_splinting

**Observed**
- Asha: composite **Rp300,000 per tooth**; composite plus wire Rp350,000 per tooth; composite plus fiber **Rp450,000 per tooth**.
- KGS Jogja: "Splinting" **Rp1,500,000 per regio**.
- RSKGM Bandung 2026 (Periodonti): extracoronal wire plus composite Rp150,000 per tooth or Rp700,000 per sextant; fiber Rp175,000 per tooth or Rp850,000 per sextant; intracoronal fiber Rp1,150,000 per sextant.
- RSUD Dr. Soetomo: composite plus wire or fiber, Rp1,200,000 (3 points) to Rp4,000,000 (10 points).

**Suggested range: Rp600,000 – Rp2,500,000 per splint (about one sextant, 4–6 teeth).** Asha's per-tooth prices × 4–6 teeth give Rp1.2M–2.7M. KGS Jogja charges Rp1.5M per region.
**Confidence:** likely (unit conversion needed).

## 16. periodontal_treatment

**Observed**
- Asha: "Kuretase per gigi" Rp300,000; "Root Planing" Rp300,000; "Open Flap" **Rp2,350,000**.
- Q-Smile: "Deep Scaling" Rp600,000.
- Indental: deep scaling Rp330,000 per jaw.
- RSKGM Bandung 2026: root planing Rp250,000 per tooth or **Rp400,000 per region** with anaesthetic. Periodontal surgery small/medium/large Rp750,000 / 1,500,000 / **3,000,000**.
- RSUD Dr. Soetomo: "Flap Operasi" Rp2,000,000; "Gingivectomy" Rp2,000,000.

**Suggested range: Rp400,000 – Rp3,000,000.** The floor is root planing for one region. The top is flap surgery. Guided bone regeneration (RSKGM Rp7M–13M) is excluded.
**Confidence:** likely. The code spans non-surgical and surgical care, so the range is wide.

## 17. dental_crown

**Observed (private)**
- Sozo: "Crown gigi" "mulai dari" **Rp3,500,000** per tooth; the FAQ says porcelain costs Rp3.5M–6M. https://www.sozodental.com/layanan/gigi-palsu/
- OMDC: PFM **Rp4,300,000**; Emax Rp4,900,000; Zirconia **Rp7,000,000**.
- Asha: PFM **Rp2,750,000**; Emax Rp3,750,000; Zirconia Rp4,250,000.
- Q-Smile: porcelain Rp3,500,000; zirconia Rp4,000,000.
- Puri (Medan): crown/bridge "mulai 1,6 jt" (**Rp1,600,000**) per tooth. https://www.puridental.com/crown-bridge/
- Andini (Sleman): PFM from Rp2,300,000; full porcelain from Rp3,500,000; zirconia from Rp4,300,000. All per tooth.
- KGS Jogja: acrylic Rp1,000,000; PFM Rp2,500,000; all-porcelain Rp4,000,000–5,000,000. All per tooth.

**Observed (public)**
- RSKGM Bandung 2026: PFM Rp2,000,000; Emax Rp3,000,000; zirconia Rp4,000,000. Endodonti all-in packages: PFM Rp3,350,000, porcelain Rp4,350,000.
- RSUD Dr. Soetomo: PFM 1 tooth Rp2,250,000; all-porcelain Rp3,500,000.

**Suggested range: Rp1,600,000 – Rp7,000,000 per tooth.** The floor is PFM at regional clinics (Medan, Yogyakarta). The top is zirconia at a Jakarta chain (OMDC). Acrylic crowns (Rp1M) are excluded as temporary-grade.
**Confidence:** confirmed.

## 18. dental_bridge

**Observed**
- Sozo: "Bridge gigi" **Rp15,000,000** normal (Rp10,500,000 promo). Unit not stated; assumed to be a typical 3-unit bridge.
- Andini (Sleman): "Mulai Rp2.300.000/gigi" (per unit).
- Puri (Medan): crown/bridge from **Rp1,600,000** per tooth.
- Q-Smile: Bridge Porcelain Rp3,500,000; Bridge Zirconia Rp4,000,000. Unit not stated; probably per unit.
- RSKGM Bandung 2026: bridge PFM **Rp2,000,000 per tooth**; metal Rp1,000,000; Maryland Rp1,750,000.
- RSUD Dr. Soetomo: "Fix Splint 3 gigi porcelain (pfm)" **Rp4,500,000**; PFM add-on unit Rp2,181,600.

**Suggested range: Rp4,500,000 – Rp15,000,000 per 3-unit bridge.** Per-unit prices of Rp1.6M–4M × 3 give Rp4.8M–12M, and Sozo's normal Rp15M sets the top. Maryland or adhesive bridges can cost less.
**Confidence:** likely, because the per-unit to per-bridge conversion is an inference.

## 19. dental_implant

**Observed**
- Sozo: Royal Implant (Korea) "mulai dari" **Rp9,900,000**; Premier (USA) **Rp22,900,000**; gigi-palsu page says implant incl. crown normal **Rp25,000,000** (promo Rp9.9M). https://www.sozodental.com/layanan/implan-gigi/
- Smile Lab (Jakarta Selatan): Vistafor normal **Rp17,000,000** (Rp9.9M promo per tooth); Straumann Roxolid normal **Rp35,000,000** (Rp33M promo per tooth). Crown inclusion not stated. https://www.implangigi.co/
- RSKGM Bandung 2026: "Dental Implant" **Rp16,500,000** per tooth.
- RSUD Dr. Soetomo: implant with easy abutment plus crown, per placement, **Rp14,900,000**; angled abutment plus crown **Rp19,000,000**.
- MHDC (chain, multiple cities) advertises "Promo Implan Gigi Mulai dari 9,9 Juta" on https://mhdc.co.id/download-pricelist/ (headline only; the full price list is behind a form and was not requested).

**Suggested range: Rp10,000,000 – Rp35,000,000 per tooth (implant, abutment and crown).** The floor matches the repeated Rp9.9M promo floor. The top is Straumann. Bone graft and sinus lift are excluded.
**Confidence:** confirmed.

## 20. removable_denture

**Observed (private)**
- Sozo: acrylic denture **Rp1,500,000** normal (Rp1.3M promo). FAQ: Valplast about Rp2M per plate; metal frame about Rp2.5M per jaw.
- OMDC: acrylic plus 1 tooth Rp1,200,000; Valplast saddle Rp2,300,000; Valplast bilateral with 2 teeth **Rp3,250,000**.
- Asha: acrylic plus 1 tooth Rp1,300,000; Valplast Rp1,500,000; Thermosens Rp1,950,000; full acrylic 1 jaw **Rp3,750,000**; full acrylic 2 jaws **Rp6,750,000**.
- Puri (Medan): acrylic plus 1 tooth **Rp900,000**; Valplast plus 1 tooth Rp1,700,000; each extra tooth Rp200,000; "GTP Akrilik" (full) Rp2,300,000. https://www.puridental.com/harga-gigi-palsu-medan/
- Lya: "Gigi Palsu" "Starts at Rp1,500,000".
- KGS Jogja: partial acrylic Rp600,000 plate plus Rp200,000–300,000 per tooth; Valplast Rp1,250,000 plate; full acrylic **Rp5,000,000 per jaw**; full metal frame Rp6,000,000 per jaw.
- Andini (Sleman): partial Valplast from Rp1,250,000 per plate; full from Rp3,000,000 per plate.

**Observed (public)**
- RSKGM Bandung 2026: partial acrylic with 1 tooth Rp600,000 per jaw; full acrylic Rp2,500,000 per jaw or Rp4,500,000 for both; Valplast full Rp5,500,000 per jaw.
- RSUD Dr. Soetomo: full denture insertion Rp1,390,800 per jaw, plus try-in and bite-registration fees.
- Semarang puskesmas: acrylic first tooth Rp500,000; each further tooth Rp75,000.

**Suggested range: Rp900,000 – Rp7,000,000 per denture.** The floor is a small acrylic partial. The top is a full acrylic set for both jaws (Asha Rp6.75M) or a full Valplast or metal jaw. This is the widest-spread code, and a note in the app ("tergantung jumlah gigi dan bahan", depends on the number of teeth and the material) would help.
**Confidence:** confirmed.

## 21. denture_repair

**Observed**
- Puri (Medan): "Perbaikan Gigi Palsu Valplast" **Rp900,000**.
- KGS Jogja: repair of partial or full denture **Rp500,000–600,000 per jaw**; rebasing Rp600,000.
- RSKGM Bandung 2026: repair (complex) **Rp350,000**; relining Rp300,000; rebasing Rp450,000.
- RSUD Dr. Soetomo: "Reparasi Gigi Tiruan" **Rp300,000**; relining Rp300,000 per jaw; rebasing Rp500,000 per jaw.

**Suggested range: Rp300,000 – Rp900,000 per repair or reline.**
**Confidence:** likely (two private own pages).

## 22. orthodontic_braces

Fitting package for both jaws. Monthly visits are not included (see 23).

**Observed (private)**
- OMDC: "Ortho Metal + Orthokit" **Rp8,499,000**; Sapphire Rp12,000,000; Signature Express metal Rp13,999,000; self-ligating clear Rp21,000,000; Damon metal **Rp24,000,000**; Damon clear Rp30,000,000.
- Sozo: metal normal **Rp4,900,000** (promo Rp1,799,000); Premium Rp6,050,000; Signature Rp10,000,000; Sapphire Rp11,050,000; self-ligating **Rp16,050,000** normal. https://www.sozodental.com/layanan/behel-gigi/
- Orange: "Behel Gigi" **Rp4,499,000**.
- Teman Dental: metal Rp1,786,000–1,850,000 (promo, May–June 2025).
- Lya: "Braces" "Starts at Rp6,000,000".
- Asha: metal standard, 2 jaws, **Rp3,500,000**; premium USA Rp6,000,000; ceramic Rp8,500,000; self-ligating Rp11,000,000.
- Q-Smile: premium Rp4,000,000 per jaw or **Rp8,000,000** for both.
- Indental (Surabaya): initial fitting **Rp11,000,000**; their own 24-month estimate is Rp18.8M including visits.
- Puri (Medan): metal both jaws **Rp5,000,000** (Rp7M crossed out); 1 jaw Rp3,000,000; Damon self-ligating Rp14,000,000.
- KGS Jogja: "Pasang kawat/behel" **Rp3,000,000**.

**Observed (public)**
- RSKGM Bandung 2026: fixed, upper plus lower, Rp6,660,000; non-metal Rp8,500,000; self-ligating Rp9,000,000.
- RSUD Dr. Soetomo: fixed, upper and lower, Rp6,000,000 (Reguler); Rp6,523,000 (Privat).

**Suggested range: Rp3,000,000 – Rp25,000,000 (fitting, both jaws).** The floor is non-promo metal braces at regional or budget clinics. The top is premium self-ligating in Jakarta. Damon clear (Rp30M) is an outlier above the range. Promo prices of Rp1.5M–1.9M exist but were not used as the floor.
**Confidence:** confirmed.

## 23. orthodontic_adjustment

**Observed**
- Puri (Medan): "Kontrol Behel Bulanan" **Rp130,000**.
- Q-Smile: "Kontrol Behel" Rp200,000.
- Asha: control, 2 jaws, Rp250,000. Transfer patients: Rp250,000 for 1 jaw, **Rp350,000** for 2 jaws.
- Indental: **Rp325,000** per visit.
- RSKGM Bandung 2026: Rp100,000; with wire change Rp175,000; self-ligating with wire change Rp350,000 per jaw.
- RSUD Dr. Soetomo: fixed, upper plus lower, Rp200,000 per month.

**Suggested range: Rp100,000 – Rp350,000 per visit.**
**Confidence:** confirmed.

## 24. clear_aligners

Full treatment.

**Observed**
- Sozo: PETG Basic **Rp14,000,000** normal (Rp11.9M promo), up to 40 trays over 20 weeks; Signature Basic Rp19,000,000 normal (Rp15.9M promo); KLAR Kids Rp9.5M; KLAR Relapse **Rp7.5M**. https://www.sozodental.com/layanan/aligner-gigi/
- Puri (Medan): "Behel KLAR Clear Aligner Transparan" **Rp15,000,000**.
- Invicenter (Jakarta/BSD): Invisalign Express **Rp28,000,000** to Invisalign Comprehensive **Rp85,000,000**.

**Suggested range: Rp12,000,000 – Rp85,000,000 (full treatment).** Two markets sit inside this range. Local-brand aligners for mild cases cost Rp12M–19M. Invisalign costs Rp28M–85M. Relapse-only packages (Rp7.5M) are excluded. The spread is very wide, so consider showing "mulai Rp12 juta" (from Rp12M) or splitting by brand.
**Confidence:** likely. Only 3 private sources, and no public tariff exists.

## 25. teeth_whitening

**Observed**
- OMDC: "Bleaching Gold" **Rp3,900,000**; "Final Lock" **Rp5,000,000**.
- Asha: Rp3,000,000.
- Q-Smile: Rp3,000,000.
- KGS Jogja: Rp2,000,000.
- Puri (Medan): Rp1,500,000.
- Lya: "Starts at Rp1,500,000".
- Orange: **Rp1,149,000**.
- Sozo: Lite "mulai dari" Rp699,000; Extra Rp999,000 (promo-style "mulai dari" prices).
- Teman Dental: Rp785,000–885,000 (promo 2025).
- RSKGM Bandung 2026: extracoronal bleaching Rp3,500,000 per visit.
- RSUD Dr. Soetomo: vital bleaching Rp2,500,000 per jaw.

**Suggested range: Rp1,000,000 – Rp5,000,000 per treatment.** The floor is the lowest normal price (Orange, about Rp1.15M). The top is OMDC's premium package.
**Confidence:** confirmed.

## 26. dental_veneer

**Observed**
- Sozo: direct composite "mulai dari" **Rp599,000** per tooth; porcelain "mulai dari" **Rp5,000,000** per tooth (FAQ says up to Rp10M). https://www.sozodental.com/layanan/veneer-gigi/
- Asha: composite direct Rp900,000; Emax Rp3,500,000; zirconia **Rp3,800,000**.
- Puri (Medan): direct **Rp500,000** per tooth; Emax Rp4,000,000. https://www.puridental.com/harga-veneer-gigi-medan/
- OMDC: "Direct Veneer" Rp1,400,000.
- Q-Smile: composite Rp1,500,000; porcelain Rp3,000,000.
- KGS Jogja: porcelain Rp3,000,000 per tooth.
- RSKGM Bandung 2026: direct composite Rp400,000; compomer Rp650,000; all-porcelain Rp3,000,000. All per tooth.
- RSUD Dr. Soetomo: all-porcelain, 1 tooth, Rp3,544,800; labial composite, 1 tooth, Rp855,600.

**Suggested range: Rp500,000 – Rp6,000,000 per tooth.** Composite runs Rp500k–1.5M and porcelain Rp3M–5M+. The two materials differ a lot in price, so consider a note in the app ("komposit vs porselen").
**Confidence:** confirmed.

## 27. oral_lesion_treatment

**Observed**
- RSKGM Bandung 2026 (Poli Penyakit Mulut): stomatitis treatment **Rp50,000**; topical gel Rp60,000; oral diagnosis Rp125,000; laser treatment light/medium/heavy **Rp500,000 / 750,000 / 1,250,000**; punch biopsy Rp450,000. Specialist visit Rp100,000–120,000 extra.
- RSUD Dr. Soetomo: lesion application treatment **Rp524,400**; mucosal swab Rp594,000.
- No private own page found.

**Suggested range: Rp100,000 – Rp600,000 per visit (consultation plus topical treatment).** Laser treatment and biopsy cost more and are excluded.
**Confidence:** unconfirmed. **Weakly sourced** (public only).

---

## Not found or not usable

- **No private own-page price for:** panoramic X-ray, pulpotomy, abscess drainage, tooth replantation, oral lesion treatment. These ranges rest on public tariffs (RSKGM Bandung 2026, RSUD Dr. Soetomo).
- **Only one private own page:** fissure sealant (Asha) and periapical X-ray (Q-Smile).
- **RSGM USU (Medan), https://rsgm.usu.ac.id/id/tarif-layanan-rsgm:** search snippets show a Keputusan Rektor tariff table, e.g., scaling Rp350,000 for adults, odontectomy class I Rp1,500,000, PFM crown Rp1,200,000, pulpotomy Rp500,000. The server reset every connection (curl and fetch), so I could not read it. It is not cited above.
- **RSGM UGM Prof. Soedomo (Yogyakarta), https://rsgm.ugm.ac.id/tarif/:** the page exists (dated 10 Mar 2025) but has no tariff content.
- **Pergub DKI Jakarta 17/2026** (new RSUD and puskesmas retribusi tariffs, reported Sept 2026): the JDIH PDF (https://jdih.jakarta.go.id/dokumenPeraturanDirectory/0031/2026PERGUB003117.pdf) reset the connection. No Jakarta public tariff was read.
- **Audy Dental, RSKGM FKG UI, RSGM Unpad, RSGM Unhas:** no published price list found.
- **OMDC `/price-list-package`:** returns 404. The prices above come from the live `/omdc-dental` page.
- **Orthopoint Dental price list PDF:** dated July 2021, outside the window, so not used.
- **Medikids/MHDC, ITB Yankes poli gigi:** price list behind an email form, or not rendered in the page. Not used.

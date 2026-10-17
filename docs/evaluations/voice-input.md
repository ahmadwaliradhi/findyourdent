# Voice input evaluation: Gemini native audio on Indonesian dental voice notes

H11 (issue #31). Measures how well Gemini native audio hears Indonesian voice complaints with dental terms, and whether giving it the dental term list helps. ElevenLabs is out of scope (ADR 0010). Everything above **Results** is fixed before the run.

## Runs

Both runs use the same 10 recordings and the production path: `POST /v1/guidance` with `audio` on the agent service, `GEMINI_ADAPTER=vertex`. The `transcript` in the response is what is scored.

- **(a) Baseline**: production as it is.
- **(b) Term list**: production with the dental term list below added to the stable Guidance instruction in `agents/guidance.py` (never in per-request content, so implicit caching still applies).

## Recordings

- Recorded with the app's own record button, so files are production format (webm/opus, 32 kbps).
- At least 2 speakers, on phone microphones; a few notes with light background noise.
- Speakers read the ground-truth sentence at a natural pace.
- Audio is health-related voice data: kept in a private bucket, never committed. Only this file and the results are committed.

## Metrics

For each run and each note:

- **Dental term recall**: share of the note's target terms found in the transcript. Text is lower-cased and punctuation removed; a term counts only as a contiguous match, spelt as written in the table, and may run into a suffix ("akar giginya" counts for "akar gigi"), so every ground truth scores 100%.
- **WER**: word error rate against the ground truth after the same normalisation. Colloquial words ("nggak", "nyut-nyutan") are scored literally.
- **Rule result**: the deterministic Emergency Escalation rule (`escalation.default_matcher()`) run on the transcript. A **transcription problem** is a transcript whose rule result differs from the rule result on its ground truth.
- **Response kind**: what production returned (emergency, guidance, follow-up or redirect), since Gemini's own red flags can escalate where the rule does not.

## Decision rule

- If (b) beats (a) on dental term recall by 10 percentage points or more, with no Emergency Escalation lost, the term list goes into production as a follow-up ticket.
- If either run misses an Emergency Escalation the ground-truth rule result expects, or production does not escalate VN-01 or VN-02, the miss goes to the clinical reviewer as a finding.
- Otherwise production stays as it is. WER is reported but does not decide.

## Ground truth

Urgency Tier is the clinical expectation. **Rule on ground truth** is the deterministic rule run on the exact sentence (checked 17 Oct 2026).

| ID | Urgency Tier | Clinical escalation | Rule on ground truth | Ground truth | Target terms |
| :-- | :-- | :-- | :-- | :-- | :-- |
| VN-01 | darurat | yes | no (fever only) | Pipi kiri bawah saya bengkak besar sampai ke leher dan demam sejak kemarin, ada benjolan abses di gusi dekat gigi geraham yang karies parah, sekarang buat menelan dan buka mulut susah karena trismus. | abses, gusi, geraham, karies, trismus |
| VN-02 | darurat | yes | yes (knocked-out permanent tooth) | Anak saya baru jatuh dari sepeda, gigi seri depannya lepas utuh atau avulsi dari soketnya dan gusi berdarah terus, terus gigi taring sebelahnya mengalami fraktur mahkota. | gigi seri, avulsi, soket, gigi taring, fraktur mahkota |
| VN-03 | segera | no | no | Dok, gusi di bagian gigi bungsu belakang bawah saya bengkak dan nyeri banget buat mengunyah, kata dokter sebelumnya posisinya impaksi miring dan kena perikoronitis. | gigi bungsu, impaksi, perikoronitis |
| VN-04 | segera | no | no | Gigi geraham kanan atas saya sakit berdenyut spontan semalaman sampai nggak bisa tidur, apakah ini gejala pulpitis ireversibel dan harus tindakan perawatan saluran akar? | geraham, pulpitis ireversibel, perawatan saluran akar |
| VN-05 | segera | no | no | Tiga hari lalu saya habis ekstraksi gigi bawah, sekarang bekas cabutannya bau nggak sedap dan sakitnya nyut-nyutan sampai ke telinga, saya khawatir kena dry socket atau osteitis alveolar. | ekstraksi, dry socket, osteitis alveolar |
| VN-06 | segera | no | no | Bracket behel di gigi premolar atas saya lepas waktu makan, terus ujung kawat archwire-nya nusuk mukosa pipi dalam sampai luka dan sariawan. | bracket, behel, premolar, archwire, mukosa, sariawan |
| VN-07 | rutin | no | no | Setiap sikat gigi gusi saya sering berdarah dan warnanya merah bengkak kayak gejala gingivitis, sepertinya banyak karang gigi atau kalkulus yang menumpuk dan butuh scaling. | gingivitis, karang gigi, kalkulus, scaling |
| VN-08 | rutin | no | no | Tambalan komposit di gigi belakang saya pecah waktu ngunyah makanan keras, terus jaket gigi atau crown porselen di sebelahnya ikut goyang dan terasa ngilu. | tambalan komposit, jaket gigi, crown, porselen |
| VN-09 | rutin | no | no | Gusi saya makin turun atau mengalami resesi gingiva sampai lapisan dentin dan akar giginya kelihatan, rasanya ngilu banget kalau minum es dan takutnya mengarah ke periodontitis. | resesi gingiva, dentin, akar gigi, periodontitis |
| VN-10 | rutin | no | no | Sendi rahang dekat telinga saya sering bunyi klik dan terasa kaku waktu bangun tidur karena kebiasaan bruxism atau gemeretak gigi malam hari, apakah ini gangguan temporomandibular? | sendi rahang, bruxism, gemeretak gigi, temporomandibular |

VN-01 does not escalate on the deterministic rule even when heard perfectly: "pipi kiri bawah saya bengkak" has more words between "pipi" and "bengkak" than `max_gap` allows, "menelan dan buka mulut susah" matches no swallowing or trismus phrase, and "trismus" and "abses" are not phrases. Changing the rule is the clinical reviewer's call (see the clinical-review issue linked from #31).

## Dental term list for run (b)

From the product owner's hand-off (issue #31, first comment). The headwords and definitions are in GLOSSARY.md under Dental terms.

```json
[
  "abses", "abses periapikal", "abses gingiva", "selulitis", "Angina Ludwig",
  "trismus", "avulsi", "luksasi", "fraktur mahkota", "fraktur akar",
  "pulpitis", "pulpitis ireversibel", "pulpitis reversibel", "nekrosis pulpa",
  "perikoronitis", "impaksi", "osteitis alveolar", "dry socket", "ekstraksi",
  "odontektomi", "karies", "gingivitis", "periodontitis", "resesi gingiva",
  "kalkulus", "karang gigi", "plak", "scaling", "root planing", "kuretase",
  "perawatan saluran akar", "endodontik", "pulpektomi", "pulpotomi",
  "insisi dan drainase", "restorasi", "tambalan komposit", "resin komposit",
  "glass ionomer", "amalgam", "crown", "jaket gigi", "porselen", "zirconia",
  "veneer", "bridge", "denture", "implan gigi", "behel", "ortodonti",
  "bracket", "archwire", "power chain", "buccal tube", "retainer", "aligner",
  "gigi seri", "insisivus", "gigi taring", "kaninus", "premolar", "geraham",
  "molar", "gigi bungsu", "gingiva", "gusi", "enamel", "email gigi", "dentin",
  "pulpa", "soket", "alveolus", "mukosa", "palatum", "bruxism", "gemeretak gigi",
  "temporomandibular", "sendi rahang", "halitosis", "stomatitis", "sariawan", "maloklusi"
]
```

## Results

Not run yet: waiting for the 10 recordings (human lane).

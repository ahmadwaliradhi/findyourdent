# FindYourDent

A dentistry platform for Indonesia that helps people understand their dental problem and choose a credible, affordable dentist, and gives dentists and clinics a public identity.

## Actors

**Patient**:
A member of the public who has, or may have, a dental problem and is looking for care.
_Avoid_: User (too broad), customer, pasien umum

**Klinik**:
A dental clinic run as a business entity, employing one or more dentists, registered as a health facility.
_Avoid_: Clinic management, dental brand

**Private Dentist**:
A dentist, including a specialist such as an orthodontist, who runs their own independent practice (praktik mandiri dokter gigi) rather than practising as an employee of a Klinik.
_Avoid_: Dokter gigi pribadi, freelance dentist

**Hospital**:
A hospital (rumah sakit) offering dental care, including specialist dentistry and an emergency department (IGD).
_Avoid_: RS gigi (unless it is one), faskes

**Provider**:
Any Klinik, Private Dentist or Hospital that a Patient can choose for dental care; identified by its Google place.
_Avoid_: Clinic (when a Private Dentist or Hospital is also meant), listing, merchant

## Trust and price

**Testimony**:
A Patient's public, signed-in account of a visit to a Provider, with aspect ratings for service, hygiene and materials and equipment, free text of any length, the visit month and year, a public name the author chooses, and optionally the procedure and price paid, clinic photos, and a Proof of Visit. One per Patient per Provider. The author can edit or delete it; a Provider can reply to or report it but never delete it.
_Avoid_: Review (reserved for Google reviews), rating, ulasan

**Proof of Visit**:
An optional private document a Patient attaches to a Testimony, at submission or later (such as a receipt, invoice or appointment card), showing they visited that Provider. It is accepted when its clinic name matches the Provider, its date is within a month of the visit month and it is under 12 months old; doubtful ones go to an admin. It is never published, only whether it was accepted.
_Avoid_: Bukti bayar, verification

**Proven Testimony**:
A published Testimony whose Proof of Visit was accepted, shown as "Kunjungan terbukti". Only Proven Testimonies count toward aspect averages, ranking and price stats; a Provider needs three before a star average is shown. Other published Testimonies are shown as "Belum terbukti".
_Avoid_: Verified review, valid testimony

**Proof Fingerprint**:
What FindYourDent keeps of an accepted or pending Proof of Visit after the file is deleted: a perceptual or file hash plus the clinic name, date and total read from it, never the patient's name. Used only to stop one receipt being reused for several Testimonies.
_Avoid_: Receipt copy, proof hash (alone)

**Testimony Policy Violation**:
A confirmed finding that a Provider offered something in exchange for Testimonies or asked only selected Patients to write them; shown on the Provider page for six months as "Pelanggaran kebijakan testimoni", and the Testimonies from that period stop counting.
_Avoid_: Ban, penalty, review fraud

**Moderation**:
The screening every Testimony passes: Gemini publishes clean ones and holds doubtful ones, and the FindYourDent team makes every decision on held or reported Testimonies and every removal.
_Avoid_: Review (as a verb), filtering

**Hold**:
A Testimony state where it is not public and waits for an admin decision because Moderation flagged it; a published Testimony hidden after a report also waits for an admin decision.
_Avoid_: Pending, rejected, draft

**Listed Provider**:
A Provider that FindYourDent has its own record for, created automatically by its first published Testimony or by a Claim. Its name is typed by the first Testimony author (or set by its Claim) and its Region is chosen from the official list; only Listed Providers appear in the directory and the feed.
_Avoid_: Seeded provider, registered provider

**Region**:
The official Indonesian administrative area of a Listed Provider or Testimony: province and kota/kabupaten (always required) and kecamatan (optional), from the Kemendagri region code list.
_Avoid_: Location (reserved for coordinates), area, city

## Guidance

**Guidance**:
The agent's educational answer to a Patient's complaint: urgency, likely problem category, single-visit or multi-visit journey, why prices vary, and BPJS coverage. Never a diagnosis.
_Avoid_: Diagnosis, triage result, konsultasi

**Emergency Escalation**:
The rule that sends a Patient to a Hospital's IGD immediately, ahead of any Guidance or Shortlist, when red flags such as facial swelling with fever or difficulty swallowing or opening the mouth are present.
_Avoid_: Triage, urgent tier

**Urgency Tier**:
How soon a Patient should see a dentist, as stated on a Guidance or an Emergency Escalation: darurat (IGD now, only with an Emergency Escalation), segera (within 1 to 3 days), terjadwal (within 2 weeks) or rutin (routine care).
_Avoid_: Triage category, mendesak, non-darurat

**Shortlist**:
Up to five Providers near the Patient that the agent recommends after Guidance, each with a one-line reason.
_Avoid_: Search results, directory, recommendations

## Insurance

**FKTP**:
The first-level health facility a BPJS Kesehatan member is registered with; the member's covered dental care happens there or at its partner dentist.
_Avoid_: BPJS clinic, faskes (unqualified)

**Payment Method**:
How a Patient paid for the visit a Testimony describes: Pribadi (out of pocket), BPJS, or Asuransi swasta with the insurer named. It is a fact about that visit, never a claim about what a Provider accepts; dental plafon belongs to the Patient's policy and is never shown.
_Avoid_: Accepts BPJS, menerima BPJS, insurance partner, plafon (as a Provider fact)

## Dental terms

The words Patients and dentists use for teeth, conditions and treatments. Each headword is the word a Patient is most likely to say; clinical and English synonyms follow in brackets. Being listed here does not make a condition an Emergency Escalation red flag.

### Anatomy

**Gigi Seri (Insisivus, incisor)**:
A front tooth, used for cutting food.

**Gigi Taring (Kaninus, canine)**:
The pointed corner tooth, used for tearing food.

**Premolar (Gigi Geraham Kecil, bicuspid)**:
A tooth between the canine and the molars.
_Avoid_: Geraham (alone, which means a molar)

**Geraham (Molar)**:
A back tooth, used for chewing.

**Gigi Bungsu (Molar ketiga, wisdom tooth)**:
The rearmost molar, the last tooth to erupt.

**Gigi Susu (Gigi desidui, baby tooth)**:
A childhood tooth that a permanent tooth later replaces.

**Gusi (Gingiva)**:
The soft tissue around the necks and roots of the teeth.

**Email Gigi (Enamel)**:
The hard outer layer of a tooth.

**Dentin**:
The layer beneath the enamel, sensitive to cold, heat and sweetness.

**Pulpa (Pulp)**:
The centre of a tooth, holding its nerve and blood vessels.
_Avoid_: Saraf gigi (as a clinical term)

**Saluran Akar (Root canal)**:
The space inside a tooth root that holds the pulp.

**Soket (Alveolus, tooth socket)**:
The hole in the jawbone that a tooth root sits in.

**Mukosa (Oral mucosa)**:
The lining of the mouth, including the inner cheeks and lips.

**Langit-langit (Palatum, palate)**:
The roof of the mouth.

**Sendi Rahang (Sendi temporomandibular, TMJ)**:
The hinge joint between the lower jaw and the skull.

### Acute conditions

**Abses (Abses periapikal, gingiva or periodontal; dental abscess)**:
A collection of pus from a bacterial infection at a tooth root or in the gum, with swelling and severe pain.
_Avoid_: Infeksi (when an abscess is meant), bisul gusi

**Selulitis Fasialis (Facial cellulitis)**:
Acute bacterial infection that has spread into the soft tissue of the face, with widening swelling and redness.

**Angina Ludwig (Ludwig's angina)**:
Severe cellulitis on both sides of the floor of the mouth that can block the airway.

**Trismus**:
Being unable to open the mouth normally, from jaw muscle spasm or infection.
_Avoid_: Lockjaw (tetanus)

**Avulsi (Avulsion, knocked-out tooth)**:
A whole tooth knocked out of its socket by trauma.
_Avoid_: Gigi copot (when a baby tooth falling out is meant)

**Luksasi (Luxation: extrusion, intrusion, subluxation)**:
A tooth moved within its socket by trauma: loosened, pushed in or partly pushed out.

**Fraktur Mahkota / Fraktur Akar (Crown or root fracture)**:
A break in the crown or root of a tooth from trauma.

**Pulpitis Ireversibel (Irreversible pulpitis)**:
Severe inflammation of the pulp with spontaneous, throbbing, lasting pain, often worse at night.

**Perikoronitis (Pericoronitis)**:
Inflammation and infection of the gum around a partly erupted tooth, usually a Gigi Bungsu.

**Dry Socket (Osteitis alveolar)**:
Severe pain two to four days after an Ekstraksi, when the blood clot is lost from the socket, often with a bad smell.

**Perdarahan Pasca-Ekstraksi (Post-extraction bleeding)**:
Active bleeding that has not stopped several hours after an Ekstraksi.

### Non-acute conditions

**Gigi Berlubang (Karies, caries, cavity)**:
Decay of the hard tissue of a tooth from acid made by plaque bacteria.

**Pulpitis Reversibel (Reversible pulpitis)**:
Mild inflammation of the pulp with brief pain only when cold or sweet touches the tooth.

**Nekrosis Pulpa (Pulp necrosis)**:
Death of the pulp.
_Avoid_: Gigi mati (as a clinical term)

**Impaksi (Impacted tooth)**:
A tooth, usually a Gigi Bungsu, that cannot erupt normally because another tooth or the jawbone blocks it.

**Gingivitis**:
Early gum inflammation: red, swollen gums that bleed easily when brushing.

**Periodontitis**:
Advanced gum infection that destroys the supporting tissue and bone, so teeth loosen.
_Avoid_: Gingivitis (for the advanced stage)

**Gusi Turun (Resesi gingiva, gum recession)**:
The gum edge shrinking back so the root is exposed and becomes sensitive.

**Karang Gigi (Kalkulus, tartar)**:
Plaque hardened by minerals on the teeth and along the gum line.
_Avoid_: Plak (for the hardened form)

**Plak (Dental plaque)**:
The soft, colourless film of bacteria on the teeth.

**Gigi Sensitif (Hipersensitivitas dentin, ngilu)**:
Short, sharp pain from exposed Dentin.

**Bruxism (Gemeretak gigi, tooth grinding)**:
Grinding or clenching the teeth without noticing, mostly during sleep.

**Halitosis (Bau mulut)**:
Chronic bad breath.

**Sariawan (Stomatitis aftosa, mouth ulcer)**:
A painful round or oval white-yellow sore on the Mukosa.

**Maloklusi (Malocclusion)**:
Misaligned teeth or a bite where the upper and lower jaws do not meet properly.

### Procedures and restorations

**Scaling (Pembersihan karang gigi)**:
Removing Karang Gigi and Plak with an ultrasonic instrument.

**Root Planing (Kuretase)**:
Deep cleaning of root surfaces to treat Periodontitis.

**Cabut Gigi (Ekstraksi, extraction)**:
Removing a tooth from its socket.

**Odontektomi (Odontectomy)**:
Minor surgery to remove an Impaksi tooth.
_Avoid_: Cabut gigi (when surgery is meant)

**Perawatan Saluran Akar (PSA, endodontik, root canal treatment)**:
Cleaning, shaping and filling an infected Saluran Akar.

**Pulpektomi / Pulpotomi (Pulpectomy, pulpotomy)**:
Removing all or part of the Pulpa.

**Insisi dan Drainase (Incision and drainage)**:
A small cut into an Abses to let the pus out and relieve pressure.

**Tambal Gigi (Restorasi, filling)**:
Repairing a decayed or broken tooth.

**Tambalan Komposit (Resin komposit, composite filling)**:
A tooth-coloured filling hardened with light.

**GIC (Glass ionomer cement, semen ionomer kaca)**:
A filling material that releases fluoride.

**Tambalan Sementara (Temporary filling)**:
A material that closes a cavity between treatment visits.

**Crown (Mahkota tiruan, jaket gigi; porselen or zirconia)**:
A permanent artificial cap over a badly damaged tooth or one after Perawatan Saluran Akar.

**Veneer**:
A thin porcelain or composite layer bonded to the front of a tooth.

**Bridge (Gigi tiruan jembatan)**:
A fixed false tooth or teeth replacing one or more missing teeth.

**Gigi Palsu (Denture, gigi tiruan lepasan)**:
A removable prosthesis replacing missing teeth.
_Avoid_: Bridge (for a removable one)

**Implan Gigi (Dental implant)**:
An artificial titanium root placed in the jawbone.

### Orthodontics

**Behel (Kawat gigi, braces, ortodonti)**:
An appliance that straightens the teeth.

**Bracket**:
A small block bonded to a tooth that holds the Archwire.

**Archwire (Kawat ortodonti)**:
The main curved wire that links the Brackets.

**Karet Behel (O-ring, power chain, elastik)**:
An elastic that ties the wire to a Bracket or closes a gap.

**Buccal Tube / Molar Band**:
A metal ring or tube fitted on a back Geraham that anchors the wire.

**Lilin Behel (Ortho wax)**:
Wax that covers a sharp Bracket or wire so it does not hurt the Mukosa.

**Retainer**:
An appliance worn after Behel treatment to hold the teeth in place.

**Clear Aligner**:
A removable transparent appliance that straightens teeth without wires or Brackets.

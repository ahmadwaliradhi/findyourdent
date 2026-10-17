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
An optional private document a Patient attaches to a Testimony (such as a receipt or appointment confirmation) showing they visited that Provider; it is never published, only whether it was accepted.
_Avoid_: Bukti bayar, verification

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

**Shortlist**:
Up to five Providers near the Patient that the agent recommends after Guidance, each with a one-line reason.
_Avoid_: Search results, directory, recommendations

## Insurance

**FKTP**:
The first-level health facility a BPJS Kesehatan member is registered with; the member's covered dental care happens there or at its partner dentist.
_Avoid_: BPJS clinic, faskes (unqualified)

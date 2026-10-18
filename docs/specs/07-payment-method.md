---
title: "Spec 07: Payment Method"
labels: [needs-triage]
owner: B (web), with A for the Moderation prompt
depends_on: ["03", "04", "05"]
cut_order: not in the submission build
---

# Spec 07: Payment Method

## Problem Statement

Before choosing a Provider, a Patient wants to know whether they can pay the way they have to: out of pocket, with BPJS Kesehatan, or with their private health insurance (Prudential, Allianz, AXA Mandiri and so on). FindYourDent answers BPJS coverage per procedure in Guidance (spec 01), but says nothing about how Patients actually paid at a given Provider, and nothing about private insurance.

Two shortcuts look tempting and are both wrong:

- **Scraping insurers' provider networks.** They are published as PDFs or search widgets (often through TPAs such as AdMedika, Owlexa or Fullerton), in inconsistent formats, mostly for hospitals and large clinics, and they go stale. Matching their names to our Providers is fuzzy. ADR-0001 already rejected scraping as a data source.
- **Showing a dental plafon (annual limit) per Provider.** The plafon belongs to the member's policy and dental rider, not to the Provider: two Patients at the same clinic with the same insurer can have different limits.

A third trap is the phrase "accepts BPJS". A BPJS member's covered dental care happens at the FKTP they are registered with, or by referral (`docs/research/facts-2026-10-16.md` §2), so a Provider "accepting BPJS" does not mean any member can walk in.

## Solution

Each Testimony can say how its author paid for that visit: Pribadi, BPJS, or Asuransi swasta with the insurer picked from a curated list (or typed in when it is missing). It is a fact about the author's own visit, which the author knows, never a claim about what the Provider accepts in general. The Provider page shows how many Patients reported each Payment Method, with a note explaining FKTP. Patients can filter the directory and feed by Payment Method, and Shortlist cards for Listed Providers show the methods reported there. Later, a claimed Provider can declare the insurers it works with and its BPJS role, shown separately and labelled as the owner's statement.

## User Stories

1. As a Patient writing a Testimony, I want to say how I paid (Pribadi, BPJS, or my insurer), so that other Patients know which payment works there.
2. As a Patient writing a Testimony, I want to skip the question or answer "tidak ingat / tidak mau sebut", so that I am not forced to share it.
3. As a Patient whose insurer is not on the list, I want to type its name, so that my answer is still recorded.
4. As a Patient who paid with BPJS, I want not to be asked for a price, so that I do not enter a misleading Rp0.
5. As a Patient who paid with private insurance, I want to enter the total bill if I know it, so that my answer still helps the price signals.
6. As an author of an earlier Testimony, I want to add my Payment Method by editing, so that older Testimonies can contribute.
7. As a Patient, I want to see on a Provider page how many Patients paid with each method and each insurer, so that I can judge whether my payment will work.
8. As a BPJS member, I want the Provider page to explain FKTP and link to the Guidance explanation, so that I do not assume I can walk in with my BPJS card.
9. As a Patient, I want to filter the directory and feed to Providers where Patients paid with BPJS or with my insurer, so that I only see places that fit.
10. As a Patient looking at the Shortlist, I want each Listed Provider's card to show the reported Payment Methods, so that I can compare without opening every page.
11. As a claimed Provider, I want to declare the insurers I work with and whether I am an FKTP or a BPJS referral hospital, so that Patients see my own statement.
12. As a Patient, I want owner-declared insurers shown apart from Patient reports and labelled "menurut pemilik", so that I can tell the two sources apart.
13. As the FindYourDent team, I want typed insurer names screened by Moderation and mappable to the curated list, so that the page shows clean names.

## Implementation Decisions

- **Testimony field.** Optional `paymentMethod`: `pribadi`, `bpjs`, `asuransi` (with an insurer from the curated list, or free text "lainnya"), or `tidakDisebut`. Absent on old Testimonies; no backfill. Editing a Testimony can add or change it, and goes through Moderation like any edit.
- **Wording.** The form asks about the author's own visit ("Bagaimana Anda membayar kunjungan ini?"). No screen, label or agent answer says a Provider "accepts BPJS" or "menerima BPJS".
- **Price rule.** When the Payment Method is `bpjs`, the price field is hidden and no price is stored. When it is `asuransi`, the price field is labelled "total tagihan" (the full bill before the insurer pays) and stays optional. `pribadi` and unspecified keep the current price field. Price aggregates keep a single meaning: the full bill.
- **Aggregates.** Counts per Payment Method, and per insurer within `asuransi`, are recomputed with the other aggregates whenever a Testimony enters or leaves `published`. Counts show from N=1. Verified visits are not split out. Free-text insurers that are not mapped count under "Asuransi lain".
- **Provider page.** A "Cara bayar pasien" block lists each method and insurer with its count ("3 pasien bayar pakai BPJS"), plus a short FKTP note linking to the Guidance BPJS explanation. When no Testimony reports a method, the block says so rather than disappearing silently.
- **Curated insurer list.** Stored in the contracts package as a fixed list of slugs and display names, shared by the web app and the agent service. The draft list below must be verified before build.
- **Free text.** "Lainnya" names (up to 60 characters) are screened by the existing Gemini Moderation as one more field (no personal data, no junk, no promotion). Admins map a free-text name to a curated slug by editing Firestore by hand; the next aggregate recompute picks it up. No admin UI unless volume grows.
- **Directory and feed filter.** URL parameter `bayar` with values `bpjs`, `asuransi` (any private insurer) or an insurer slug. Filtered in memory like the procedure filter: a Provider matches when at least one published Testimony reports that method.
- **Shortlist.** Cards for Listed Providers show a chip with the reported Payment Methods. Places-only results show nothing. The agent does not rank or filter by Payment Method.
- **Owner-declared phase.** `ownerFacts` gains `acceptedInsurers` (curated slugs, plus free text) and `bpjsRole` (`fktp`, `rujukan` for a referral hospital, or `tidak`). Screened by the Provider-facts Moderation rules from spec 05. Shown in its own block labelled "menurut pemilik", never merged with Patient counts and never used for the filter.

### Draft curated insurer list (verify before build)

Mandiri Inhealth, Prudential, Allianz, AXA Mandiri, Manulife, AIA, BNI Life, BRI Life, Sinarmas MSIG Life, Equity Life, FWD, Asuransi Astra (Garda Medika), Chubb Life, Generali, Great Eastern Life, Sequis, Avrist.

Patients often know their card by its TPA (AdMedika, Owlexa, Fullerton Health) rather than by the insurer. Decide during verification whether TPAs appear as their own entries or as hints next to insurer names.

## Testing Decisions

- Seams: the web service HTTP API against the Firebase emulators, with the agent faked; the agent Moderation contract with Gemini faked.
- Web API tests: a Testimony with each Payment Method validates and publishes; `bpjs` with a price is rejected; counts per method and per insurer are recomputed on publish, edit and removal; an unmapped free-text insurer counts as "Asuransi lain" and moves to its insurer after mapping; the `bayar` filter returns only matching Providers; owner-declared insurers never change counts or filter results.
- Agent contract test: the free-text insurer field is screened, and a phone number in it leads to `authorFix`.
- E2E: posting a Testimony with BPJS hides the price field and the Provider page shows the count.
- Prior art: spec 03 and spec 04 API tests.

## Out of Scope

- Plafon or coverage limits of any kind.
- Scraping or importing insurer provider networks.
- Ranking or filtering in the agent by Payment Method.
- Verifying BPJS FKTP status against BPJS systems (no public API; `docs/research/facts-2026-10-16.md` §6).
- An admin UI for mapping free-text insurers.

## Further Notes

- Tickets: T22 (Testimony field and Provider page counts) first; T23 to T27 are each blocked only by T22.
- Not in the submission build. Build only if changes during evaluation are allowed.

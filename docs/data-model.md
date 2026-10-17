# Firestore data model

Top-level collections in the default Firestore database (`asia-southeast2`), from spec 00 with details from specs 02 to 05. The TypeScript types live in `packages/contracts/src/firestore.ts` (`import { COLLECTIONS, type ProviderDoc } from "@findyourdent/contracts/firestore"`). Keep this file and those types in step; a test in `packages/contracts` checks that every collection is documented here.

## Ground rules

- **Google data.** The only Google data ever stored is `placeId` (indefinitely) and coordinates with their fetch date (`location.fetchedAt`, refreshed or deleted within 30 days). No Google name, address, phone, opening hours, rating, `types` list, review or photo is written to Firestore, caches or logs (ADR-0005, spec 02). Google's display name is held in memory only, for the picker and for Moderation.
- **No health text in logs or storage beyond what the Patient publishes.** Complaint text and voice notes are never stored (spec 00). Moderation decisions keep rule codes and spans, not the moderated text.
- **Access.** The browser never reads or writes Firestore or Storage directly (`firestore.rules` and `storage.rules` deny everything); the web service uses firebase-admin.
- **Timestamps** are Firestore `Timestamp`s, typed structurally as `Timestamp` so the contracts package has no Firebase dependency.
- **Region** is always a `RegionRef` of Kemendagri codes from `packages/contracts/data/regions.json`: `provinceCode` (`NN`) and `regencyCode` (`NN.NN`, kabupaten/kota) required, `districtCode` (kecamatan) optional.
- **Procedures** are codes from `packages/contracts/data/procedures.json`.

## Collections

### `providers`

A Listed Provider. **Document id = `placeId`.** Created by the first published Testimony for that place (spec 03) or by a Claim (spec 05). Type `ProviderDoc`.

| Field | Notes |
| --- | --- |
| `placeId` | Google place id, same as the document id. |
| `name`, `nameSource` | First-party name typed by the first Testimony author (`testimonyAuthor`) or set by an approved Claim (`claim`). Never Google's name. |
| `nameNormalized` | For prefix search in the directory (spec 04). |
| `region` | `RegionRef`. |
| `location` | `{ lat, lng, fetchedAt }` from a Place Details Essentials call; refreshed monthly, deleted when older than 30 days and not refreshable. |
| `providerType`, `providerTypeSource` | `klinik`, `privateDentist` or `hospital`; `inferred` (shown "perkiraan") or `claimed`. |
| `claimStatus`, `claimId` | `unclaimed` or `claimed`. Never affects ranking. |
| `ownerFacts` | Owner-entered name, type, Region, address, phone, WhatsApp, opening hours, services; screened by Moderation (Provider-facts rules). A held edit (any rule hit) waits in `pendingOwnerFacts` while the published `ownerFacts` stay live. Once published, name, type and Region are copied to the top-level fields (`nameSource: "claim"`, `providerTypeSource: "claimed"`) and the Region and type to the place's Testimonies. Removed when the Claim is revoked. |
| `aggregates` | `testimonyCount`, `verifiedVisitCount`, aspect `averages`, `procedurePrices` (count, median, min, max per procedure). Recomputed whenever a Testimony enters or leaves `published`. |
| `listedBy`, `createdAt`, `updatedAt` | |

Indexes (`firestore.indexes.json`): each of `region.provinceCode`, `region.regencyCode`, `region.districtCode` and `providerType` with `aggregates.testimonyCount desc` (directory) and with `nameNormalized` (prefix search); Firestore merges them when filters combine.

### `testimonies`

A Patient's Testimony. Random document id (the author uid never appears in a URL). One per author per Provider among Testimonies that are not `deleted` (an author delete is erasure, so it frees the place for a new one), enforced in a transaction that queries `authorUid` + `placeId`. Type `TestimonyDoc`.

| Field | Notes |
| --- | --- |
| `placeId`, `region`, `providerType` | Region and type copied from the Listed Provider for feed filters (spec 04). Before the place is Listed: the Region the author picked and the type inferred from the typed name. |
| `proposedProviderName` | The name the author typed for a place not yet Listed. Names the Listed Provider when the Testimony is first published, then removed. Never Google's name. |
| `authorUid`, `displayName` | Uid is never shown; display name defaults to first name plus initial. |
| `ratings` | `service`, `hygiene`, `materialsEquipment`, each 1 to 5. |
| `text`, `visitMonth`, `procedureCode`, `pricePaidRupiah`, `photoPaths` | Text up to 10,000 characters; up to four photos, EXIF stripped. |
| `status` | `submitted`, `published`, `needsAuthorFix`, `held`, `rejected`, `hidden`, `removed`, `deleted` (state machine in spec 03). Moderation's authorFix stores nothing, so `needsAuthorFix` comes only from the admin queue's "send back to the author". |
| `verifiedVisit`, `proofOfVisit` | Kunjungan terbukti and the check result with its date. The Proof of Visit file itself is deleted right after the check. |
| `authorFixRounds` | authorFix rounds used before this version was stored (the next authorFix after three is held). An authorFix itself stores nothing on the Testimony; the count waits in `counters` meanwhile. |
| `pendingRevision` | Edit of a published Testimony under Moderation; the public fields stay visible until it is decided. |
| `reply` | The claimed Provider's one public reply (editable), with its own Moderation status and the `claimId` it was written under; shown only while that Claim is the place's current one. |
| `consent`, `moderationDecisionId`, `adminReason`, `createdAt`, `updatedAt`, `publishedAt`, `deletedAt` | On `deleted`, text, photos (and their stored objects), any pending revision and reply are removed. |

Indexes: `status` + `publishedAt desc` (feed), plus `region.*`, `procedureCode`, `providerType`, `verifiedVisit` combinations for feed filters; `placeId` + `status` + `publishedAt desc` (Provider page); `authorUid` + `placeId` (uniqueness).

### `testimonyReports`

Reports from anyone (category `personalData`, `threat`, `falseClaim`, `spam`, `conflictOfInterest`, `other`). `personalData` and `threat` set the Testimony to `hidden` immediately (`hidTestimony: true`). Every report goes to the admin queue with a 24-hour target. Type `TestimonyReportDoc`.

### `claims`

Claims by owners, practising dentists or managers (spec 05). States `submitted`, `approved`, `rejected` (with `rejectionReason`), `revoked`. One active Claim (`submitted` or `approved`) per `placeId`. `permitDocumentPath` points to the private bucket (`claims/{claimId}/permit-*`, images stripped of metadata) and is deleted (with the file) when the Claim leaves `submitted`; only the decision, reviewer and date stay. The Google phone number the reviewer calls is fetched live and never stored. A Claim on a place that is not Listed carries `proposedProviderName` and `proposedRegion`, and approving it creates the Listed Provider (`listedBy: "claim"`). Type `ClaimDoc`.

Queries: `placeId` + `status in [submitted, approved]` (one active Claim), `status` (admin queue), `claimantUid` + `placeId` (the Claim page).

### `priceLists`

Owner-confirmed price lists (spec 05). An upload by the approved claimant is stored as a `draft` with no rows (the rows Gemini read go back to the owner only); confirming stores exactly the rows the owner confirmed (`procedureCode` when it maps to the shared list, `procedureText`, `minRupiah`, `maxRupiah`, `unit`, `notes`), sets `status: "current"` and `confirmedAt`, and sets the place's previous current list to `replaced` in the same transaction. Every list carries `source: "ownerPriceList"` (shown as "Daftar harga dari pemilik"), `uploadedAt` and the `claimId` it was uploaded under; it is shown only while that Claim is the place's current one. Lists confirmed more than 12 months ago show "mungkin sudah berubah". The originals (`originalDocumentPaths`: `priceLists/{priceListId}/original-*`, one PDF or up to five photos stripped of metadata) are kept privately for 30 days (`originalDeleteAfter`), then deleted by the uploads bucket's lifecycle rule (infra/gcp/setup.sh). A failed extraction stores nothing. Type `PriceListDoc`.

Queries: `placeId` + `status` (the current list of a place; `in` on `placeId` for the Shortlist).

### `moderationDecisions`

One document per Moderation call on a Testimony, Testimony revision, reply or owner facts: `decision`, `ruleCodes`, `flaggedSpans`, `flaggedPhotos`, `confidence`, `proofOfVisit` result, `model` (or `fallback` when the call failed and the content was held), `spotCheck` (the 10% admin sample of Moderation publishes) with `spotCheckConfirmed` (false until an admin confirms it in the queue). It never stores the moderated text or images. Type `ModerationDecisionDoc`.

### `nameCorrections`

"Sarankan koreksi" suggestions on a Listed Provider's first-party name or Region (spec 03), made by a signed-in user from the Testimony form. Each stores the `placeId`, the suggested name and/or Region (at least one), the current values at suggestion time, the suggester's uid, a status (`open`, `applied`, `dismissed`) and who resolved it when. Suggestions land in the admin queue; the Provider changes only when an admin applies one (`applyNameCorrection` in `adminActions`). Type `NameCorrectionDoc`. Applying one changes the Provider's name and Region and the Region copied onto its Testimonies.

### `adminActions`

Append-only audit log of every admin action (publish, reject, send back to the author, hide, remove, dismiss report, approve, reject or revoke a Claim, apply or dismiss a name correction, confirm a spot check), with the admin's email and uid, subject, reason and status change. Reasons are required to reject, send back, hide or remove; the author sees the reason on reject, send back and remove. Type `AdminActionDoc`.

### `counters`

Single-value counters (`{ value, updatedAt, expiresAt? }`), incremented with `FieldValue.increment`. Type `CounterDoc`.

- Impact counters (spec 04), ids in `IMPACT_COUNTERS`: `impact.testimoniesPublished`, `impact.listedProviders`, `impact.guidanceSessionsCompleted`, `impact.verifiedVisits`. The Listed Provider count and the distinct kota/kabupaten count are computed from `providers` when read, so `impact.listedProviders` is not written.
- Daily paid-API usage for the adapter-side caps (spec 02): `quota.places.<method>.<YYYY-MM-DD>` and `quota.gemini.<model>.<YYYY-MM-DD>`, Asia/Jakarta date, built with `dailyQuotaCounterId`. `expiresAt` lets a Firestore TTL policy delete old days.
- Fix-before-submit rounds (spec 03): `authorFix.<uid>.<placeId>`, built with `authorFixCounterId`. Counts the authorFix answers a Patient has had on their Testimony for one place, since nothing else is stored for them; deleted when a submission is stored, else gone 30 days later through `expiresAt`.

### `rateLimits`

Fixed-window rate-limit counters (spec 00): per App Check token and per session for paid routes, per user for writes, and the high per-IP ceiling. Document id `${scope}.${keyHash}.${route}.${windowStartEpochSeconds}`; `keyHash` is a salted SHA-256, so no raw IP address, token or session id is stored. `expiresAt` is the Firestore TTL field. Type `RateLimitDoc`.

## Open points

- TTL policies on `rateLimits.expiresAt` and `counters.expiresAt` are a console or `gcloud` step, not code.

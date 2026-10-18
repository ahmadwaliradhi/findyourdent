# Places for coverage, Listed Providers for everything browsable

Supersedes ADR-0001. Calling Places on every view (0001) costs about USD 225 at 2,000 sessions, and a first-party-only directory (biayasekolah.id style) needs manual seeding, which we refused. So Google Places is used live only where it helps a Patient decide: the Shortlist (one Text Search per Shortlist at the Pro tier, without Google rating, about 5,000 free a month), the Google block on a Provider page (one Place Details call, loaded by the browser through an App Check-protected API), and Google Reviews (loaded only when tapped). Everything browsable (landing feed, directory, Listed Provider pages) is served from FindYourDent's own data at zero Places cost and is indexable.

Google's terms allow storing only `place_id` (indefinitely) and coordinates (up to 30 days), so a Listed Provider's name is typed by its first Testimony author and its Region is picked from the Kemendagri list; Google's name is shown only live in the picker and compared in memory during Moderation, never stored. Coordinates are refreshed monthly with the cheapest Details tier.

## Consequences

- Places spend above the free allowances is capped at USD 10 a month through daily per-method caps; when a cap is hit, the Shortlist falls back to nearby Listed Providers plus a free Google Maps search link instead of failing.
- Shortlist cards show Testimony scores, not Google stars; Google rating appears on the Provider page.
- A Provider with no Testimony and no Claim exists only as live Google data and its page is `noindex`.
- Every Provider is keyed by its `place_id`, as in ADR-0001: a place that is not on Google Maps cannot be Listed, claimed or given a Testimony. The picker says so when nothing matches.

---
status: superseded by ADR-0005
---

# Provider data comes from Places API at request time; only place IDs are stored

The original idea was to scrape Google Maps (profiles and reviews) into our own directory. Google Maps Platform Terms 3.2.3(a) forbid scraping, the hackathon terms forbid third-party-protected content and make the team indemnify the organiser, and the repository is public. So every Provider is a Google place: list and detail pages fetch all available fields from Places API (New) live, and FindYourDent persists only the `place_id`, with first-party data (Testimonies, Claims, Price Lists) keyed by it. Google Reviews are displayed live with Google attribution and a link to Google Maps, never cached.

## Consequences

- No seeding work: the directory is whatever Places returns plus our overlay.
- Every page view costs Places Details calls (Enterprise and Atmosphere SKUs for reviews), so field masks and a billing budget alert are required.
- A Provider that is not on Google Maps cannot exist on FindYourDent.

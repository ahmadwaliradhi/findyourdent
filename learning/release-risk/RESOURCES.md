# Resources

## Primary

- [Martin Fowler, "Parallel Change"](https://martinfowler.com/bliki/ParallelChange.html): the expand / migrate / contract pattern for changing an interface without breaking its callers. Best single read for the agent-to-web contract change in spec 09.
- [Cloud Run: rollbacks, gradual rollouts and traffic migration](https://cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration): deploy a revision with no traffic, test it on a tag URL, then move traffic; roll back by moving traffic to the old revision.
- [Google SRE book, "Reliable Product Launches at Scale"](https://sre.google/sre-book/reliable-product-launches/): launch checklists, gradual rollouts, and why launches are where outages come from.
- [Firestore: index overview](https://firebase.google.com/docs/firestore/query-data/index-overview): composite indexes build in the background; queries needing them fail until ready.
- [Firestore: choose a data structure](https://firebase.google.com/docs/firestore/manage-data/structure-data): schemaless documents, so old and new shapes live side by side.

## Project sources

- `docs/specs/09-proven-testimonies-and-buzzer-defence.md` and `docs/adr/0011-only-proven-testimonies-count.md`: release recompute, no grandfathering, 3-proven minimum.
- `docs/specs/07-payment-method.md`: optional field, no backfill; "Not in the submission build".
- `infra/gcp/README.md` and `infra/gcp/deploy.sh`: deploy order (agent, then web), indexes, smoke test.
- `docs/hackathon-brief.md` and issue #26: evaluation window, no retries.

## Communities

- [r/devops](https://www.reddit.com/r/devops/) and the [Google Cloud Community](https://www.googlecloudcommunity.com/) for release and Cloud Run questions.

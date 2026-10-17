# Google Cloud and Firebase project

`setup.sh` provisions the project for spec 00 (ticket H01). It is idempotent: rerun it after a failure or to converge drift.

```bash
gcloud auth login
gcloud auth application-default login
ADMIN_EMAILS="a@example.com,b@example.com" infra/gcp/setup.sh
```

`ADMIN_EMAILS` is only needed the first time or to change the allowlist.

## What exists

| Thing | Value |
| --- | --- |
| Project | `findmydent` (number 855924446362) |
| Billing account | `019521-D61E16-A0C8A3` (billed in IDR) |
| Region | `asia-southeast2` (Jakarta) |
| Firestore | `(default)`, Native mode, Jakarta |
| Bucket | `gs://findmydent-uploads`, uniform access, public access prevented |
| Firebase web app | `1:855924446362:web:96da14cf25757512e17b23` |
| reCAPTCHA Enterprise site key (App Check) | `6LfbCfMtAAAAAPAei2zMHtYHPXei7ydTKmJoFcSF` (score-based; public by design) |
| Service accounts | `fyd-web@findmydent.iam.gserviceaccount.com`, `fyd-agent@findmydent.iam.gserviceaccount.com` |
| Secrets (Secret Manager, Jakarta) | `places-api-key` (API key restricted to Places API (New)), `admin-emails` (comma-separated allowlist) |
| Budget | `findyourdent-usd100`: IDR 1,650,000 (about USD 100) on the whole billing account, alerts at 50% and 90% |

The admin allowlist is kept in Secret Manager instead of the repository because the repository is public and the addresses are personal data.

## Daily caps

| Quota | Cap | Why |
| --- | --- | --- |
| Places Text Search | 160/day | Shortlist search, spec 02 |
| Places Get Place | 83/day | Google block (50) plus Google Reviews (33); both are Place Details, so the web adapter enforces the split |
| Places Autocomplete | 300/day | |
| Places Nearby, Photos, media and review-post methods | 0/day | Never called by the specs |
| Gemini 3.8 Flash input tokens (global) | 2,000,000/day | About 250 sessions at two 4k-token calls |
| Gemini 3.5 Flash-Lite input tokens (global) | 1,000,000/day | Moderation and extraction |

Gemini has no requests-per-day quota on Vertex AI, so the daily input-token quota is the cap. The coordinates calls in spec 02 (Place Details Essentials) also count against the Get Place cap.

## Manual steps

These have no API that works without upgrading to Identity Platform:

1. Firebase console, Authentication, Get started, Sign-in method, Google, Enable; pick the support email; Save.
2. After the first deploy (T02), add the Cloud Run or custom domain under Authentication, Settings, Authorized domains, and grant `fyd-web` `roles/run.invoker` on the agent service.

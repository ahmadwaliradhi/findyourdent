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
| Project | `findyourdent` (number 1001413011907) |
| Billing account | `019521-D61E16-A0C8A3` (billed in IDR) |
| Region | `asia-southeast2` (Jakarta) |
| Firestore | `(default)`, Native mode, Jakarta |
| Bucket | `gs://findyourdent-uploads`, uniform access, public access prevented |
| Firebase web app | `1:1001413011907:web:d59beb8fb53f70f21d3576` |
| reCAPTCHA Enterprise site key (App Check) | `6LeFCfMtAAAAACLP7NiG2xaEClvTnRY5qqTPFdxC` (score-based; public by design) |
| Service accounts | `fyd-web@findyourdent.iam.gserviceaccount.com`, `fyd-agent@findyourdent.iam.gserviceaccount.com` |
| Secrets (Secret Manager, Jakarta) | `places-api-key` (API key restricted to Places API (New)), `admin-emails` (comma-separated allowlist), `share-link-secret` (signs shareable Guidance links; the web service reads it as `SHARE_LINK_SECRET`, not created yet) |
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

Gemini has no requests-per-day quota on Vertex AI, so the daily input-token quota is the cap. Output tokens have no daily quota; the agent service must bound them with `max_output_tokens`.

Before building on these caps, the Places adapter (spec 02) must know:

- The 83/day Get Place cap is shared. The console cannot stop the Google block from using all 83, so the adapter has to enforce 50 for the block and 33 for reviews.
- Coordinates lookups (Place Details Essentials) are Get Place calls too, so they eat into the same 83. Run the monthly coordinates refresh in small batches, or raise the cap for that day.

## Platform facts (checked 17 October 2026 via the Cloud Quotas API)

- Places quota IDs are per method: `SearchTextRequestPerDayPerProject`, `GetPlaceRequestPerDayPerProject`, `AutocompletePlacesRequestPerDayPerProject`, and so on. There is no per-SKU quota.
- Gemini's only daily quota is `GlobalGenerateContentInputTokensPerDayPerBaseModel`. The `base_model` dimension values are `gemini-3.8-flash-qcd` and `gemini-3.5-flash-lite-qcd`. Requests are capped only per minute, and raising that cap needs a contact email, so the script leaves it at the default.
- Autocomplete (New) sessions: an IDs-only Place Details call is free but does not end the session for billing, so the Autocomplete requests revert to per-request pricing, the same as making no call ([session pricing](https://developers.google.com/maps/documentation/places/web-service/session-pricing)). Autocomplete Requests get 10,000 free a month, then USD 2.83 per 1,000 ([pricing](https://developers.google.com/maps/billing-and-pricing/pricing)), so the 300-a-day cap stays free.
- The billing account `019521-D61E16-A0C8A3` is billed in IDR, and a budget must use the account's currency.

## Deploy (T02)

Firebase Hosting fronts the web service; both services run in Jakarta (ADR-0008).

```bash
infra/gcp/deploy.sh agent    # first, and whenever the agent changes
infra/gcp/deploy.sh web      # web service, Firebase Hosting, then the smoke test
infra/gcp/monitoring.sh      # once after the first deploy, or to converge drift
infra/gcp/smoke.sh           # on its own at any time
```

`deploy.sh` refuses uncommitted changes, builds the image for `HEAD` with Cloud Build (`cloudbuild.yaml`, upload limited by `.gcloudignore`), pushes it to Artifact Registry and deploys it. The Firebase CLI step uses your gcloud application default credentials, or `firebase login`.

| Thing | Value |
| --- | --- |
| Public URL | https://findyourdent.web.app (Hosting rewrites every path to `fyd-web`) |
| Artifact Registry | `asia-southeast2-docker.pkg.dev/findyourdent/findyourdent/{web,agent}:<commit>` |
| `fyd-web` | public; minimum 0, maximum 4 instances; `AGENT_AUTH=id_token`; secrets `PLACES_API_KEY`, `ADMIN_EMAILS` from Secret Manager |
| `fyd-agent` | `--no-allow-unauthenticated`; `roles/run.invoker` only for `fyd-web` and the Monitoring service agent (uptime check); maximum 4 instances |
| Warm agent instance | service-level minimum 1 from 19 October to 7 November 2026 (Jakarta time), 0 otherwise |
| Uptime checks | `fyd-web health` (through Hosting) and `fyd-agent health` (with an identity token), `/health` every minute from three regions |
| Alert policy | `FindYourDent demo is down`: either uptime check failing, or 5xx responses every minute, for five minutes; email to the `admin-emails` allowlist |

The warm instance is a service-level minimum, which changes without a new revision. Cloud Scheduler jobs `agent-warm-on` (00:00 on 19 October) and `agent-warm-off` (00:00 on 8 November) set it through the Cloud Run Admin API as `fyd-scheduler`, and every agent deploy sets the value for the current date. Cron has no year, so delete both jobs after judging. To flip it by hand: `gcloud run services update fyd-agent --region asia-southeast2 --min=1` (or `--min=0`).

Request bodies never reach Cloud Logging. Cloud Run's request log has only the method, URL, status, latency and sizes. Both services write one JSON line per request with the request id (Cloud Run's trace id, passed to the agent as `X-Request-Id`), path, status and outcome code, and never a body, header or query string.

## Manual steps

These have no API that works without upgrading to Identity Platform:

1. Firebase console, Authentication, Get started, Sign-in method, Google, Enable; pick the support email; Save.
2. Patients reach the app through `findyourdent.web.app`, which is already an authorized domain and in `RECAPTCHA_DOMAINS`. When the custom domain is attached, add it under Authentication, Settings, Authorized domains. Never add the bare `run.app` suffix to `RECAPTCHA_DOMAINS`.

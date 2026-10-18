# Repository audit for the submission

Checked on 18 October 2026 against commit `0066864` (the `main` tip, also the image tag `fyd-web` runs), for issue #23 (T19). The repository is public at https://github.com/ahmadwaliradhi/findyourdent, so everything tracked is readable by anyone. History was not rewritten; this file reports what was found and what needs a human.

## Summary

- No real secret is tracked, and none was ever added in history.
- No PDF, Office document or other source document is tracked or was ever added.
- No Google Places or Google Reviews data is committed. The only review in the repository is an invented sample in a test fake.
- Third-party images are CC0 with a sources file. Three things need a human: the repository has no `LICENSE` file, the Figtree font is committed without its SIL Open Font License text, and the MIT notice for the kecamatan data source is cited but not copied.
- The GitHub repository, both site URLs and every link in `README.md` load without signing in.

## Commands run

```sh
git ls-files | wc -l                                     # 490 tracked files
git grep -nI -E 'AIza[0-9A-Za-z_-]{35}'                   # Google API keys
git grep -nI -E 'BEGIN (RSA |EC |OPENSSH |DSA |)PRIVATE KEY|"private_key"|private_key_id'
git grep -nI -E 'ghp_[0-9A-Za-z]{36}|github_pat_|xox[baprs]-|sk-[A-Za-z0-9]{20,}|ya29\.[0-9A-Za-z_-]+|AKIA[0-9A-Z]{16}'
git grep -nI -iE '(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*"[^" ]{8,}"'
git ls-files | grep -iE '(^|/)\.env|\.pem$|\.p12$|\.key$|credentials|service[-_]?account|secret'
git ls-files | grep -iE '\.pdf$'
git ls-files | grep -iE '\.(png|jpe?g|gif|webp|svg|ico|mp4|mov|mp3|wav|zip|gz|docx?|pptx?|xlsx?|woff2?|ttf)$'
git ls-files -z | xargs -0 du -k | sort -rn | head        # largest tracked files
git grep -nIc -E 'ChIJ[0-9A-Za-z_-]{20,}'                 # Google place ids
git grep -nIl -E 'authorAttribution|googleMapsUri|"rating":\s*[0-9]|userRatingCount'
git log --all --diff-filter=A --name-only --format= | sort -u | grep -iE 'pdf|\.env|key|secret|credential|\.pem|\.p12|serviceaccount'
git rev-list --objects --all | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' | awk '$1=="blob" && $3>500000'
git log --all -p -G 'AIza[0-9A-Za-z_-]{35}|BEGIN [A-Z ]*PRIVATE KEY|"private_key"'
```

## Secrets

| Check | Result |
| --- | --- |
| Google API keys (`AIza...`) in tracked files | None. The Firebase web API key is not in the repository at all: `deploy.sh` looks it up at deploy time and sets it as a plain env var on `fyd-web`. |
| Private keys, service account JSON | None. Both services use their attached service accounts and Application Default Credentials; no key file exists. |
| GitHub, Slack, OpenAI, AWS or Google OAuth tokens | None. |
| `.env` files with values | Only `apps/web/.env.example` is tracked. Its values are local defaults (`AGENT_URL=http://localhost:8000`, `GCLOUD_PROJECT=demo-findyourdent`) and the placeholder debug token `local-app-check-debug-token`, which only the local debug verifier accepts; production ignores `APP_CHECK_DEBUG_TOKEN`. `.gitignore` excludes `.env` and `.env.*` except the example. |
| `.mcp.json` | Starts `chrome-devtools-mcp` with an isolated profile and an empty `env`. No credentials. |
| Real secrets | All five (`places-api-key`, `admin-emails`, `share-link-secret`, `rate-limit-salt`, `app-check-debug-token`) live only in Secret Manager in Jakarta. The repository names them but never holds a value. |
| History | No `.env`, key, credential or PDF file was ever added on any branch, and no commit diff ever contained an `AIza` key or a private key. |

Public by design, and fine to commit:

- The reCAPTCHA Enterprise site key `6LeFCfMtAAAAACLP7NiG2xaEClvTnRY5qqTPFdxC` (in `infra/gcp/README.md` and `apps/web/.env.example`). A site key is sent to every browser that loads the page; the matching secret is Google-side, and App Check only accepts tokens from the domains listed in `RECAPTCHA_DOMAINS`.
- The Firebase web app ID `1:1001413011907:web:d59beb8fb53f70f21d3576`, the project number and the billing account ID. The Firebase web API key is public by design too (Firebase sends it to every browser), but as noted above it is not committed.

## Scraped and third-party content

| Area | Result |
| --- | --- |
| Google Places and Google Reviews data | None committed. No place ids (`ChIJ...`) are tracked. Every hit for `rating`, `reviews` or `authorAttribution` is code that renders live Places responses, a Places pricing note in `docs/research/gcp-cost-2026-10-16.md`, or test fixtures. The one sample review (`SAMPLE_REVIEWS` in `apps/web/server/adapters/fakes.ts`) is invented ("Contoh ulasan", author "Pengulas Contoh"). Places content is fetched at request time and not stored ([ADR-0001](../adr/0001-places-api-at-request-time.md)); stored coordinates are refreshed or deleted within 30 days by the `coordinates-refresh` job. |
| Evaluation cases | The Guidance and Moderation evalsets use patient messages and Testimonies the team wrote; names, phone numbers and clinics are invented (see `services/agent/evals/`). |
| Research notes (`docs/research/`) | Summaries with citations. The longest block quotes, in `indonesia-dental-use-cases-2026-10-17.md`, are the team's own example patient messages, not copied text. `dental-prices-2026-10-17.md` records prices and clinic names from facilities' own pages with links, as facts, not copied pages. The grounding source documents (national guidelines, BPJS rules) are not in the repository; they sit in the `findyourdent-grounding` bucket and Agent Search, listed with their licences in `docs/research/h02-grounding-sources-2026-10-17.md`. |
| Region data | `packages/contracts/data/regions.json` and `districts.json` come from Kepmendagri No. 300.2.2-2138 Tahun 2025 (a government decree, which Indonesian copyright law does not protect), the kecamatan via the MIT-licensed transcription in `cahyadsn/wilayah`, cited with the commit in `retrievedFrom`. |
| Moderation evaluation photos | `services/agent/evals/moderation/photos/`: three CC0 images from Wikimedia Commons with author, link and edits in `SOURCES.md`, plus a receipt drawn for the evaluation with invented data. EXIF stripped. |
| Brand images and icons | `apps/web/public/` and `docs/design/`: the team's own logo, wordmark, icons and Open Graph image. |
| Font | `Figtree-Variable.woff2` is committed three times (`apps/web/public/fonts/`, `docs/design/design-system/fonts/`, `docs/design/mockups/html/assets/`). Figtree is under the SIL Open Font License 1.1. |
| Other folders | `learning/release-risk/` holds a team member's own study notes about release risk. Not product code, nothing sensitive. |

## Source documents and large files

- No PDF is tracked, and `git log --all --diff-filter=A` shows none was ever added.
- No Office documents, archives, audio or video.
- The largest tracked files are `packages/contracts/data/districts.json` (684 KB), `pnpm-lock.yaml` (384 KB) and the Guidance evaluation results JSON (376 KB). The only blobs over 500 KB in all of history are two versions of `districts.json`.

## Needs a human

1. **No `LICENSE` file.** The repository is public but has no licence, so by default nobody may reuse it, and `services/agent/evals/moderation/photos/SOURCES.md` says the receipt is "Same as the repository", which is currently undefined. Pick a licence (or decide deliberately to keep all rights reserved) and add `LICENSE` at the root.
2. **Figtree licence text missing.** The SIL OFL 1.1 lets anyone redistribute the font but requires the copyright notice and licence to go with it. Add `OFL.txt` (from the Figtree release) next to each committed copy, or at least next to `apps/web/public/fonts/Figtree-Variable.woff2`, which Firebase Hosting serves publicly. Low risk, quick fix. This audit did not edit `apps/web/` or `docs/design/`.
3. **MIT notice for `cahyadsn/wilayah`.** `districts.json` names the source as MIT-licensed but does not copy its copyright notice. The data itself is a government decree, so the risk is low; adding the notice to the file's `notes` or a `packages/contracts/data/NOTICE` closes it.
4. **Identifiable person in `face.jpg`.** The Wikimedia Commons image is CC0, which covers copyright but not the subject's personality rights. It is used only as a Moderation test input (the expected answer is to hold it), never shown on the site. Acceptable for an evaluation fixture; replace it with a generated face if anyone objects.
5. **Logged-out browser check.** The checks below use `curl` with no cookies. The issue still asks a human to open the repository and the site in a private window, signed out of Google and GitHub, and confirm nothing asks for sign-in before Guidance and the Shortlist.

## Public access

Checked with `curl -s -L -A "Mozilla/5.0"` (no cookies, redirects followed) on 18 October 2026.

| URL | Status | Notes |
| --- | --- | --- |
| https://github.com/ahmadwaliradhi/findyourdent | 200 | No redirect; public repository |
| https://findyourdent.com | 200 | No redirect |
| https://www.findyourdent.com | 200 | One redirect, to https://findyourdent.com/ |
| https://findyourdent.web.app | 200 | No redirect |
| https://findyourdent.com/health | 200 | Through Firebase Hosting to `fyd-web` |
| https://docs.astral.sh/uv/ | 200 | The only external link in `README.md` besides the site |
| `fyd-agent` `/health` on its `run.app` URL | 403 | Expected: the agent service is private (IAM invoker only for `fyd-web` and the uptime check) |

None of the URLs redirected to a sign-in page. All 45 relative links in `README.md` resolve to existing files in the working tree, and all but one return 200 on `github.com/ahmadwaliradhi/findyourdent/blob/main/<path>`. The exception is this file, which returns 404 until the T19 branch is merged to `main`.

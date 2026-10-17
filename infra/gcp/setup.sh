#!/usr/bin/env bash
# Provision the FindYourDent Google Cloud + Firebase project (ticket H01, spec 00).
#
# Idempotent: every step checks for existing state first, so the script can be
# rerun after a failure or to converge drift. Run it signed in as a project
# owner who can also manage the billing account:
#
#   gcloud auth login
#   infra/gcp/setup.sh
#
# The Google sign-in provider has no API without an Identity Platform upgrade;
# enable it in the Firebase console (see infra/gcp/README.md, Manual steps).
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-findyourdent}"
BILLING_ACCOUNT="${BILLING_ACCOUNT:-019521-D61E16-A0C8A3}"
REGION="${REGION:-asia-southeast2}"
BUCKET="${BUCKET:-${PROJECT_ID}-uploads}"
# The billing account is billed in IDR, so the budget must be in IDR.
# USD 100 at about IDR 16,500 per USD.
BUDGET_AMOUNT="${BUDGET_AMOUNT:-1650000IDR}"
BUDGET_NAME="${BUDGET_NAME:-findyourdent-usd100}"
WEB_APP_NAME="${WEB_APP_NAME:-findyourdent-web}"
# Patients use the Firebase Hosting domain (ADR-0008). Never add the bare run.app
# suffix, which would let any Cloud Run service use the key.
RECAPTCHA_DOMAINS="${RECAPTCHA_DOMAINS:-localhost,${PROJECT_ID}.web.app,${PROJECT_ID}.firebaseapp.com,findyourdent.com}"

APIS=(
  run.googleapis.com
  artifactregistry.googleapis.com
  cloudbuild.googleapis.com
  secretmanager.googleapis.com
  firestore.googleapis.com
  storage.googleapis.com
  cloudscheduler.googleapis.com
  places.googleapis.com
  aiplatform.googleapis.com
  discoveryengine.googleapis.com
  firebase.googleapis.com
  identitytoolkit.googleapis.com
  recaptchaenterprise.googleapis.com
  monitoring.googleapis.com
  # Needed by this script itself or by later tickets.
  apikeys.googleapis.com
  iam.googleapis.com
  cloudresourcemanager.googleapis.com
  billingbudgets.googleapis.com
  cloudquotas.googleapis.com
  firebaseappcheck.googleapis.com
  firebasehosting.googleapis.com
  logging.googleapis.com
  # Deletes the warm-instance schedule after judging (infra/gcp/deploy.sh).
  workflows.googleapis.com
)

log() { printf '\n==> %s\n' "$*"; }
skip() { printf '    (exists) %s\n' "$*"; }

# Authenticated call to a Google REST API, billed to this project. Fails on any
# HTTP error. The token goes in through stdin so it never shows up in `ps`.
gapi() {
  local method="$1" url="$2" body="${3:-}"
  local args=(-sS --fail-with-body -X "$method" "$url" -H @-
    -H "x-goog-user-project: ${PROJECT_ID}"
    -H "Content-Type: application/json")
  [[ -n "$body" ]] && args+=(-d "$body")
  printf 'Authorization: Bearer %s\n' "$(gcloud auth print-access-token)" | curl "${args[@]}"
}

# Start a long-running Firebase operation and wait for it; fails if the
# operation finishes with an error.
run_op() {
  local op result
  op=$(gapi POST "$1" "$2" | jq -r '.name')
  for _ in $(seq 1 30); do
    result=$(gapi GET "${FB}/${op}")
    if [[ "$(jq -r '.done // false' <<<"$result")" == "true" ]]; then
      if jq -e '.error' <<<"$result" >/dev/null; then
        echo "operation ${op} failed: ${result}" >&2
        return 1
      fi
      return 0
    fi
    sleep 4
  done
  echo "timed out waiting for ${op}" >&2
  return 1
}

# Firebase web app ID for WEB_APP_NAME, or empty if there is none.
web_app_id() {
  gapi GET "${FB}/projects/${PROJECT_ID}/webApps" \
    | jq -r --arg n "$WEB_APP_NAME" '[.apps[]? | select(.displayName == $n)][0].appId // empty'
}

# Resource name of the API key with display name $1, or empty.
api_key_name() {
  gcloud services api-keys list --project "$PROJECT_ID" \
    --filter="displayName=$1" --format='value(name)' | head -1
}

# gcloud reports the property change on stderr; errors still stop the script.
gcloud config set project "$PROJECT_ID" >/dev/null 2>&1
# Only client libraries use ADC; a missing ADC login must not block the gcloud steps.
gcloud auth application-default set-quota-project "$PROJECT_ID" >/dev/null 2>&1 || true

# 1. Project and billing --------------------------------------------------------
log "Project ${PROJECT_ID}"
if gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1; then
  skip "project"
else
  gcloud projects create "$PROJECT_ID" --name="$PROJECT_ID"
fi

log "Billing ${BILLING_ACCOUNT}"
if [[ "$(gcloud billing projects describe "$PROJECT_ID" --format='value(billingEnabled)')" == "True" ]]; then
  skip "billing enabled"
else
  gcloud billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT"
fi

# 2. APIs ------------------------------------------------------------------------
log "Enabling APIs"
# The API accepts at most 20 services per call.
gcloud services enable "${APIS[@]:0:20}" --project "$PROJECT_ID"
(( ${#APIS[@]} > 20 )) && gcloud services enable "${APIS[@]:20}" --project "$PROJECT_ID"

# 3. Firestore and Storage in Jakarta -------------------------------------------
log "Firestore (default) in ${REGION}"
if gcloud firestore databases describe --database='(default)' --project "$PROJECT_ID" >/dev/null 2>&1; then
  skip "firestore (default)"
else
  gcloud firestore databases create --database='(default)' --location="$REGION" \
    --type=firestore-native --project "$PROJECT_ID"
fi

log "Bucket gs://${BUCKET} in ${REGION}"
if gcloud storage buckets describe "gs://${BUCKET}" >/dev/null 2>&1; then
  skip "bucket"
else
  gcloud storage buckets create "gs://${BUCKET}" --project "$PROJECT_ID" \
    --location="$REGION" --uniform-bucket-level-access --public-access-prevention
fi
# Price List originals are kept 30 days for disputes, then deleted (spec 05). The rule
# is written whole on every run, so it converges. Lifecycle `age` counts days since the
# object was created, and Cloud Storage acts on it asynchronously, usually within a day
# (cloud.google.com/storage/docs/lifecycle, checked 17 October 2026).
log "Bucket lifecycle (priceLists/ originals, 30 days)"
LIFECYCLE_FILE="$(mktemp)"
trap 'rm -f "$LIFECYCLE_FILE"' EXIT
jq -n '{rule: [{action: {type: "Delete"}, condition: {age: 30, matchesPrefix: ["priceLists/"]}}]}' >"$LIFECYCLE_FILE"
gcloud storage buckets update "gs://${BUCKET}" --project "$PROJECT_ID" --lifecycle-file="$LIFECYCLE_FILE"

# 4. Firebase ------------------------------------------------------------------
FB="https://firebase.googleapis.com/v1beta1"
log "Firebase"
# A project without Firebase answers 403/404 here, which gapi turns into failure.
if gapi GET "${FB}/projects/${PROJECT_ID}" >/dev/null 2>&1; then
  skip "firebase project"
else
  run_op "${FB}/projects/${PROJECT_ID}:addFirebase" '{}'
fi

log "Firebase web app ${WEB_APP_NAME}"
WEB_APP_ID=$(web_app_id)
if [[ -n "$WEB_APP_ID" ]]; then
  skip "web app ${WEB_APP_ID}"
else
  run_op "${FB}/projects/${PROJECT_ID}/webApps" "$(jq -n --arg n "$WEB_APP_NAME" '{displayName: $n}')"
  WEB_APP_ID=$(web_app_id)
fi
echo "    web app id: ${WEB_APP_ID}"

# 5. reCAPTCHA Enterprise key for App Check -------------------------------------
log "reCAPTCHA Enterprise key"
SITE_KEY=$(gcloud recaptcha keys list --project "$PROJECT_ID" \
  --filter="displayName=${WEB_APP_NAME}-appcheck" --format='value(name)' | head -1 | sed 's#.*/##')
if [[ -n "$SITE_KEY" ]]; then
  skip "key ${SITE_KEY}"
  gcloud recaptcha keys update "$SITE_KEY" --project "$PROJECT_ID" --web \
    --domains="$RECAPTCHA_DOMAINS" >/dev/null
else
  SITE_KEY=$(gcloud recaptcha keys create --project "$PROJECT_ID" \
    --display-name="${WEB_APP_NAME}-appcheck" --web --integration-type=score \
    --domains="$RECAPTCHA_DOMAINS" --format='value(name)' | sed 's#.*/##')
fi
echo "    site key: ${SITE_KEY}"

log "Register key with App Check"
gapi PATCH "https://firebaseappcheck.googleapis.com/v1/projects/${PROJECT_ID}/apps/${WEB_APP_ID}/recaptchaEnterpriseConfig?updateMask=siteKey" \
  "$(jq -n --arg k "$SITE_KEY" '{siteKey: $k}')" | jq -r '"    registered " + .siteKey'

# 6. Places API key in Secret Manager -------------------------------------------
log "Places API key"
PLACES_KEY_NAME=$(api_key_name places-server)
if [[ -n "$PLACES_KEY_NAME" ]]; then
  skip "api key places-server"
else
  # Without --async gcloud waits for the create operation to finish.
  gcloud services api-keys create --project "$PROJECT_ID" --display-name=places-server \
    --api-target=service=places.googleapis.com >/dev/null
  PLACES_KEY_NAME=$(api_key_name places-server)
fi
[[ -n "$PLACES_KEY_NAME" ]] || { echo "places-server API key not found" >&2; exit 1; }

log "Secret places-api-key"
if ! gcloud secrets describe places-api-key --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud secrets create places-api-key --project "$PROJECT_ID" \
    --replication-policy=user-managed --locations="$REGION"
fi
# Checked separately so a run that died between create and add still converges.
if [[ -n "$(gcloud secrets versions list places-api-key --project "$PROJECT_ID" \
       --filter='state=ENABLED' --limit=1 --format='value(name)')" ]]; then
  skip "secret places-api-key has a version"
else
  gcloud services api-keys get-key-string "$PLACES_KEY_NAME" --format='value(keyString)' \
    | tr -d '\n' | gcloud secrets versions add places-api-key --project "$PROJECT_ID" --data-file=-
fi

# 7. Service accounts -----------------------------------------------------------
ensure_sa() {
  local id="$1" display="$2"
  if gcloud iam service-accounts describe "${id}@${PROJECT_ID}.iam.gserviceaccount.com" \
       --project "$PROJECT_ID" >/dev/null 2>&1; then
    skip "service account ${id}"
  else
    gcloud iam service-accounts create "$id" --display-name="$display" --project "$PROJECT_ID"
  fi
}

grant() {
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$1" \
    --role="$2" --condition=None --quiet >/dev/null
}

log "Service accounts"
ensure_sa fyd-web "FindYourDent web service"
ensure_sa fyd-agent "FindYourDent agent service"
WEB_SA="fyd-web@${PROJECT_ID}.iam.gserviceaccount.com"
AGENT_SA="fyd-agent@${PROJECT_ID}.iam.gserviceaccount.com"

for role in roles/datastore.user roles/logging.logWriter roles/monitoring.metricWriter; do
  grant "$WEB_SA" "$role"
  grant "$AGENT_SA" "$role"
done
grant "$AGENT_SA" roles/aiplatform.user
grant "$AGENT_SA" roles/discoveryengine.user
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --member="serviceAccount:${WEB_SA}" --role=roles/storage.objectAdmin >/dev/null
gcloud secrets add-iam-policy-binding places-api-key --project "$PROJECT_ID" \
  --member="serviceAccount:${WEB_SA}" --role=roles/secretmanager.secretAccessor >/dev/null
# run.invoker on the agent service is granted by infra/gcp/deploy.sh agent, when
# the service exists, so only the web service can call it.

# 8. Admin allowlist ------------------------------------------------------------
# Held in Secret Manager, not the public repo, because the addresses are
# personal data. Set ADMIN_EMAILS (comma-separated) to create or update it.
log "Secret admin-emails"
if ! gcloud secrets describe admin-emails --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud secrets create admin-emails --project "$PROJECT_ID" \
    --replication-policy=user-managed --locations="$REGION"
fi
if [[ -n "${ADMIN_EMAILS:-}" ]]; then
  # A new secret has no version yet; treat that as "no current value".
  current=$(gcloud secrets versions access latest --secret=admin-emails --project "$PROJECT_ID" 2>/dev/null || true)
  if [[ "$current" == "$ADMIN_EMAILS" ]]; then
    skip "admin-emails unchanged"
  else
    printf '%s' "$ADMIN_EMAILS" | gcloud secrets versions add admin-emails --project "$PROJECT_ID" --data-file=-
  fi
fi
gcloud secrets add-iam-policy-binding admin-emails --project "$PROJECT_ID" \
  --member="serviceAccount:${WEB_SA}" --role=roles/secretmanager.secretAccessor >/dev/null

# 8b. Share-link signing key ------------------------------------------------------
# Signs shareable Guidance links (apps/web/app/server/share.server.ts). Every web
# instance must use the same key, or a link opened on another instance 404s.
# Generated once; rotating it breaks every link already shared.
log "Secret share-link-secret"
if ! gcloud secrets describe share-link-secret --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud secrets create share-link-secret --project "$PROJECT_ID" \
    --replication-policy=user-managed --locations="$REGION"
fi
if [[ -n "$(gcloud secrets versions list share-link-secret --project "$PROJECT_ID" \
       --filter='state=ENABLED' --limit=1 --format='value(name)')" ]]; then
  skip "secret share-link-secret has a version"
else
  openssl rand -base64 32 | tr -d '\n' \
    | gcloud secrets versions add share-link-secret --project "$PROJECT_ID" --data-file=-
fi
gcloud secrets add-iam-policy-binding share-link-secret --project "$PROJECT_ID" \
  --member="serviceAccount:${WEB_SA}" --role=roles/secretmanager.secretAccessor >/dev/null

# Rate-limit salt: the web service hashes IPs, tokens and session ids with it
# before storing counters, so it must be secret and shared by every instance.
log "Secret rate-limit-salt"
if ! gcloud secrets describe rate-limit-salt --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud secrets create rate-limit-salt --project "$PROJECT_ID" \
    --replication-policy=user-managed --locations="$REGION"
fi
if gcloud secrets versions list rate-limit-salt --project "$PROJECT_ID" --filter='state=ENABLED' \
  --limit=1 --format='value(name)' | grep -q .; then
  skip "rate-limit-salt has a version"
else
  openssl rand -hex 32 | tr -d '\n' | gcloud secrets versions add rate-limit-salt --project "$PROJECT_ID" --data-file=-
fi
gcloud secrets add-iam-policy-binding rate-limit-salt --project "$PROJECT_ID" \
  --member="serviceAccount:${WEB_SA}" --role=roles/secretmanager.secretAccessor >/dev/null

# App Check debug token for the post-deploy smoke test (T03): smoke.sh swaps it for
# a real App Check token, so its Guidance round trip passes the App Check gate.
# The token (a UUID4, input-only in the API) lives in Secret Manager.
log "App Check debug token for the smoke test"
if ! gcloud secrets describe app-check-debug-token --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud secrets create app-check-debug-token --project "$PROJECT_ID" \
    --replication-policy=user-managed --locations="$REGION"
fi
if gcloud secrets versions list app-check-debug-token --project "$PROJECT_ID" --filter='state=ENABLED' \
  --limit=1 --format='value(name)' | grep -q .; then
  skip "app-check-debug-token has a version"
else
  uuidgen | tr '[:upper:]' '[:lower:]' | tr -d '\n' \
    | gcloud secrets versions add app-check-debug-token --project "$PROJECT_ID" --data-file=-
fi
DEBUG_TOKENS_URL="https://firebaseappcheck.googleapis.com/v1/projects/${PROJECT_ID}/apps/${WEB_APP_ID}/debugTokens"
if gapi GET "$DEBUG_TOKENS_URL" | jq -e '[.debugTokens[]? | select(.displayName == "smoke-test")] | length > 0' >/dev/null; then
  skip "debug token smoke-test registered"
else
  # The body holds the secret, so it goes through a private temp file, not argv.
  body_file=$(mktemp)
  gcloud secrets versions access latest --secret=app-check-debug-token --project "$PROJECT_ID" \
    | jq -R '{displayName: "smoke-test", token: .}' >"$body_file"
  gapi POST "$DEBUG_TOKENS_URL" "@${body_file}" >/dev/null
  rm -f "$body_file"
fi

# 9. Budget ---------------------------------------------------------------------
log "Budget ${BUDGET_NAME} (${BUDGET_AMOUNT}, 50% and 90%)"
budgets=$(gcloud billing budgets list --billing-account="$BILLING_ACCOUNT" --format='value(displayName)')
if grep -qx "$BUDGET_NAME" <<<"$budgets"; then
  skip "budget"
else
  gcloud billing budgets create --billing-account="$BILLING_ACCOUNT" \
    --display-name="$BUDGET_NAME" --budget-amount="$BUDGET_AMOUNT" \
    --threshold-rule=percent=0.5 --threshold-rule=percent=0.9
fi

# 10. Daily quota caps ------------------------------------------------------------
# Caps from spec 02. Places quotas are per method, not per SKU: the Google block
# (Enterprise, 50/day) and Google Reviews (33/day) are both GetPlace, so the
# console cap is their sum and the web adapter enforces the split. Methods the
# specs never call are capped at 0. Gemini has no requests-per-day quota, so
# each model gets a daily input-token cap instead.
GEMINI_FLASH="${GEMINI_FLASH:-gemini-3.8-flash-qcd}"
GEMINI_FLASH_LITE="${GEMINI_FLASH_LITE:-gemini-3.5-flash-lite-qcd}"

QUOTAS="https://cloudquotas.googleapis.com/v1/projects/${PROJECT_ID}/locations/global/quotaPreferences"

# quota_cap <preference-id> <service> <quotaId> <value> [base-model]
quota_cap() {
  local id="$1" service="$2" quota="$3" value="$4" dims
  dims=$(jq -nc --arg m "${5:-}" 'if $m == "" then {} else {base_model: $m} end')
  local body out
  body=$(jq -n --arg s "$service" --arg q "$quota" --arg v "$value" --argjson d "$dims" \
    '{service: $s, quotaId: $q, dimensions: $d, quotaConfig: {preferredValue: $v},
      justification: "FindYourDent spending guard (spec 00, spec 02)"}')
  if ! out=$(gapi PATCH "${QUOTAS}/${id}?allowMissing=true&ignoreSafetyChecks=QUOTA_DECREASE_PERCENTAGE_TOO_HIGH&ignoreSafetyChecks=QUOTA_DECREASE_BELOW_USAGE" "$body"); then
    echo "    FAILED ${quota}: ${out}" >&2
    return 1
  fi
  printf '    %-55s %s\n' "$quota ${dims}" "$value"
}

log "Places daily caps"
P=places.googleapis.com
quota_cap places-text-search  $P SearchTextRequestPerDayPerProject 160
quota_cap places-get-place    $P GetPlaceRequestPerDayPerProject 83
quota_cap places-autocomplete $P AutocompletePlacesRequestPerDayPerProject 300
quota_cap places-nearby       $P SearchNearbyRequestPerDayPerProject 0
quota_cap places-photo        $P GetPhotoMediaRequestPerDayPerProject 0
quota_cap places-lookup-media $P LookupMediaRequestPerDayPerProject 0
quota_cap places-search-media $P SearchMediaRequestPerDayPerProject 0
quota_cap places-lookup-review-posts $P LookupReviewPostsRequestPerDayPerProject 0
quota_cap places-search-review-posts $P SearchReviewPostsRequestPerDayPerProject 0
quota_cap places-lookup-summary $P LookupUserContentSummaryRequestPerDayPerProject 0

log "Gemini caps (global endpoint)"
A=aiplatform.googleapis.com
quota_cap gemini-flash-tokens-day      $A GlobalGenerateContentInputTokensPerDayPerBaseModel 2000000 "$GEMINI_FLASH"
quota_cap gemini-flash-lite-tokens-day $A GlobalGenerateContentInputTokensPerDayPerBaseModel 1000000 "$GEMINI_FLASH_LITE"

log "Done. Project ${PROJECT_ID}, web app ${WEB_APP_ID}, site key ${SITE_KEY}"

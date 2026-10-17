#!/usr/bin/env bash
# Provision the FindYourDent Google Cloud + Firebase project (ticket H01, spec 00).
#
# Idempotent: every step checks for existing state first, so the script can be
# rerun after a failure or to converge drift. Run it signed in as a project
# owner who can also manage the billing account:
#
#   gcloud auth login && gcloud auth application-default login
#   infra/gcp/setup.sh
#
# Steps that the APIs cannot do (Google sign-in provider, some quota caps) are
# printed at the end as console instructions.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-findmydent}"
BILLING_ACCOUNT="${BILLING_ACCOUNT:-019521-D61E16-A0C8A3}"
REGION="${REGION:-asia-southeast2}"
BUCKET="${BUCKET:-${PROJECT_ID}-uploads}"
# The billing account is billed in IDR, so the budget must be in IDR.
# USD 100 at about IDR 16,500 per USD.
BUDGET_AMOUNT="${BUDGET_AMOUNT:-1650000IDR}"
BUDGET_NAME="${BUDGET_NAME:-findyourdent-usd100}"
WEB_APP_NAME="${WEB_APP_NAME:-findyourdent-web}"
RECAPTCHA_DOMAINS="${RECAPTCHA_DOMAINS:-localhost,${PROJECT_ID}.web.app,${PROJECT_ID}.firebaseapp.com,findyourdent.com,run.app}"

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
)

log() { printf '\n==> %s\n' "$*"; }
skip() { printf '    (exists) %s\n' "$*"; }

token() { gcloud auth print-access-token; }

# Authenticated call to a Google REST API, billed to this project.
gapi() {
  local method="$1" url="$2" body="${3:-}"
  local args=(-sS -X "$method" "$url"
    -H "Authorization: Bearer $(token)"
    -H "x-goog-user-project: ${PROJECT_ID}"
    -H "Content-Type: application/json")
  [[ -n "$body" ]] && args+=(-d "$body")
  curl "${args[@]}"
}

# Poll a long-running operation returned by a Firebase/Google REST API.
wait_op() {
  local base="$1" op="$2" i
  for i in $(seq 1 30); do
    if gapi GET "${base}/${op}" | grep -q '"done": true'; then return 0; fi
    sleep 4
  done
  echo "timed out waiting for ${op}" >&2
  return 1
}

gcloud config set project "$PROJECT_ID" >/dev/null 2>&1
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

# 4. Firebase ------------------------------------------------------------------
FB="https://firebase.googleapis.com/v1beta1"
log "Firebase"
if gapi GET "${FB}/projects/${PROJECT_ID}" | grep -q '"projectId"'; then
  skip "firebase project"
else
  op=$(gapi POST "${FB}/projects/${PROJECT_ID}:addFirebase" '{}' | sed -n 's/.*"name": "\(operations\/[^"]*\)".*/\1/p')
  wait_op "$FB" "$op"
fi

log "Firebase web app ${WEB_APP_NAME}"
WEB_APP_ID=$(gapi GET "${FB}/projects/${PROJECT_ID}/webApps" \
  | tr -d '\n' | grep -o "\"appId\": \"[^\"]*\"[^}]*\"displayName\": \"${WEB_APP_NAME}\"" \
  | sed -n 's/"appId": "\([^"]*\)".*/\1/p' | head -1 || true)
if [[ -n "$WEB_APP_ID" ]]; then
  skip "web app ${WEB_APP_ID}"
else
  op=$(gapi POST "${FB}/projects/${PROJECT_ID}/webApps" "{\"displayName\": \"${WEB_APP_NAME}\"}" \
    | sed -n 's/.*"name": "\(operations\/[^"]*\)".*/\1/p')
  wait_op "$FB" "$op"
  WEB_APP_ID=$(gapi GET "${FB}/projects/${PROJECT_ID}/webApps" \
    | tr -d '\n' | grep -o "\"appId\": \"[^\"]*\"[^}]*\"displayName\": \"${WEB_APP_NAME}\"" \
    | sed -n 's/"appId": "\([^"]*\)".*/\1/p' | head -1)
fi
echo "    web app id: ${WEB_APP_ID}"

# 5. reCAPTCHA Enterprise key for App Check -------------------------------------
log "reCAPTCHA Enterprise key"
SITE_KEY=$(gcloud recaptcha keys list --project "$PROJECT_ID" \
  --filter="displayName=${WEB_APP_NAME}-appcheck" --format='value(name)' | head -1 | sed 's#.*/##')
if [[ -n "$SITE_KEY" ]]; then
  skip "key ${SITE_KEY}"
else
  SITE_KEY=$(gcloud recaptcha keys create --project "$PROJECT_ID" \
    --display-name="${WEB_APP_NAME}-appcheck" --web --integration-type=score \
    --domains="$RECAPTCHA_DOMAINS" --format='value(name)' | sed 's#.*/##')
fi
echo "    site key: ${SITE_KEY}"

log "Register key with App Check"
gapi PATCH "https://firebaseappcheck.googleapis.com/v1/projects/${PROJECT_ID}/apps/${WEB_APP_ID}/recaptchaEnterpriseConfig?updateMask=siteKey" \
  "{\"siteKey\": \"${SITE_KEY}\"}" >/dev/null

# 6. Places API key in Secret Manager -------------------------------------------
log "Places API key"
PLACES_KEY_NAME=$(gcloud services api-keys list --project "$PROJECT_ID" \
  --filter="displayName=places-server" --format='value(name)' | head -1)
if [[ -n "$PLACES_KEY_NAME" ]]; then
  skip "api key places-server"
else
  gcloud services api-keys create --project "$PROJECT_ID" --display-name=places-server \
    --api-target=service=places.googleapis.com >/dev/null 2>&1
  PLACES_KEY_NAME=$(gcloud services api-keys list --project "$PROJECT_ID" \
    --filter="displayName=places-server" --format='value(name)' | head -1)
fi

log "Secret places-api-key"
if gcloud secrets describe places-api-key --project "$PROJECT_ID" >/dev/null 2>&1; then
  skip "secret places-api-key"
else
  gcloud secrets create places-api-key --project "$PROJECT_ID" \
    --replication-policy=user-managed --locations="$REGION"
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
# run.invoker on the agent service is granted at deploy time (T02), when the
# service exists, so only the web service can call it.

# 8. Admin allowlist ------------------------------------------------------------
# Held in Secret Manager, not the public repo, because the addresses are
# personal data. Set ADMIN_EMAILS (comma-separated) to create or update it.
log "Secret admin-emails"
if ! gcloud secrets describe admin-emails --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud secrets create admin-emails --project "$PROJECT_ID" \
    --replication-policy=user-managed --locations="$REGION"
fi
if [[ -n "${ADMIN_EMAILS:-}" ]]; then
  current=$(gcloud secrets versions access latest --secret=admin-emails --project "$PROJECT_ID" 2>/dev/null || true)
  if [[ "$current" == "$ADMIN_EMAILS" ]]; then
    skip "admin-emails unchanged"
  else
    printf '%s' "$ADMIN_EMAILS" | gcloud secrets versions add admin-emails --project "$PROJECT_ID" --data-file=-
  fi
fi
gcloud secrets add-iam-policy-binding admin-emails --project "$PROJECT_ID" \
  --member="serviceAccount:${WEB_SA}" --role=roles/secretmanager.secretAccessor >/dev/null

# 9. Budget ---------------------------------------------------------------------
log "Budget ${BUDGET_NAME} (${BUDGET_AMOUNT}, 50% and 90%)"
if gcloud billing budgets list --billing-account="$BILLING_ACCOUNT" \
     --format='value(displayName)' | grep -qx "$BUDGET_NAME"; then
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

# quota_cap <preference-id> <service> <quotaId> <value> [dimensions-json]
quota_cap() {
  local id="$1" service="$2" quota="$3" value="$4" dims="${5:-}"
  [[ -n "$dims" ]] || dims='{}'
  local body="{\"service\": \"${service}\", \"quotaId\": \"${quota}\", \"dimensions\": ${dims},
    \"quotaConfig\": {\"preferredValue\": \"${value}\"},
    \"justification\": \"FindYourDent spending guard (spec 00, spec 02)\"}"
  local out
  out=$(gapi PATCH "${QUOTAS}/${id}?allowMissing=true&ignoreSafetyChecks=QUOTA_DECREASE_PERCENTAGE_TOO_HIGH&ignoreSafetyChecks=QUOTA_DECREASE_BELOW_USAGE" "$body")
  if grep -q '"error"' <<<"$out"; then
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
quota_cap gemini-flash-tokens-day      $A GlobalGenerateContentInputTokensPerDayPerBaseModel 2000000 "{\"base_model\": \"${GEMINI_FLASH}\"}"
quota_cap gemini-flash-lite-tokens-day $A GlobalGenerateContentInputTokensPerDayPerBaseModel 1000000 "{\"base_model\": \"${GEMINI_FLASH_LITE}\"}"

log "Done. Project ${PROJECT_ID}, web app ${WEB_APP_ID}, site key ${SITE_KEY}"

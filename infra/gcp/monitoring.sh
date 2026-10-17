#!/usr/bin/env bash
# Uptime checks and the "demo is down" alert (spec 00, ticket T02).
#
#   infra/gcp/monitoring.sh
#
# Run after the first deploy of both services (infra/gcp/deploy.sh). Idempotent:
# resources are found by display name, created when missing and updated otherwise.
# Alerts go by email to the admin allowlist in the admin-emails secret.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-findyourdent}"
REGION="${REGION:-asia-southeast2}"
WEB_HOST="${WEB_HOST:-${PROJECT_ID}.web.app}"
MON="https://monitoring.googleapis.com/v3/projects/${PROJECT_ID}"

log() { printf '\n==> %s\n' "$*"; }

# Authenticated call to a Google REST API; fails on any HTTP error. The token goes
# in through stdin so it never shows up in `ps`. Same helper as setup.sh.
gapi() {
  local method="$1" url="$2" body="${3:-}"
  local args=(-sS --fail-with-body -X "$method" "$url" -H @-
    -H "x-goog-user-project: ${PROJECT_ID}"
    -H "Content-Type: application/json")
  [[ -n "$body" ]] && args+=(-d "$body")
  printf 'Authorization: Bearer %s\n' "$(gcloud auth print-access-token)" | curl "${args[@]}"
}

# Resource name of the first item in a list response whose displayName is $3.
find_named() {
  gapi GET "$1" | jq -r --arg key "$2" --arg n "$3" '[.[$key][]? | select(.displayName == $n)][0].name // empty'
}

if ! gcloud run services describe fyd-agent --project "$PROJECT_ID" --region "$REGION" >/dev/null 2>&1; then
  echo "deploy the agent first: infra/gcp/deploy.sh agent" >&2
  exit 1
fi
AGENT_HOST=$(gcloud run services describe fyd-agent --project "$PROJECT_ID" --region "$REGION" \
  --format='value(status.url)' | sed -E 's#^https://##')

# 0. Uptime check identity ----------------------------------------------------------------
# An uptime check with service agent authentication sends an identity token for the
# Monitoring service agent, so that agent must be a Cloud Run invoker of fyd-agent
# (https://docs.cloud.google.com/monitoring/uptime-checks#create). The service agent
# only exists once created, which a new project may not have done yet.
log "Monitoring service agent may call fyd-agent"
gcloud beta services identity create --service=monitoring.googleapis.com --project "$PROJECT_ID" >/dev/null
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
gcloud run services add-iam-policy-binding fyd-agent --project "$PROJECT_ID" --region "$REGION" \
  --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-monitoring-notification.iam.gserviceaccount.com" \
  --role=roles/run.invoker >/dev/null

# 1. Email channels ------------------------------------------------------------------
log "Notification channels (admin-emails)"
CHANNELS=()
IFS=',' read -ra EMAILS <<<"$(gcloud secrets versions access latest --secret=admin-emails --project "$PROJECT_ID")"
for email in "${EMAILS[@]}"; do
  email="${email// /}"
  [[ -n "$email" ]] || continue
  display="FindYourDent alerts ${email%%@*}"
  name=$(find_named "${MON}/notificationChannels" notificationChannels "$display")
  if [[ -z "$name" ]]; then
    name=$(gapi POST "${MON}/notificationChannels" \
      "$(jq -n --arg d "$display" --arg e "$email" '{type: "email", displayName: $d, labels: {email_address: $e}}')" \
      | jq -r .name)
    echo "    created ${display}"
  else
    echo "    (exists) ${display}"
  fi
  CHANNELS+=("$name")
done
((${#CHANNELS[@]} > 0)) || { echo "admin-emails is empty: no one would get the alert" >&2; exit 1; }

# 2. Uptime checks ---------------------------------------------------------------------
# Every minute from three regions, the minimum an uptime check allows
# (https://docs.cloud.google.com/monitoring/uptime-checks). About 260,000 runs a
# month; check the free allowance on https://cloud.google.com/stackdriver/pricing.
# uptime_check <display name> <host> <identity token: true|false>
uptime_check() {
  local display="$1" host="$2" oidc="$3" body name
  body=$(jq -n --arg d "$display" --arg h "$host" --arg p "$PROJECT_ID" --argjson oidc "$oidc" '{
    displayName: $d,
    monitoredResource: {type: "uptime_url", labels: {project_id: $p, host: $h}},
    httpCheck: ({path: "/health", port: 443, useSsl: true, validateSsl: true, requestMethod: "GET"}
      + (if $oidc then {serviceAgentAuthentication: {type: "OIDC_TOKEN"}} else {} end)),
    contentMatchers: [{content: "\"status\":\"ok\"", matcher: "CONTAINS_STRING"}],
    period: "60s",
    timeout: "10s",
    selectedRegions: ["ASIA_PACIFIC", "USA", "EUROPE"]
  }')
  name=$(find_named "${MON}/uptimeCheckConfigs" uptimeCheckConfigs "$display")
  if [[ -z "$name" ]]; then
    name=$(gapi POST "${MON}/uptimeCheckConfigs" "$body" | jq -r .name)
    echo "    created ${display}" >&2
  else
    # Only these fields can be updated; the monitored resource and period stay as
    # created (https://docs.cloud.google.com/monitoring/api/ref_v3/rest/v3/projects.uptimeCheckConfigs/patch).
    gapi PATCH "https://monitoring.googleapis.com/v3/${name}?updateMask=httpCheck,contentMatchers,timeout,selectedRegions" \
      "$body" >/dev/null
    echo "    (exists, updated) ${display}" >&2
  fi
  basename "$name"
}

log "Uptime checks"
# The web check goes through Firebase Hosting, the way judges reach the demo.
WEB_CHECK=$(uptime_check "fyd-web health" "$WEB_HOST" false)
# The agent refuses anonymous calls; the check sends an identity token for the
# monitoring service agent, which deploy.sh made an invoker.
AGENT_CHECK=$(uptime_check "fyd-agent health" "$AGENT_HOST" true)

# 3. Alert policy ------------------------------------------------------------------------
log "Alert policy: five minutes of errors"
DISPLAY="FindYourDent demo is down"
POLICY=$(jq -n --arg d "$DISPLAY" --arg web "$WEB_CHECK" --arg agent "$AGENT_CHECK" \
  --argjson channels "$(printf '%s\n' "${CHANNELS[@]}" | jq -R . | jq -s .)" '
  def uptime($id; $label): {
    displayName: ("Uptime check failing: " + $label),
    conditionThreshold: {
      filter: ("metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\" AND metric.label.check_id=\"" + $id + "\""),
      aggregations: [{alignmentPeriod: "60s", perSeriesAligner: "ALIGN_NEXT_OLDER",
        crossSeriesReducer: "REDUCE_COUNT_FALSE", groupByFields: ["resource.label.host"]}],
      comparison: "COMPARISON_GT", thresholdValue: 1, duration: "300s",
      trigger: {count: 1}
    }
  };
  {
    displayName: $d,
    documentation: {mimeType: "text/markdown",
      content: "A FindYourDent service has failed for five minutes. Check Cloud Run logs for fyd-web and fyd-agent (asia-southeast2), then redeploy with infra/gcp/deploy.sh."},
    combiner: "OR",
    conditions: [
      uptime($web; "fyd-web"),
      uptime($agent; "fyd-agent"),
      {
        displayName: "5xx responses every minute for five minutes",
        conditionThreshold: {
          filter: "metric.type=\"run.googleapis.com/request_count\" AND resource.type=\"cloud_run_revision\" AND metric.label.response_code_class=\"5xx\" AND resource.label.service_name=one_of(\"fyd-web\",\"fyd-agent\")",
          aggregations: [{alignmentPeriod: "60s", perSeriesAligner: "ALIGN_DELTA",
            crossSeriesReducer: "REDUCE_SUM", groupByFields: ["resource.label.service_name"]}],
          comparison: "COMPARISON_GT", thresholdValue: 0, duration: "300s",
          trigger: {count: 1}
        }
      }
    ],
    alertStrategy: {autoClose: "1800s"},
    notificationChannels: $channels,
    enabled: true
  }')
name=$(find_named "${MON}/alertPolicies" alertPolicies "$DISPLAY")
if [[ -z "$name" ]]; then
  gapi POST "${MON}/alertPolicies" "$POLICY" >/dev/null
  echo "    created ${DISPLAY}"
else
  gapi PATCH "https://monitoring.googleapis.com/v3/${name}" "$POLICY" >/dev/null
  echo "    (exists, updated) ${DISPLAY}"
fi

log "Done. Uptime checks ${WEB_CHECK}, ${AGENT_CHECK}"

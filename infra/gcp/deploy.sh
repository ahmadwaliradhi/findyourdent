#!/usr/bin/env bash
# Build and deploy one FindYourDent service to Cloud Run in Jakarta (ticket T02, spec 00).
#
#   infra/gcp/deploy.sh agent   # agent service, private (fyd-web and uptime checks only)
#   infra/gcp/deploy.sh web     # web service, Firebase Hosting in front, then the smoke test
#
# Deploy the agent first: the web service reads its URL. The image is built by Cloud
# Build from the committed tree (uncommitted changes are refused) and pushed to
# Artifact Registry in asia-southeast2. Idempotent; rerun to redeploy.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-findyourdent}"
REGION="${REGION:-asia-southeast2}"
REPOSITORY="${REPOSITORY:-findyourdent}"
WEB_SERVICE=fyd-web
AGENT_SERVICE=fyd-agent
WEB_SA="fyd-web@${PROJECT_ID}.iam.gserviceaccount.com"
AGENT_SA="fyd-agent@${PROJECT_ID}.iam.gserviceaccount.com"
SCHEDULER_SA_ID=fyd-scheduler
SCHEDULER_SA="${SCHEDULER_SA_ID}@${PROJECT_ID}.iam.gserviceaccount.com"
# Judging window (spec 00): one warm agent instance from 19 October to 7 November
# 2026 inclusive, Jakarta time; zero otherwise.
WARM_FROM="2026-10-19"
WARM_UNTIL="2026-11-08"

SERVICE="${1:-}"
case "$SERVICE" in
  web | agent) ;;
  *) echo "usage: $0 web|agent" >&2; exit 2 ;;
esac

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
if [[ -n "$(git status --porcelain)" ]]; then
  echo "uncommitted changes: commit or stash first, so the image matches a commit" >&2
  exit 1
fi
TAG="$(git rev-parse --short=12 HEAD)"
REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}"

log() { printf '\n==> %s\n' "$*"; }
skip() { printf '    (exists) %s\n' "$*"; }

# URL of a Cloud Run service, or empty when it is not deployed yet.
service_url() {
  if gcloud run services describe "$1" --project "$PROJECT_ID" --region "$REGION" >/dev/null 2>&1; then
    gcloud run services describe "$1" --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)'
  fi
}

grant_invoker() {
  gcloud run services add-iam-policy-binding "$1" --project "$PROJECT_ID" --region "$REGION" \
    --member="$2" --role=roles/run.invoker >/dev/null
}

# 1. Artifact Registry ------------------------------------------------------------
log "Artifact Registry ${REGISTRY}"
if gcloud artifacts repositories describe "$REPOSITORY" --project "$PROJECT_ID" \
     --location "$REGION" >/dev/null 2>&1; then
  skip "repository ${REPOSITORY}"
else
  gcloud artifacts repositories create "$REPOSITORY" --project "$PROJECT_ID" \
    --location "$REGION" --repository-format=docker \
    --description="FindYourDent service images"
fi

# 2. Image --------------------------------------------------------------------------
if [[ "$SERVICE" == web ]]; then
  DOCKERFILE=apps/web/Dockerfile
  IMAGE="${REGISTRY}/web:${TAG}"
else
  DOCKERFILE=services/agent/Dockerfile
  IMAGE="${REGISTRY}/agent:${TAG}"
fi

log "Image ${IMAGE}"
if gcloud artifacts docker images describe "$IMAGE" --project "$PROJECT_ID" >/dev/null 2>&1; then
  skip "image for ${TAG}"
else
  # .gcloudignore keeps the upload to what the Dockerfiles copy.
  gcloud builds submit "$ROOT" --project "$PROJECT_ID" --region "$REGION" \
    --config infra/gcp/cloudbuild.yaml \
    --substitutions="_DOCKERFILE=${DOCKERFILE},_IMAGE=${IMAGE}"
fi

# 3. Service --------------------------------------------------------------------------
# Request bodies never reach Cloud Logging: Cloud Run's request log is an HttpRequest
# entry (method, URL, status, latency, sizes, user agent, remote IP; see
# https://docs.cloud.google.com/run/docs/logging#request-logs), and both services log
# request ids and outcome codes only (spec 00).
if [[ "$SERVICE" == agent ]]; then
  log "Cloud Run ${AGENT_SERVICE}"
  gcloud run deploy "$AGENT_SERVICE" --project "$PROJECT_ID" --region "$REGION" \
    --image "$IMAGE" --service-account "$AGENT_SA" \
    --no-allow-unauthenticated --ingress=all \
    --cpu=1 --memory=1Gi --concurrency=40 --timeout=120 --max-instances=4 \
    --set-env-vars="GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GOOGLE_CLOUD_LOCATION=global" \
    --quiet

  # monitoring.sh adds the uptime check's service agent as the only other invoker.
  log "Only fyd-web may call ${AGENT_SERVICE}"
  grant_invoker "$AGENT_SERVICE" "serviceAccount:${WEB_SA}"

  # Warm instance: a service-level minimum takes effect without a new revision.
  # Cloud Scheduler flips it at the window edges; this sets the value for today
  # so a deploy never undoes the schedule.
  log "Warm instance schedule"
  if gcloud iam service-accounts describe "$SCHEDULER_SA" --project "$PROJECT_ID" >/dev/null 2>&1; then
    skip "service account ${SCHEDULER_SA_ID}"
  else
    gcloud iam service-accounts create "$SCHEDULER_SA_ID" --project "$PROJECT_ID" \
      --display-name="FindYourDent warm-instance schedule"
  fi
  gcloud run services add-iam-policy-binding "$AGENT_SERVICE" --project "$PROJECT_ID" \
    --region "$REGION" --member="serviceAccount:${SCHEDULER_SA}" --role=roles/run.developer >/dev/null
  # Updating a service checks actAs on the service account it runs as.
  gcloud iam service-accounts add-iam-policy-binding "$AGENT_SA" --project "$PROJECT_ID" \
    --member="serviceAccount:${SCHEDULER_SA}" --role=roles/iam.serviceAccountUser >/dev/null

  # Cloud Scheduler cannot send PATCH; Google APIs accept POST with this override
  # (checked against run.googleapis.com on 17 October 2026).
  SERVICE_API="https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}/services/${AGENT_SERVICE}?updateMask=scaling.minInstanceCount"
  # warm_job <name> <cron in Asia/Jakarta> <min instances>
  warm_job() {
    local verb=create headers=--headers
    if gcloud scheduler jobs describe "$1" --project "$PROJECT_ID" --location "$REGION" >/dev/null 2>&1; then
      verb=update headers=--update-headers
    fi
    gcloud scheduler jobs "$verb" http "$1" --project "$PROJECT_ID" --location "$REGION" \
      --schedule="$2" --time-zone=Asia/Jakarta --http-method=POST --uri="$SERVICE_API" \
      "${headers}=Content-Type=application/json,X-HTTP-Method-Override=PATCH" \
      --message-body="$(jq -nc --argjson n "$3" '{scaling: {minInstanceCount: $n}}')" \
      --oauth-service-account-email="$SCHEDULER_SA" \
      --oauth-token-scope=https://www.googleapis.com/auth/cloud-platform >/dev/null
    printf '    %s: %s -> min %s\n' "$1" "$2" "$3"
  }
  warm_job agent-warm-on "0 0 19 10 *" 1
  warm_job agent-warm-off "0 0 8 11 *" 0

  # Cron has no year, so both jobs would fire again every October. At 02:00 on
  # 8 November, after agent-warm-off, agent-warm-cleanup runs the
  # scheduler-cleanup workflow once; it deletes both jobs and agent-warm-cleanup
  # itself. The services are untouched and keep running at minimum 0.
  log "Warm schedule cleanup after judging"
  gcloud services enable workflows.googleapis.com --project "$PROJECT_ID"
  for role in roles/cloudscheduler.admin roles/workflows.invoker; do
    gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${SCHEDULER_SA}" \
      --role="$role" --condition=None --quiet >/dev/null
  done
  gcloud workflows deploy scheduler-cleanup --project "$PROJECT_ID" --location "$REGION" \
    --source infra/gcp/scheduler-cleanup.workflow.yaml --service-account "$SCHEDULER_SA" --quiet >/dev/null
  jobs_base="projects/${PROJECT_ID}/locations/${REGION}/jobs"
  cleanup_arg=$(jq -nc --arg b "$jobs_base" \
    '{jobs: [$b + "/agent-warm-on", $b + "/agent-warm-off", $b + "/agent-warm-cleanup"]}')
  verb=create headers=--headers
  if gcloud scheduler jobs describe agent-warm-cleanup --project "$PROJECT_ID" --location "$REGION" >/dev/null 2>&1; then
    verb=update headers=--update-headers
  fi
  gcloud scheduler jobs "$verb" http agent-warm-cleanup --project "$PROJECT_ID" --location "$REGION" \
    --schedule="0 2 8 11 *" --time-zone=Asia/Jakarta --http-method=POST \
    --uri="https://workflowexecutions.googleapis.com/v1/projects/${PROJECT_ID}/locations/${REGION}/workflows/scheduler-cleanup/executions" \
    "${headers}=Content-Type=application/json" \
    --message-body="$(jq -nc --arg a "$cleanup_arg" '{argument: $a}')" \
    --oauth-service-account-email="$SCHEDULER_SA" \
    --oauth-token-scope=https://www.googleapis.com/auth/cloud-platform >/dev/null
  echo "    agent-warm-cleanup: 0 2 8 11 * -> delete the warm jobs and itself"

  today=$(TZ=Asia/Jakarta date +%F)
  if [[ ! "$today" < "$WARM_FROM" && "$today" < "$WARM_UNTIL" ]]; then min=1; else min=0; fi
  gcloud run services update "$AGENT_SERVICE" --project "$PROJECT_ID" --region "$REGION" \
    --min="$min" --quiet >/dev/null
  echo "    ${today}: service minimum instances ${min}"

  log "Done. ${AGENT_SERVICE}: $(service_url "$AGENT_SERVICE")"
  exit 0
fi

AGENT_URL=$(service_url "$AGENT_SERVICE")
[[ -n "$AGENT_URL" ]] || { echo "deploy the agent first: infra/gcp/deploy.sh agent" >&2; exit 1; }

log "Cloud Run ${WEB_SERVICE}"
gcloud run deploy "$WEB_SERVICE" --project "$PROJECT_ID" --region "$REGION" \
  --image "$IMAGE" --service-account "$WEB_SA" \
  --allow-unauthenticated --ingress=all \
  --cpu=1 --memory=512Mi --concurrency=80 --timeout=60 --min-instances=0 --max-instances=4 \
  --set-env-vars="AGENT_URL=${AGENT_URL},AGENT_AUTH=id_token,FIREBASE_ENABLED=true,GCLOUD_PROJECT=${PROJECT_ID}" \
  --set-secrets="PLACES_API_KEY=places-api-key:latest,ADMIN_EMAILS=admin-emails:latest" \
  --quiet

# Firebase Hosting forwards every path to fyd-web (firebase.json, ADR-0008).
log "Firebase Hosting"
pnpm --dir apps/web exec firebase deploy --only hosting --project "$PROJECT_ID" \
  --config "${ROOT}/firebase.json" --non-interactive

log "Smoke test"
infra/gcp/smoke.sh

log "Done. https://${PROJECT_ID}.web.app (Cloud Run: $(service_url "$WEB_SERVICE"))"

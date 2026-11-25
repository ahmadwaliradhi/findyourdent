#!/usr/bin/env bash
# One-time setup for deploying from GitHub Actions (ADR-0012).
#
# Creates a Workload Identity pool and provider that trust only this repository's
# `main` branch, and the `fyd-deployer` service account the workflow acts as, with
# just the roles `PROVISION=0 infra/gcp/deploy.sh` needs. No service account keys.
#
# Idempotent. Run it signed in as a project owner, once after infra/gcp/setup.sh and
# a first manual deploy (the services, the Artifact Registry repository and the
# Cloud Build bucket must exist):
#
#   gcloud auth login
#   infra/gcp/setup-cicd.sh
#
# It prints the two GitHub repository variables to set. Service accounts, IAM
# bindings and Cloud Scheduler jobs stay with `infra/gcp/deploy.sh` run by hand.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-findyourdent}"
REGION="${REGION:-asia-southeast2}"
REPOSITORY="${REPOSITORY:-findyourdent}"
GITHUB_REPO="${GITHUB_REPO:-ahmadwaliradhi/findyourdent}"
POOL_ID="${POOL_ID:-github}"
PROVIDER_ID="${PROVIDER_ID:-github-actions}"
DEPLOYER_ID=fyd-deployer
DEPLOYER_SA="${DEPLOYER_ID}@${PROJECT_ID}.iam.gserviceaccount.com"

log() { printf '\n==> %s\n' "$*"; }
skip() { printf '    (exists) %s\n' "$*"; }

gcloud config set project "$PROJECT_ID" >/dev/null 2>&1
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')

log "APIs"
gcloud services enable iamcredentials.googleapis.com sts.googleapis.com \
  --project "$PROJECT_ID"

# 1. Deploy service account ------------------------------------------------------
log "Service account ${DEPLOYER_ID}"
if gcloud iam service-accounts describe "$DEPLOYER_SA" --project "$PROJECT_ID" >/dev/null 2>&1; then
  skip "service account ${DEPLOYER_ID}"
else
  gcloud iam service-accounts create "$DEPLOYER_ID" --project "$PROJECT_ID" \
    --display-name="GitHub Actions deploys"
fi

# 2. Roles ------------------------------------------------------------------------
# Project level. Nothing here reads Firestore data or Storage objects, changes IAM,
# or touches Cloud Scheduler, Workflows or the project's other service accounts.
log "Project roles for ${DEPLOYER_ID}"
for role in \
  roles/run.admin \
  roles/cloudbuild.builds.editor \
  roles/logging.viewer \
  roles/serviceusage.serviceUsageConsumer \
  roles/secretmanager.viewer \
  roles/firebase.viewer \
  roles/firebasehosting.admin \
  roles/firebaserules.admin \
  roles/datastore.indexAdmin \
  roles/recaptchaenterprise.viewer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${DEPLOYER_SA}" --role="$role" --condition=None --quiet >/dev/null
  printf '    %s\n' "$role"
done

log "Resource-level grants"
# Push images to the one repository.
gcloud artifacts repositories add-iam-policy-binding "$REPOSITORY" --project "$PROJECT_ID" \
  --location "$REGION" --member="serviceAccount:${DEPLOYER_SA}" \
  --role=roles/artifactregistry.writer --quiet >/dev/null
# Cloud Build reads the uploaded source from this bucket (created by the first build).
if gcloud storage buckets describe "gs://${PROJECT_ID}_cloudbuild" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud storage buckets add-iam-policy-binding "gs://${PROJECT_ID}_cloudbuild" \
    --member="serviceAccount:${DEPLOYER_SA}" --role=roles/storage.objectAdmin >/dev/null
else
  echo "    no gs://${PROJECT_ID}_cloudbuild yet: run infra/gcp/deploy.sh once by hand, then rerun this" >&2
fi
# smoke.sh exchanges the registered App Check debug token.
gcloud secrets add-iam-policy-binding app-check-debug-token --project "$PROJECT_ID" \
  --member="serviceAccount:${DEPLOYER_SA}" --role=roles/secretmanager.secretAccessor >/dev/null
# `gcloud run deploy --service-account` and `gcloud builds submit` act as these.
for sa in "fyd-web@${PROJECT_ID}.iam.gserviceaccount.com" \
          "fyd-agent@${PROJECT_ID}.iam.gserviceaccount.com" \
          "${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
          "${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"; do
  if gcloud iam service-accounts describe "$sa" --project "$PROJECT_ID" >/dev/null 2>&1; then
    gcloud iam service-accounts add-iam-policy-binding "$sa" --project "$PROJECT_ID" \
      --member="serviceAccount:${DEPLOYER_SA}" --role=roles/iam.serviceAccountUser --quiet >/dev/null
    printf '    actAs %s\n' "$sa"
  fi
done
# smoke.sh calls the private agent; it mints an identity token as the deployer itself,
# which needs token creator on itself.
gcloud iam service-accounts add-iam-policy-binding "$DEPLOYER_SA" --project "$PROJECT_ID" \
  --member="serviceAccount:${DEPLOYER_SA}" --role=roles/iam.serviceAccountTokenCreator --quiet >/dev/null
if gcloud run services describe fyd-agent --project "$PROJECT_ID" --region "$REGION" >/dev/null 2>&1; then
  gcloud run services add-iam-policy-binding fyd-agent --project "$PROJECT_ID" --region "$REGION" \
    --member="serviceAccount:${DEPLOYER_SA}" --role=roles/run.invoker --quiet >/dev/null
fi

# 3. Workload Identity Federation ----------------------------------------------------
log "Workload Identity pool ${POOL_ID}"
if gcloud iam workload-identity-pools describe "$POOL_ID" --project "$PROJECT_ID" \
     --location=global >/dev/null 2>&1; then
  skip "pool ${POOL_ID}"
else
  gcloud iam workload-identity-pools create "$POOL_ID" --project "$PROJECT_ID" \
    --location=global --display-name="GitHub Actions"
fi

# Only workflow runs on main of this repository get a token. The condition is on the
# provider, so a fork, another repository or a pull request branch is refused before
# any service account binding is checked.
log "Provider ${PROVIDER_ID} (${GITHUB_REPO}, refs/heads/main)"
provider_args=(
  --project "$PROJECT_ID" --location=global --workload-identity-pool="$POOL_ID"
  --issuer-uri=https://token.actions.githubusercontent.com
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref"
  --attribute-condition="assertion.repository == '${GITHUB_REPO}' && assertion.ref == 'refs/heads/main'"
)
if gcloud iam workload-identity-pools providers describe "$PROVIDER_ID" --project "$PROJECT_ID" \
     --location=global --workload-identity-pool="$POOL_ID" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers update-oidc "$PROVIDER_ID" "${provider_args[@]}"
else
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_ID" "${provider_args[@]}" \
    --display-name="GitHub Actions OIDC"
fi

log "Let the repository act as ${DEPLOYER_ID}"
gcloud iam service-accounts add-iam-policy-binding "$DEPLOYER_SA" --project "$PROJECT_ID" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/attribute.repository/${GITHUB_REPO}" \
  --quiet >/dev/null

PROVIDER_NAME=$(gcloud iam workload-identity-pools providers describe "$PROVIDER_ID" \
  --project "$PROJECT_ID" --location=global --workload-identity-pool="$POOL_ID" --format='value(name)')

cat <<EOF

==> Done. Finish in GitHub (https://github.com/${GITHUB_REPO}/settings):

  gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER --repo ${GITHUB_REPO} --body '${PROVIDER_NAME}'
  gh variable set GCP_DEPLOY_SERVICE_ACCOUNT --repo ${GITHUB_REPO} --body '${DEPLOYER_SA}'

Then Settings, Environments, New environment "production", Required reviewers: add
yourself. The deploy job waits there for your approval before it touches Google Cloud.
EOF

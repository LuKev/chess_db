#!/usr/bin/env bash
set -euo pipefail

if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud CLI is required. Install with: brew install --cask google-cloud-sdk"
  exit 1
fi

if ! command -v railway >/dev/null 2>&1; then
  echo "railway CLI is required. Install with: npm i -g @railway/cli"
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required. Install with: brew install jq"
  exit 1
fi

PROJECT_ID="${GCP_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
if [[ -z "${PROJECT_ID}" || "${PROJECT_ID}" == "(unset)" ]]; then
  echo "Set GCP_PROJECT_ID or run: gcloud config set project <PROJECT_ID>"
  exit 1
fi

LOCATION="${GCS_LOCATION:-US}"
BUCKET="${GCS_BUCKET_NAME:-chess-db-${PROJECT_ID}}"
SA_NAME="${GCS_S3_SA_NAME:-chess-db-s3}"
RAILWAY_ENV="${RAILWAY_ENVIRONMENT:-production}"
RAILWAY_SERVICES=(api worker)

if [[ -n "${RAILWAY_SERVICES_CSV:-}" ]]; then
  IFS=',' read -r -a RAILWAY_SERVICES <<<"${RAILWAY_SERVICES_CSV}"
fi

echo "Using project: ${PROJECT_ID}"

gcloud config set project "${PROJECT_ID}" >/dev/null

BILLING_ENABLED="$(gcloud beta billing projects describe "${PROJECT_ID}" --format='value(billingEnabled)' 2>/dev/null || true)"
if [[ "${BILLING_ENABLED}" != "True" && "${BILLING_ENABLED}" != "true" ]]; then
  echo "Billing is disabled for ${PROJECT_ID}."
  echo "Enable billing first, then re-run this script."
  echo "Console link: https://console.cloud.google.com/billing/linkedaccount?project=${PROJECT_ID}"
  exit 2
fi

echo "Ensuring bucket gs://${BUCKET} exists..."
if ! gcloud storage buckets describe "gs://${BUCKET}" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://${BUCKET}" --location="${LOCATION}" --uniform-bucket-level-access >/dev/null
fi

SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
if ! gcloud iam service-accounts describe "${SA_EMAIL}" >/dev/null 2>&1; then
  gcloud iam service-accounts create "${SA_NAME}" --display-name="Chess DB S3 Access" >/dev/null
fi

echo "Granting bucket-level IAM to ${SA_EMAIL}..."
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/storage.objectAdmin" >/dev/null

gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/storage.legacyBucketReader" >/dev/null

TMP_HMAC_JSON="$(mktemp)"
trap 'rm -f "${TMP_HMAC_JSON}"' EXIT

echo "Creating a new HMAC key for ${SA_EMAIL}..."
gcloud storage hmac create "${SA_EMAIL}" --project="${PROJECT_ID}" --format=json > "${TMP_HMAC_JSON}"

S3_ACCESS_KEY="$(jq -r '.metadata.accessId // empty' "${TMP_HMAC_JSON}")"
S3_SECRET_KEY="$(jq -r '.secret // empty' "${TMP_HMAC_JSON}")"

if [[ -z "${S3_ACCESS_KEY}" || -z "${S3_SECRET_KEY}" ]]; then
  echo "Failed to create HMAC credentials."
  exit 1
fi

for svc in "${RAILWAY_SERVICES[@]}"; do
  echo "Setting Railway vars on service: ${svc}"
  railway variables -e "${RAILWAY_ENV}" -s "${svc}" \
    --set "S3_ENDPOINT=https://storage.googleapis.com" \
    --set "S3_REGION=auto" \
    --set "S3_BUCKET=${BUCKET}" \
    --set "S3_ACCESS_KEY=${S3_ACCESS_KEY}" \
    --set "S3_FORCE_PATH_STYLE=true" \
    --set "S3_STARTUP_CHECK_STRICT=true" >/dev/null

  printf '%s' "${S3_SECRET_KEY}" | railway variables -e "${RAILWAY_ENV}" -s "${svc}" --set-from-stdin S3_SECRET_KEY >/dev/null

done

echo "Triggering Railway redeploys..."
railway redeploy -s api -y >/dev/null
railway redeploy -s worker -y >/dev/null

echo "Done."
echo "Bucket: gs://${BUCKET}"
echo "Services updated: ${RAILWAY_SERVICES[*]}"
echo "Next: run smoke check after deploy is healthy:"
echo "  SMOKE_API_BASE_URL=https://api.kezilu.com node scripts/smoke_post_deploy.mjs"

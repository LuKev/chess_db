# GCS S3-Compatible Setup for Railway

This project expects S3-compatible object storage variables on `api` and `worker`:

- `S3_ENDPOINT`
- `S3_REGION`
- `S3_ACCESS_KEY`
- `S3_SECRET_KEY`
- `S3_BUCKET`
- `S3_FORCE_PATH_STYLE`

Google Cloud Storage works for this by using HMAC interoperability keys.

## What "S3" means here

S3 is the object-storage API shape (bucket + object keys + `PUT/GET/LIST`) the app uses.
It does **not** need to be AWS specifically. Any provider with S3-compatible endpoints can work.

## Prerequisites

1. `gcloud` CLI installed and authenticated.
2. `railway` CLI installed and linked to this project.
3. Billing enabled on the GCP project (required to create a Cloud Storage bucket).

## One-command setup

From repo root:

```bash
./scripts/setup_gcs_s3_railway.sh
```

What it does:

1. Validates project and billing.
2. Creates bucket (`gs://chess-db-<project-id>` unless `GCS_BUCKET_NAME` is set).
3. Creates service account `chess-db-s3@<project-id>.iam.gserviceaccount.com` if missing.
4. Grants bucket IAM roles (`storage.objectAdmin`, `storage.legacyBucketReader`).
5. Creates HMAC access key/secret.
6. Sets Railway vars for `api` and `worker`.
7. Redeploys `api` and `worker`.

## Optional overrides

```bash
GCP_PROJECT_ID=my-project-id \
GCS_BUCKET_NAME=my-chessdb-bucket \
GCS_LOCATION=US \
RAILWAY_ENVIRONMENT=production \
RAILWAY_SERVICES_CSV=api,worker \
./scripts/setup_gcs_s3_railway.sh
```

## Verify after deploy

```bash
SMOKE_API_BASE_URL=https://api.kezilu.com node scripts/smoke_post_deploy.mjs
```

## If billing is disabled

If setup exits with "Billing is disabled", link billing first:

1. Open [GCP Billing Link Page](https://console.cloud.google.com/billing/linkedaccount)
2. Select your project.
3. Link an active billing account.

Then re-run:

```bash
./scripts/setup_gcs_s3_railway.sh
```

## Security notes

1. HMAC `secret` is returned only once at creation.
2. Rotate old HMAC keys when no longer needed.
3. Do not commit key values to git.

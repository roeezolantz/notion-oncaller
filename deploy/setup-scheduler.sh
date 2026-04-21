#!/usr/bin/env bash
set -euo pipefail

# Create Cloud Scheduler job for daily cron (with OIDC auth)
# Usage: ./deploy/setup-scheduler.sh <function-url>

FUNCTION_URL="${1:?Usage: setup-scheduler.sh <function-url>}"
PROJECT_ID="${2:-$(gcloud config get-value project)}"
REGION="${3:-me-west1}"
SERVICE_ACCOUNT="${4:-fhenix-monitoring@appspot.gserviceaccount.com}"
CRON_SECRET="${CRON_SECRET:-notion-oncaller-cron-2026}"

JOB_NAME="notion-oncaller-daily"

# Delete existing job if it exists
gcloud scheduler jobs delete "$JOB_NAME" \
  --project="$PROJECT_ID" \
  --location="$REGION" \
  --quiet 2>/dev/null || true

# Create new job with OIDC authentication
gcloud scheduler jobs create http "$JOB_NAME" \
  --project="$PROJECT_ID" \
  --location="$REGION" \
  --schedule="30 9 * * *" \
  --time-zone="Asia/Jerusalem" \
  --uri="${FUNCTION_URL}/cron/daily" \
  --http-method=POST \
  --headers="Content-Type=application/json,x-cron-secret=${CRON_SECRET}" \
  --message-body='{"trigger":"scheduled"}' \
  --attempt-deadline=60s \
  --oidc-service-account-email="$SERVICE_ACCOUNT" \
  --oidc-token-audience="$FUNCTION_URL"

echo "Scheduler job created: $JOB_NAME"
echo "Schedule: 09:30 daily (Asia/Jerusalem)"
echo "Target: ${FUNCTION_URL}/cron/daily"
echo "Auth: OIDC via $SERVICE_ACCOUNT"

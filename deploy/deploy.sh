#!/usr/bin/env bash
set -euo pipefail

# Deploy the Cloud Function
# Usage: ./deploy/deploy.sh [project-id] [region]

PROJECT_ID="${1:-$(gcloud config get-value project)}"
REGION="${2:-me-west1}"
FUNCTION_NAME="notion-oncaller"

echo "Building..."
npm run build

echo "Deploying to $PROJECT_ID ($REGION)..."
gcloud functions deploy "$FUNCTION_NAME" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --runtime=nodejs20 \
  --trigger-http \
  --allow-unauthenticated \
  --entry-point=app \
  --source=. \
  --set-env-vars="$(grep -v '^#' .env | grep -v '^$' | tr '\n' ',')" \
  --memory=256MB \
  --timeout=60s \
  --gen2

FUNCTION_URL=$(gcloud functions describe "$FUNCTION_NAME" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --format='value(serviceConfig.uri)')

echo ""
echo "Deployed! Function URL: $FUNCTION_URL"
echo ""
echo "Configure in Slack app:"
echo "  Slash Command URL:  ${FUNCTION_URL}/slack/commands"
echo "  Interactivity URL:  ${FUNCTION_URL}/slack/interactions"
echo ""
echo "Next: run deploy/setup-scheduler.sh $FUNCTION_URL"

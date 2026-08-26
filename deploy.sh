#!/bin/bash

# Ensure the script stops on first error
set -e

echo "Starting deployment to Google Cloud Run..."

# Set your GCP Project ID here, or rely on the currently active config
# PROJECT_ID="your-project-id"

# Deploy the container to Cloud Run
# - --source . builds the Dockerfile automatically using Cloud Build
# - --min-instances 1 keeps the container warm 24/7
# - --no-cpu-throttling ensures the Upstox WebSocket/Polling doesn't freeze
gcloud run deploy upstox-trading-bot \
  --source . \
  --region asia-south1 \
  --allow-unauthenticated \
  --min-instances 1 \
  --no-cpu-throttling \
  --set-env-vars="UPSTOX_API_KEY=${UPSTOX_API_KEY},UPSTOX_API_SECRET=${UPSTOX_API_SECRET},UPSTOX_ACCESS_TOKEN=${UPSTOX_ACCESS_TOKEN}"

echo "Deployment complete! Your bot is now running 24/7."

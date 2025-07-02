#!/bin/bash

# Exit on error
set -e

# Configuration
BUCKET_NAME=${TF_STATE_BUCKET:-"autonyan-terraform-state"}
LOCATION=${TF_STATE_LOCATION:-"us-central1"}
PROJECT_ID=$(gcloud config get-value project)

# Validate inputs
if [ -z "$PROJECT_ID" ]; then
    echo "Error: No Google Cloud project configured"
    echo "Please run: gcloud config set project YOUR_PROJECT_ID"
    exit 1
fi

# Check if bucket exists
if gcloud storage buckets describe gs://${BUCKET_NAME} >/dev/null 2>&1; then
    echo "Bucket gs://${BUCKET_NAME} already exists"
else
    echo "Creating GCS bucket for Terraform state..."
    gcloud storage buckets create gs://${BUCKET_NAME} \
        --project=${PROJECT_ID} \
        --location=${LOCATION} \
        --uniform-bucket-level-access
fi

# Enable versioning (idempotent operation)
echo "Ensuring versioning is enabled..."
gcloud storage buckets update gs://${BUCKET_NAME} \
    --versioning

# Set lifecycle policy
echo "Setting lifecycle policy..."
cat > lifecycle-policy.json << EOF
{
  "rule": [
    {
      "action": {
        "type": "Delete"
      },
      "condition": {
        "numNewerVersions": 10,
        "isLive": false
      }
    }
  ]
}
EOF

# Apply lifecycle policy (idempotent operation)
gcloud storage buckets update gs://${BUCKET_NAME} \
    --lifecycle-file=lifecycle-policy.json

# Create or update backend configuration file
echo "Creating backend configuration..."
cat > terraform/backend.hcl << EOF
bucket = "${BUCKET_NAME}"
prefix = "terraform/state"
EOF

# Clean up
rm -f lifecycle-policy.json

echo "Terraform state bucket setup complete!"
echo "Bucket: gs://${BUCKET_NAME}"
echo "Location: ${LOCATION}"
echo "Backend configuration created in terraform/backend.hcl"
echo "To initialize Terraform with this backend, run:"
echo "terraform init -backend-config=backend.hcl" 
terraform {
  required_version = ">= 1.5.0"
  backend "gcs" {
    # Lock timeout is managed at the client level
    # GitHub Actions steps have timeout-minutes: 10
    # Local development can use TF_LOCK_TIMEOUT env var
  }
} 
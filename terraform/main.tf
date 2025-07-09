# Terraform configuration block specifying required providers
terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

# Google Cloud provider configuration
# Uses variables for project ID and default region
provider "google" {
  project = var.project_id
  region  = var.region
}

# Enable required Google Cloud APIs
resource "google_project_service" "drive_api" {
  service = "drive.googleapis.com"

  disable_on_destroy = false
}

resource "google_project_service" "pubsub_api" {
  service = "pubsub.googleapis.com"

  disable_on_destroy = false
}

resource "google_project_service" "cloudfunctions_api" {
  service = "cloudfunctions.googleapis.com"

  disable_on_destroy = false
}


# Google Cloud Storage bucket for function source code archives
# Stores zip files containing built function code for deployment
# Uses uniform bucket-level access for simplified permissions
resource "google_storage_bucket" "function_bucket" {
  name                        = "${var.project_id}-function-source"
  location                    = var.region
  uniform_bucket_level_access = true
}

# Google Cloud Storage bucket for document data storage
# Stores processed document files copied from Google Drive
# Used by the document scanner function for data persistence
resource "google_storage_bucket" "document_storage" {
  name                        = "${var.project_id}-document-storage"
  location                    = var.region
  uniform_bucket_level_access = true
}


# PubSub topic for document classification workflow
# Receives messages containing document metadata for processing
# Used by the drive scanner to queue documents for classification
resource "google_pubsub_topic" "document_classification" {
  name = "document-classification"
}

# PubSub topic for triggering Google Drive folder scans
# Receives scheduled messages from Cloud Scheduler
# Initiates the drive document scanner function
resource "google_pubsub_topic" "folder_scan_trigger" {
  name = "folder-scan-trigger"
}

# PubSub topic for document scanning preparation
# Receives messages containing Google Drive file IDs for document processing
# Triggers the document scanner function to copy files to Cloud Storage
resource "google_pubsub_topic" "document_scan_preparation" {
  name = "document-scan-preparation"
}

# Cloud Scheduler job for automated Google Drive scanning
# Publishes messages to folder-scan-trigger topic on a configurable schedule
# Schedule format uses Unix cron syntax (e.g., "0 9 * * 1" for weekly Monday 9 AM)
resource "google_cloud_scheduler_job" "folder_scan_schedule" {
  name        = "folder-scan-schedule"
  description = "Automated scheduler for Google Drive document scanning and classification"
  schedule    = var.drive_scanner_schedule
  time_zone   = "UTC"
  region      = var.region

  pubsub_target {
    topic_name = google_pubsub_topic.folder_scan_trigger.id
    data = base64encode(jsonencode({
      folderId = var.drive_folder_id
    }))
  }
}

# Google Cloud Function v2 - Drive Document Scanner
# Event-driven function triggered by PubSub messages from the scheduler
# Scans specified Google Drive folders and publishes document metadata
# for downstream classification processing
resource "google_cloudfunctions2_function" "folder_scanner" {
  name        = "folder-scanner"
  description = "Automated Google Drive scanner that discovers documents and queues them for classification processing"
  location    = var.region

  build_config {
    runtime     = "nodejs20"
    entry_point = "folderScanner"
    source {
      storage_source {
        bucket     = google_storage_bucket.function_bucket.name
        object     = google_storage_bucket_object.folder_scanner_zip.name
        generation = google_storage_bucket_object.folder_scanner_zip.generation
      }
    }
  }

  service_config {
    max_instance_count = 10
    min_instance_count = 0
    available_memory   = "512M"
    timeout_seconds    = 300
    environment_variables = {
      NODE_ENV                        = "production"
      DOCUMENT_SCAN_PREPARATION_TOPIC = google_pubsub_topic.document_scan_preparation.name
    }
    service_account_email = google_service_account.folder_scanner_sa.email
  }

  event_trigger {
    event_type   = "google.cloud.pubsub.topic.v1.messagePublished"
    pubsub_topic = google_pubsub_topic.folder_scan_trigger.id
    retry_policy = "RETRY_POLICY_RETRY"
  }
}

# Google Cloud Function v2 - Document Scan Preparation
# Event-driven function triggered by PubSub messages containing Google Drive file IDs
# Downloads files from Google Drive and copies them to Cloud Storage
# Provides document preparation for downstream processing
resource "google_cloudfunctions2_function" "document_scan_preparation" {
  name        = "document-scan-preparation"
  description = "Prepares documents for scanning by copying Google Drive files to Cloud Storage"
  location    = var.region

  build_config {
    runtime     = "nodejs20"
    entry_point = "documentScanPreparation"
    source {
      storage_source {
        bucket     = google_storage_bucket.function_bucket.name
        object     = google_storage_bucket_object.document_scan_preparation_zip.name
        generation = google_storage_bucket_object.document_scan_preparation_zip.generation
      }
    }
  }

  service_config {
    max_instance_count = 100
    min_instance_count = 0
    available_memory   = "512M"
    timeout_seconds    = 540
    environment_variables = {
      NODE_ENV   = "production"
      PROJECT_ID = var.project_id
    }
    service_account_email = google_service_account.document_scan_preparation_sa.email
  }

  event_trigger {
    event_type   = "google.cloud.pubsub.topic.v1.messagePublished"
    pubsub_topic = google_pubsub_topic.document_scan_preparation.id
    retry_policy = "RETRY_POLICY_RETRY"
  }
}

# Dedicated service account for the document scan preparation function
# Accesses Google Drive through manual folder sharing (not project-level IAM)
# Includes permissions for API access, Cloud Storage, and PubSub
resource "google_service_account" "document_scan_preparation_sa" {
  account_id   = "document-scan-preparation"
  display_name = "Document Scan Preparation Service Account"
  description  = "Service account for Google Drive access and Cloud Storage operations"

  create_ignore_already_exists = true
}

# Dedicated service account for the drive scanner function
# Accesses Google Drive through manual folder sharing (not project-level IAM)
# Includes permissions for API access and PubSub publishing
resource "google_service_account" "folder_scanner_sa" {
  account_id   = "folder-scanner"
  display_name = "Drive File Manager Service Account"
  description  = "Service account for Google Drive access via folder sharing and PubSub publishing"

  create_ignore_already_exists = true
}

# IAM binding for Google Cloud Storage access - Document Scan Preparation
# Grants read/write access to storage objects for the document scan preparation service account
resource "google_project_iam_member" "document_scan_preparation_storage_access" {
  project = var.project_id
  role    = "roles/storage.objectAdmin"
  member  = "serviceAccount:${google_service_account.document_scan_preparation_sa.email}"
}

# IAM binding for Google API service usage - Document Scan Preparation
# Allows the document scan preparation service account to consume Google Cloud APIs
resource "google_project_iam_member" "document_scan_preparation_service_usage" {
  project = var.project_id
  role    = "roles/serviceusage.serviceUsageConsumer"
  member  = "serviceAccount:${google_service_account.document_scan_preparation_sa.email}"
}

# IAM binding for Google Cloud Storage access - Folder Scanner
# Grants read access to storage objects for the folder scanner service account
resource "google_project_iam_member" "storage_access" {
  project = var.project_id
  role    = "roles/storage.objectViewer"
  member  = "serviceAccount:${google_service_account.folder_scanner_sa.email}"
}

# Note: Google Drive permissions are granted through manual sharing
# Drive API roles (roles/drive.file, roles/drive.readonly, etc.) are not supported
# for project-level IAM bindings. Access is granted by sharing folders directly
# with the service account email address.

# IAM binding for Google API service usage
# Allows the service account to consume Google Cloud APIs
# Required for accessing Drive API and other Google services
resource "google_project_iam_member" "service_usage" {
  project = var.project_id
  role    = "roles/serviceusage.serviceUsageConsumer"
  member  = "serviceAccount:${google_service_account.folder_scanner_sa.email}"
}

# IAM binding for PubSub message publishing
# Grants permission to publish messages to PubSub topics
# Essential for the scanner to queue documents for classification
resource "google_project_iam_member" "pubsub_publisher" {
  project = var.project_id
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${google_service_account.folder_scanner_sa.email}"
}

# Drive scanner function source code archive
# Contains the built and zipped drive document scanner function
# Generated by the build process and deployed to Cloud Functions
resource "google_storage_bucket_object" "folder_scanner_zip" {
  name   = "folder-scanner.zip"
  bucket = google_storage_bucket.function_bucket.name
  source = "../dist/functions/folder-scanner.zip"
}

# Document scan preparation function source code archive
# Contains the built and zipped document scan preparation function
# Generated by the build process and deployed to Cloud Functions
resource "google_storage_bucket_object" "document_scan_preparation_zip" {
  name   = "document-scan-preparation.zip"
  bucket = google_storage_bucket.function_bucket.name
  source = "../dist/functions/document-scan-preparation.zip"
}

# Output values for manual configuration
output "service_account_email" {
  description = "Email of the service account that needs Drive folder access"
  value       = google_service_account.folder_scanner_sa.email
}

output "document_scan_preparation_service_account_email" {
  description = "Email of the document scan preparation service account that needs Drive folder access"
  value       = google_service_account.document_scan_preparation_sa.email
}

output "document_scan_preparation_topic" {
  description = "PubSub topic for document scanning preparation"
  value       = google_pubsub_topic.document_scan_preparation.name
}

output "document_storage_bucket" {
  description = "Cloud Storage bucket for document data"
  value       = google_storage_bucket.document_storage.name
}

output "drive_folder_setup_instructions" {
  description = "Instructions for granting Google Drive access through manual sharing"
  value       = <<-EOT
    IMPORTANT: Google Drive access is granted through MANUAL SHARING only.
    Drive API roles cannot be assigned at the project level.

    Required Setup Steps:

    STEP 1 - Share Your Drive/Folders:
    1. Open Google Drive (https://drive.google.com)
    2. To grant access to entire Drive:
       - Right-click "My Drive" and select "Share"
    3. To grant access to specific folders:
       - Right-click the folder(s) and select "Share"
    4. Add these emails as editors:
       - Folder Scanner: ${google_service_account.folder_scanner_sa.email}
       - Document Scan Preparation: ${google_service_account.document_scan_preparation_sa.email}
    5. Set permission level to "Editor"
    6. Click "Send"

    STEP 2 - Configure Folder ID:
    Set drive_folder_id in terraform.tfvars:
    - For entire Drive: drive_folder_id = "root"
    - For specific folder: drive_folder_id = "FOLDER_ID_FROM_URL"

    Permissions: Once shared, the service account can:
    ✅ List files and folders (in shared areas only)
    ✅ Create new folders (in shared areas only)
    ✅ Move files between folders (within shared areas)
    ✅ Copy files (within shared areas)
    ✅ Read file metadata
    ❌ Access unshared folders
    ❌ Delete files or folders
    ❌ Manage sharing permissions

    Get folder ID from URLs like:
    https://drive.google.com/drive/folders/FOLDER_ID_HERE
  EOT
}

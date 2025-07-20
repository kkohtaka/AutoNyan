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
  force_destroy               = true
}

# Google Cloud Storage bucket for document data storage
# Stores processed document files copied from Google Drive
# Used by the document scanner function for data persistence
resource "google_storage_bucket" "document_storage" {
  name                        = "${var.project_id}-document-storage"
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = true
}


# PubSub topic for document classification workflow
# Receives messages containing document metadata for processing
# Used by the drive scanner to queue documents for classification
resource "google_pubsub_topic" "document_classification" {
  name = "document-classification"
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
    topic_name = module.folder_scanner.topic_id
    data = base64encode(jsonencode({
      folderId = var.drive_folder_id
    }))
  }
}

# Folder Scanner Module
# Handles Google Drive folder scanning functionality
module "folder_scanner" {
  source = "./modules/folder-scanner"

  project_id                           = var.project_id
  region                               = var.region
  function_bucket_name                 = google_storage_bucket.function_bucket.name
  document_scan_preparation_topic_name = module.document_scan_preparation.topic_name
}

# Document Scan Preparation Module
# Handles document preparation and Cloud Storage operations
module "document_scan_preparation" {
  source = "./modules/document-scan-preparation"

  project_id           = var.project_id
  region               = var.region
  function_bucket_name = google_storage_bucket.function_bucket.name
}

# Note: Service accounts, IAM bindings, and storage bucket objects
# are now managed within their respective function modules

# Output values for manual configuration
output "service_account_email" {
  description = "Email of the service account that needs Drive folder access"
  value       = module.folder_scanner.service_account_email
}

output "document_scan_preparation_service_account_email" {
  description = "Email of the document scan preparation service account that needs Drive folder access"
  value       = module.document_scan_preparation.service_account_email
}

output "document_scan_preparation_topic" {
  description = "PubSub topic for document scanning preparation"
  value       = module.document_scan_preparation.topic_name
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
       - Folder Scanner: ${module.folder_scanner.service_account_email}
       - Document Scan Preparation: ${module.document_scan_preparation.service_account_email}
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

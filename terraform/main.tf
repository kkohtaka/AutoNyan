# Terraform configuration block specifying required providers
terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
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

resource "google_project_service" "vision_api" {
  service = "vision.googleapis.com"

  disable_on_destroy = false
}

resource "google_project_service" "firestore_api" {
  service = "firestore.googleapis.com"

  disable_on_destroy = false
}

# Firestore database for storing extracted document text and metadata
# Uses Native mode for real-time sync and flexible queries
# Note: Default database is shared across environments in the same project
resource "google_firestore_database" "default" {
  project     = var.project_id
  name        = "(default)"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"

  # Prevent accidental deletion of the database
  deletion_policy = "DELETE"

  # Prevent Terraform from destroying this database
  # If database is deleted, recreating requires waiting ~3-5 minutes for Google Cloud API
  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.firestore_api]
}

resource "google_project_service" "vertex_ai_api" {
  service = "aiplatform.googleapis.com"

  disable_on_destroy = false
}


# Google Cloud Storage bucket for function source code archives
# Stores zip files containing built function code for deployment
# Uses uniform bucket-level access for simplified permissions
resource "google_storage_bucket" "function_bucket" {
  name                        = "${var.project_id}-${var.environment}-function-source"
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = true
}

# Google Cloud Storage bucket for document data storage
# Stores processed document files copied from Google Drive
# Used by the document scanner function for data persistence
resource "google_storage_bucket" "document_storage" {
  name                        = "${var.project_id}-${var.environment}-document-storage"
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = true
}

# Google Cloud Storage bucket for Vision API results
# Stores JSON output from Vision API text extraction processing
# Used by text-firebase-writer function to parse and store extracted text
resource "google_storage_bucket" "vision_results" {
  name                        = "${var.project_id}-${var.environment}-vision-results"
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = true
}

# Data source to get the Cloud Storage service account
# This service account is used by CloudEvent triggers for Cloud Functions
data "google_storage_project_service_account" "gcs_account" {
  project = var.project_id
}

# Grant the Cloud Storage service account pubsub.publisher role
# Required for CloudEvent triggers to publish messages to Cloud Functions
resource "google_project_iam_member" "gcs_pubsub_publisher" {
  project = var.project_id
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${data.google_storage_project_service_account.gcs_account.email_address}"
}



# Cloud Scheduler job for automated Google Drive scanning
# Publishes messages to drive-scan-trigger topic on a configurable schedule
# Schedule format uses Unix cron syntax (e.g., "0 9 * * 1" for weekly Monday 9 AM)
resource "google_cloud_scheduler_job" "drive_scan_schedule" {
  name        = "${var.environment}-drive-scan-schedule"
  description = "Automated scheduler for Google Drive document scanning and classification (${var.environment})"
  schedule    = var.drive_scanner_schedule
  time_zone   = "UTC"
  region      = var.region

  pubsub_target {
    topic_name = module.drive_scanner.topic_id
    data = base64encode(jsonencode({
      folderId = var.drive_folder_id
    }))
  }
}

# Drive Scanner Module
# Handles Google Drive folder scanning functionality
module "drive_scanner" {
  source = "./modules/drive-scanner"

  project_id                     = var.project_id
  environment                    = var.environment
  region                         = var.region
  function_bucket_name           = google_storage_bucket.function_bucket.name
  doc_process_trigger_topic_name = module.doc_processor.topic_name
}

# Document Processor Module
# Handles document preparation and Cloud Storage operations
module "doc_processor" {
  source = "./modules/doc-processor"

  project_id           = var.project_id
  environment          = var.environment
  region               = var.region
  function_bucket_name = google_storage_bucket.function_bucket.name
}

# Text Vision Processor Module
# Processes documents with Vision API for text extraction
module "text_vision_processor" {
  source = "./modules/text-vision-processor"

  project_id                   = var.project_id
  environment                  = var.environment
  region                       = var.region
  function_bucket_name         = google_storage_bucket.function_bucket.name
  document_storage_bucket_name = google_storage_bucket.document_storage.name
  vision_results_bucket_name   = google_storage_bucket.vision_results.name
}

# Text Firebase Writer Module
# Stores Vision API text extraction results to Firestore
module "text_firebase_writer" {
  source = "./modules/text-firebase-writer"

  project_id                   = var.project_id
  environment                  = var.environment
  region                       = var.region
  function_bucket_name         = google_storage_bucket.function_bucket.name
  vision_results_bucket_name   = google_storage_bucket.vision_results.name
  document_storage_bucket_name = google_storage_bucket.document_storage.name
}

# File Classifier Module
# Classifies documents using AI and moves them to categorized folders in Google Drive
module "file_classifier" {
  source = "./modules/file-classifier"

  project_id              = var.project_id
  environment             = var.environment
  region                  = var.region
  function_bucket_name    = google_storage_bucket.function_bucket.name
  category_root_folder_id = var.category_root_folder_id
  uncategorized_folder_id = var.uncategorized_folder_id

  # Firestore database must exist before creating Firestore triggers
  depends_on = [google_firestore_database.default]
}

# Note: Service accounts, IAM bindings, and storage bucket objects
# are now managed within their respective function modules

# Output values for manual configuration
output "service_account_email" {
  description = "Email of the service account that needs Drive folder access"
  value       = module.drive_scanner.service_account_email
}

output "doc_processor_service_account_email" {
  description = "Email of the document processor service account that needs Drive folder access"
  value       = module.doc_processor.service_account_email
}

output "doc_process_trigger_topic" {
  description = "PubSub topic for document processing trigger"
  value       = module.doc_processor.topic_name
}

output "document_storage_bucket" {
  description = "Cloud Storage bucket for document data"
  value       = google_storage_bucket.document_storage.name
}

output "vision_results_bucket" {
  description = "Cloud Storage bucket for Vision API results"
  value       = google_storage_bucket.vision_results.name
}

output "text_vision_processor_service_account_email" {
  description = "Email of the text vision processor service account"
  value       = module.text_vision_processor.service_account_email
}

output "text_firebase_writer_service_account_email" {
  description = "Email of the text firebase writer service account"
  value       = module.text_firebase_writer.service_account_email
}

output "file_classifier_service_account_email" {
  description = "Email of the file classifier service account"
  value       = module.file_classifier.service_account_email
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
       - Drive Scanner: ${module.drive_scanner.service_account_email}
       - Document Processor: ${module.doc_processor.service_account_email}
       - File Classifier: ${module.file_classifier.service_account_email}
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

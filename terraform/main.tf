# Terraform configuration block specifying required providers
terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.0"
    }
  }
}

# Google Cloud provider configuration
# Uses variables for project ID and default region
provider "google" {
  project = var.project_id
  region  = var.region

  # Some APIs (e.g. billingbudgets.googleapis.com) require a quota project via
  # the X-Goog-User-Project header. Service-account auth (CI) supplies this
  # automatically, but local user ADC does not, causing a 403 on budget reads.
  # Routing quota/billing to this project makes both local and CI deploys work
  # without per-developer GOOGLE_BILLING_PROJECT / GOOGLE_USER_PROJECT_OVERRIDE
  # environment variables.
  user_project_override = true
  billing_project       = var.project_id
}

locals {
  # Non-production environments send real mail through the same pipeline as
  # production, so their notifications carry a prefix recipients can filter on.
  # This is per deployment, not per run: it marks every staging notification,
  # not only those an E2E run produced.
  email_subject_prefix = (
    var.email_subject_prefix != "" ? var.email_subject_prefix :
    var.environment == "production" ? "" : "[AutoNyan E2E]"
  )
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
# Note: Uses environment-specific named databases for complete data isolation
resource "google_firestore_database" "default" {
  project     = var.project_id
  name        = var.environment
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

resource "google_project_service" "secretmanager_api" {
  service = "secretmanager.googleapis.com"

  disable_on_destroy = false
}

resource "google_project_service" "gmail_api" {
  service = "gmail.googleapis.com"

  disable_on_destroy = false
}

resource "google_project_service" "calendar_api" {
  service = "calendar-json.googleapis.com"

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

# Cloud Scheduler job for the re-classification sweep
# Cheap by design: a sweep that finds no change to the category folders
# republishes nothing, so the cadence is set by how long a user should wait
# after creating a folder, not by cost. Offset from the drive scan so the two
# schedules do not contend for the same Drive API quota.
resource "google_cloud_scheduler_job" "reclassification_sweep_schedule" {
  name        = "${var.environment}-reclassification-sweep-schedule"
  description = "Re-classify documents left in the Uncategorized folder (${var.environment})"
  schedule    = var.reclassification_sweep_schedule
  time_zone   = "UTC"
  region      = var.region

  pubsub_target {
    topic_name = module.reclassification_sweeper.topic_id
    data       = base64encode(jsonencode({}))
  }
}

# Notification Dispatcher Module (must be defined before other modules to reference topic name)
# Dispatches email notifications on document processing success and failure
module "notification_dispatcher" {
  source = "./modules/notification-dispatcher"

  project_id              = var.project_id
  environment             = var.environment
  region                  = var.region
  function_bucket_name    = google_storage_bucket.function_bucket.name
  notification_from_email = var.notification_from_email
  email_subject_prefix    = local.email_subject_prefix

  depends_on = [
    google_project_service.secretmanager_api,
    google_project_service.gmail_api,
  ]
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
  notification_topic_name        = module.notification_dispatcher.topic_name

  # Firestore database must exist before the scanner records scanned files
  depends_on = [google_firestore_database.default]
}

# Document Processor Module
# Handles document preparation and Cloud Storage operations
module "doc_processor" {
  source = "./modules/doc-processor"

  project_id              = var.project_id
  environment             = var.environment
  region                  = var.region
  function_bucket_name    = google_storage_bucket.function_bucket.name
  notification_topic_name = module.notification_dispatcher.topic_name
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
  notification_topic_name      = module.notification_dispatcher.topic_name
}

# File Classifier Module (must be defined before text_firebase_writer to reference topic)
# Classifies documents using AI and moves them to categorized folders in Google Drive
module "file_classifier" {
  source = "./modules/file-classifier"

  project_id              = var.project_id
  environment             = var.environment
  region                  = var.region
  function_bucket_name    = google_storage_bucket.function_bucket.name
  category_root_folder_id = var.category_root_folder_id
  uncategorized_folder_id = var.uncategorized_folder_id
  notification_topic_name = module.notification_dispatcher.topic_name

  # Calendar registration hangs off classification: the classifier publishes
  # the category it decided on, and the registrar owns the category-to-calendar
  # mapping.
  calendar_registrar_topic = module.calendar_registrar.topic_name

  # Firestore database must exist before creating documents
  depends_on = [google_firestore_database.default]
}

# Calendar Registrar Module
# Extracts events from documents the classifier filed into a mapped category and
# registers them on the calendar configured for that category
module "calendar_registrar" {
  source = "./modules/calendar-registrar"

  project_id                          = var.project_id
  environment                         = var.environment
  region                              = var.region
  function_bucket_name                = google_storage_bucket.function_bucket.name
  category_calendars                  = var.calendar_category_calendars
  time_zone                           = var.calendar_time_zone
  default_event_duration_minutes      = var.calendar_default_event_duration_minutes
  classification_confidence_threshold = var.calendar_classification_confidence_threshold
  notification_topic_name             = module.notification_dispatcher.topic_name

  depends_on = [
    google_firestore_database.default,
    google_project_service.calendar_api,
  ]
}

# Reclassification Sweeper Module
# Re-submits documents left in the Uncategorized folder for classification once
# the set of category folders has changed
module "reclassification_sweeper" {
  source = "./modules/reclassification-sweeper"

  project_id                    = var.project_id
  environment                   = var.environment
  region                        = var.region
  function_bucket_name          = google_storage_bucket.function_bucket.name
  category_root_folder_id       = var.category_root_folder_id
  uncategorized_folder_id       = var.uncategorized_folder_id
  file_classifier_trigger_topic = module.file_classifier.topic_name

  depends_on = [google_firestore_database.default]
}

# Text Firebase Writer Module
# Stores Vision API text extraction results to Firestore and triggers classification
module "text_firebase_writer" {
  source = "./modules/text-firebase-writer"

  project_id                    = var.project_id
  environment                   = var.environment
  region                        = var.region
  function_bucket_name          = google_storage_bucket.function_bucket.name
  vision_results_bucket_name    = google_storage_bucket.vision_results.name
  document_storage_bucket_name  = google_storage_bucket.document_storage.name
  file_classifier_trigger_topic = module.file_classifier.topic_name
  notification_topic_name       = module.notification_dispatcher.topic_name
}

# Note: Service accounts, IAM bindings, and storage bucket objects
# are now managed within their respective function modules

terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 4.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# Cloud Run Function v2 for hello world
resource "google_cloudfunctions2_function" "hello_world" {
  name        = "hello-world"
  description = "A simple hello world function"
  location    = var.region

  build_config {
    runtime     = "nodejs20"
    entry_point = "helloWorld"
    source {
      storage_source {
        bucket = google_storage_bucket.function_bucket.name
        object = google_storage_bucket_object.function_zip.name
      }
    }
  }

  service_config {
    max_instance_count = 100
    min_instance_count = 0
    available_memory   = "256M"
    timeout_seconds    = 60
    environment_variables = {
      NODE_ENV = "production"
    }
  }
}

# IAM policy for the function
resource "google_cloudfunctions2_function_iam_member" "invoker" {
  project        = google_cloudfunctions2_function.hello_world.project
  location       = google_cloudfunctions2_function.hello_world.location
  cloud_function = google_cloudfunctions2_function.hello_world.name
  role           = "roles/cloudfunctions.invoker"
  member         = "allUsers" # Public access. Change this based on your security requirements
}

# Storage bucket for function source code
resource "google_storage_bucket" "function_bucket" {
  name                        = "${var.project_id}-function-source"
  location                    = var.region
  uniform_bucket_level_access = true
}

# Zip the function source code
resource "google_storage_bucket_object" "function_zip" {
  name   = "function-source.zip"
  bucket = google_storage_bucket.function_bucket.name
  source = "../dist/functions/hello.zip" # This will be created by the build script
}

# PubSub topic for document classification
resource "google_pubsub_topic" "document_classification" {
  name = "document-classification"
}

# Cloud Run Function v2 for drive document scanner
resource "google_cloudfunctions2_function" "drive_document_scanner" {
  name        = "drive-document-scanner"
  description = "Scans Google Drive folder for documents and publishes to PubSub for classification"
  location    = var.region

  build_config {
    runtime     = "nodejs20"
    entry_point = "driveDocumentScanner"
    source {
      storage_source {
        bucket = google_storage_bucket.function_bucket.name
        object = google_storage_bucket_object.drive_scanner_zip.name
      }
    }
  }

  service_config {
    max_instance_count = 10
    min_instance_count = 0
    available_memory   = "512M"
    timeout_seconds    = 300
    environment_variables = {
      NODE_ENV     = "production"
      PUBSUB_TOPIC = google_pubsub_topic.document_classification.name
    }
    service_account_email = google_service_account.drive_scanner_function_sa.email
  }
}

# Service account for the drive scanner function
resource "google_service_account" "drive_scanner_function_sa" {
  account_id   = "drive-scanner-function"
  display_name = "Drive Scanner Function Service Account"
  description  = "Service account for drive document scanner function"

  lifecycle {
    prevent_destroy = false
  }
}

# IAM binding for Drive API access - using a broader role that includes Drive API access
resource "google_project_iam_member" "drive_access" {
  project = var.project_id
  role    = "roles/storage.objectViewer"
  member  = "serviceAccount:${google_service_account.drive_scanner_function_sa.email}"
}

# Enable Drive API access by granting the service account access to use Google APIs
resource "google_project_iam_member" "service_usage" {
  project = var.project_id
  role    = "roles/serviceusage.serviceUsageConsumer"
  member  = "serviceAccount:${google_service_account.drive_scanner_function_sa.email}"
}

# IAM binding for PubSub publisher access
resource "google_project_iam_member" "pubsub_publisher" {
  project = var.project_id
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${google_service_account.drive_scanner_function_sa.email}"
}

# Zip file for drive scanner function
resource "google_storage_bucket_object" "drive_scanner_zip" {
  name   = "drive-scanner-source.zip"
  bucket = google_storage_bucket.function_bucket.name
  source = "../dist/functions/drive-document-scanner.zip"
}

# IAM policy for drive scanner function invoker
resource "google_cloudfunctions2_function_iam_member" "drive_scanner_invoker" {
  project        = google_cloudfunctions2_function.drive_document_scanner.project
  location       = google_cloudfunctions2_function.drive_document_scanner.location
  cloud_function = google_cloudfunctions2_function.drive_document_scanner.name
  role           = "roles/cloudfunctions.invoker"
  member         = "serviceAccount:${google_service_account.drive_scanner_function_sa.email}"
}

# Cloud Scheduler job to trigger drive document scanner on configurable schedule
resource "google_cloud_scheduler_job" "drive_scanner_schedule" {
  name        = "drive-document-scanner-schedule"
  description = "Scheduled job to scan Google Drive for documents"
  schedule    = var.drive_scanner_schedule
  time_zone   = "UTC"
  region      = var.region

  pubsub_target {
    topic_name = google_pubsub_topic.drive_scanner_trigger.id
    data = base64encode(jsonencode({
      folderId  = var.drive_folder_id
      topicName = google_pubsub_topic.document_classification.name
    }))
  }
}

# PubSub topic for triggering the drive scanner
resource "google_pubsub_topic" "drive_scanner_trigger" {
  name = "drive-scanner-trigger"
}

# PubSub subscription for drive scanner trigger
resource "google_pubsub_subscription" "drive_scanner_trigger_sub" {
  name  = "drive-scanner-trigger-sub"
  topic = google_pubsub_topic.drive_scanner_trigger.name

  push_config {
    push_endpoint = google_cloudfunctions2_function.drive_document_scanner.service_config[0].uri

    oidc_token {
      service_account_email = google_service_account.drive_scanner_function_sa.email
    }
  }

  ack_deadline_seconds = 300
}

# IAM binding for Cloud Scheduler to publish to PubSub
resource "google_project_iam_member" "scheduler_pubsub" {
  project = var.project_id
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:service-${data.google_project.current.number}@gcp-sa-cloudscheduler.iam.gserviceaccount.com"
}

# Data source to get current project details
data "google_project" "current" {}

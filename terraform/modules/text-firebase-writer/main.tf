# Service account for text-firebase-writer function
resource "google_service_account" "text_firebase_writer" {
  account_id   = "${var.environment}-text-fb-writer"
  display_name = "Text Firebase Writer Service Account (${var.environment})"
  description  = "Service account for text-firebase-writer Cloud Function"
}

# IAM binding for Firestore access
resource "google_project_iam_member" "text_firebase_writer_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.text_firebase_writer.email}"
}

# IAM binding for Cloud Storage access (read from vision results, read metadata from document storage)
resource "google_storage_bucket_iam_member" "text_firebase_writer_vision_results" {
  bucket = var.vision_results_bucket_name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.text_firebase_writer.email}"
}

resource "google_storage_bucket_iam_member" "text_firebase_writer_document_storage" {
  bucket = var.document_storage_bucket_name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.text_firebase_writer.email}"
}

# Source code archive for the function
resource "google_storage_bucket_object" "text_firebase_writer_zip" {
  name   = "text-firebase-writer.zip"
  bucket = var.function_bucket_name
  source = "../dist/functions/text-firebase-writer.zip"
}

# Cloud Function for storing Vision API results to Firebase
resource "google_cloudfunctions2_function" "text_firebase_writer" {
  name        = "${var.environment}-text-firebase-writer"
  location    = var.region
  description = "Store Vision API text extraction results to Firestore (${var.environment})"

  build_config {
    runtime     = "nodejs20"
    entry_point = "textFirebaseWriter"
    source {
      storage_source {
        bucket     = var.function_bucket_name
        object     = google_storage_bucket_object.text_firebase_writer_zip.name
        generation = google_storage_bucket_object.text_firebase_writer_zip.generation
      }
    }
  }

  service_config {
    max_instance_count = 10
    min_instance_count = 0
    available_memory   = "512Mi"
    timeout_seconds    = 300
    environment_variables = {
      PROJECT_ID = var.project_id
    }
    service_account_email = google_service_account.text_firebase_writer.email
  }

  event_trigger {
    trigger_region = var.region
    event_type     = "google.cloud.storage.object.v1.finalized"
    retry_policy   = "RETRY_POLICY_RETRY"
    event_filters {
      attribute = "bucket"
      value     = var.vision_results_bucket_name
    }
  }
}

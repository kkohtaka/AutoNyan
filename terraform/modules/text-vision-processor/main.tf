# Service account for text-vision-processor function
resource "google_service_account" "text_vision_processor" {
  account_id   = "text-vision-processor"
  display_name = "Text Vision Processor Service Account"
  description  = "Service account for text-vision-processor Cloud Function"
}

# IAM binding for Vision API access
resource "google_project_iam_member" "text_vision_processor_vision" {
  project = var.project_id
  role    = "roles/ml.developer"
  member  = "serviceAccount:${google_service_account.text_vision_processor.email}"
}

# IAM binding for Cloud Storage access (read from document storage, write to vision results)
resource "google_storage_bucket_iam_member" "text_vision_processor_document_storage" {
  bucket = var.document_storage_bucket_name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.text_vision_processor.email}"
}

resource "google_storage_bucket_iam_member" "text_vision_processor_vision_results" {
  bucket = var.vision_results_bucket_name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.text_vision_processor.email}"
}

# Source code archive for the function
resource "google_storage_bucket_object" "text_vision_processor_zip" {
  name   = "text-vision-processor.zip"
  bucket = var.function_bucket_name
  source = "../dist/functions/text-vision-processor.zip"
}

# Cloud Function for text vision processing
resource "google_cloudfunctions2_function" "text_vision_processor" {
  name        = "text-vision-processor"
  location    = var.region
  description = "Process documents with Vision API for text extraction"

  build_config {
    runtime     = "nodejs20"
    entry_point = "textVisionProcessor"
    source {
      storage_source {
        bucket = var.function_bucket_name
        object = google_storage_bucket_object.text_vision_processor_zip.name
      }
    }
  }

  service_config {
    max_instance_count = 10
    min_instance_count = 0
    available_memory   = "1Gi"
    timeout_seconds    = 540
    environment_variables = {
      PROJECT_ID = var.project_id
    }
    service_account_email = google_service_account.text_vision_processor.email
  }

  event_trigger {
    trigger_region = var.region
    event_type     = "google.cloud.storage.object.v1.finalized"
    retry_policy   = "RETRY_POLICY_RETRY"
    event_filters {
      attribute = "bucket"
      value     = var.document_storage_bucket_name
    }
  }
}

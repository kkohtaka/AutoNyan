# Service account for file-classifier function
resource "google_service_account" "file_classifier" {
  account_id   = "${var.environment}-file-classifier"
  display_name = "File Classifier Service Account (${var.environment})"
  description  = "Service account for file-classifier Cloud Function"
}

# IAM binding for Firestore access (read and write)
resource "google_project_iam_member" "file_classifier_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.file_classifier.email}"
}

# IAM binding for Vertex AI (Gemini API) access
resource "google_project_iam_member" "file_classifier_vertex_ai" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.file_classifier.email}"
}

# IAM binding for Eventarc (required for Firestore triggers)
resource "google_project_iam_member" "file_classifier_eventarc" {
  project = var.project_id
  role    = "roles/eventarc.eventReceiver"
  member  = "serviceAccount:${google_service_account.file_classifier.email}"
}

# IAM binding for Cloud Run Invoker (required for Firestore triggers on Cloud Functions Gen2)
resource "google_project_iam_member" "file_classifier_invoker" {
  project = var.project_id
  role    = "roles/run.invoker"
  member  = "serviceAccount:${google_service_account.file_classifier.email}"
}

# Source code archive for the function
resource "google_storage_bucket_object" "file_classifier_zip" {
  name   = "file-classifier.zip"
  bucket = var.function_bucket_name
  source = "../dist/functions/file-classifier.zip"
}

# Cloud Function for classifying and moving files
resource "google_cloudfunctions2_function" "file_classifier" {
  name        = "${var.environment}-file-classifier"
  location    = var.region
  description = "Classify documents using AI and move them to categorized folders in Google Drive (${var.environment})"

  build_config {
    runtime     = "nodejs20"
    entry_point = "fileClassifier"
    source {
      storage_source {
        bucket     = var.function_bucket_name
        object     = google_storage_bucket_object.file_classifier_zip.name
        generation = google_storage_bucket_object.file_classifier_zip.generation
      }
    }
  }

  service_config {
    max_instance_count = 10
    min_instance_count = 0
    available_memory   = "512Mi"
    timeout_seconds    = 300
    environment_variables = {
      PROJECT_ID              = var.project_id
      CATEGORY_ROOT_FOLDER_ID = var.category_root_folder_id
      UNCATEGORIZED_FOLDER_ID = var.uncategorized_folder_id
    }
    service_account_email = google_service_account.file_classifier.email
  }

  event_trigger {
    trigger_region = var.region
    event_type     = "google.cloud.firestore.document.v1.created"
    retry_policy   = "RETRY_POLICY_RETRY"

    event_filters {
      attribute = "database"
      value     = "(default)"
    }

    event_filters {
      attribute = "document"
      value     = "extracted_texts/{documentId}"
    }
  }

  depends_on = [
    google_project_iam_member.file_classifier_firestore,
    google_project_iam_member.file_classifier_vertex_ai,
    google_project_iam_member.file_classifier_eventarc,
    google_project_iam_member.file_classifier_invoker,
  ]
}

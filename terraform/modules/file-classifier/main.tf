# Service account for file-classifier function
resource "google_service_account" "file_classifier" {
  account_id   = "${var.environment}-file-classifier"
  display_name = "File Classifier Service Account (${var.environment})"
  description  = "Service account for file-classifier Cloud Function"
}

# IAM binding for Firestore access (read and write)
resource "google_project_iam_member" "file_classifier_firestore" {
  project = var.project_id
  role    = "roles/datastore.owner"
  member  = "serviceAccount:${google_service_account.file_classifier.email}"
}

# IAM binding for Vertex AI (Gemini API) access
resource "google_project_iam_member" "file_classifier_vertex_ai" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.file_classifier.email}"
}

# IAM binding for PubSub publisher (to publish notifications)
resource "google_project_iam_member" "file_classifier_pubsub_publisher" {
  project = var.project_id
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${google_service_account.file_classifier.email}"
}

# PubSub topic for file classification trigger
resource "google_pubsub_topic" "file_classification_trigger" {
  name = "${var.environment}-file-classification-trigger"
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
      ENVIRONMENT             = var.environment
      VERTEX_AI_LOCATION      = var.region
      FIRESTORE_DATABASE_ID   = var.environment
      NOTIFICATION_TOPIC      = var.notification_topic_name
    }
    service_account_email = google_service_account.file_classifier.email
  }

  event_trigger {
    trigger_region = var.region
    event_type     = "google.cloud.pubsub.topic.v1.messagePublished"
    pubsub_topic   = google_pubsub_topic.file_classification_trigger.id
    retry_policy   = "RETRY_POLICY_RETRY"
  }

  depends_on = [
    google_project_iam_member.file_classifier_firestore,
    google_project_iam_member.file_classifier_vertex_ai,
    google_project_iam_member.file_classifier_pubsub_publisher,
    google_pubsub_topic.file_classification_trigger,
  ]
}

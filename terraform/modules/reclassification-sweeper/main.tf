# Service account for reclassification-sweeper function
# The account ID is abbreviated because GCP caps it at 30 characters, which
# the full function name exceeds once the environment prefix is added.
resource "google_service_account" "reclassification_sweeper" {
  account_id   = "${var.environment}-reclassify-sweeper"
  display_name = "Reclassification Sweeper Service Account (${var.environment})"
  description  = "Service account for reclassification-sweeper Cloud Function"
}

# IAM binding for Firestore access. The sweep reads uncategorized documents and
# writes back only the folder-set fingerprint, so document-level access is
# enough — it never administers the database itself.
resource "google_project_iam_member" "reclassification_sweeper_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.reclassification_sweeper.email}"
}

# IAM binding for PubSub publisher (to republish classification events)
resource "google_project_iam_member" "reclassification_sweeper_pubsub_publisher" {
  project = var.project_id
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${google_service_account.reclassification_sweeper.email}"
}

# PubSub topic driven by the Cloud Scheduler job
resource "google_pubsub_topic" "reclassification_sweep_trigger" {
  name = "${var.environment}-reclassification-sweep-trigger"
}

# Source code archive for the function
resource "google_storage_bucket_object" "reclassification_sweeper_zip" {
  name   = "reclassification-sweeper.zip"
  bucket = var.function_bucket_name
  source = "../dist/functions/reclassification-sweeper.zip"
}

# Cloud Function that re-submits uncategorized documents for classification
resource "google_cloudfunctions2_function" "reclassification_sweeper" {
  name        = "${var.environment}-reclassification-sweeper"
  location    = var.region
  description = "Re-submit documents left in the Uncategorized folder for classification after the category folders change (${var.environment})"

  build_config {
    runtime     = "nodejs24"
    entry_point = "reclassificationSweeper"
    source {
      storage_source {
        bucket     = var.function_bucket_name
        object     = google_storage_bucket_object.reclassification_sweeper_zip.name
        generation = google_storage_bucket_object.reclassification_sweeper_zip.generation
      }
    }
  }

  service_config {
    # Single instance on purpose: two sweeps running at once would both read
    # the same not-yet-updated folder-set hashes and republish every document
    # twice.
    max_instance_count = 1
    min_instance_count = 0
    available_memory   = "512Mi"
    timeout_seconds    = 540
    environment_variables = {
      PROJECT_ID              = var.project_id
      CATEGORY_ROOT_FOLDER_ID = var.category_root_folder_id
      UNCATEGORIZED_FOLDER_ID = var.uncategorized_folder_id
      ENVIRONMENT             = var.environment
      FIRESTORE_DATABASE_ID   = var.environment
      FILE_CLASSIFIER_TOPIC   = var.file_classifier_trigger_topic
      DRIVE_IDENTITY_EMAIL    = var.drive_identity_service_account_email
    }
    service_account_email = google_service_account.reclassification_sweeper.email
  }

  event_trigger {
    trigger_region = var.region
    event_type     = "google.cloud.pubsub.topic.v1.messagePublished"
    pubsub_topic   = google_pubsub_topic.reclassification_sweep_trigger.id
    retry_policy   = "RETRY_POLICY_RETRY"
  }

  depends_on = [
    google_project_iam_member.reclassification_sweeper_firestore,
    google_project_iam_member.reclassification_sweeper_pubsub_publisher,
    google_pubsub_topic.reclassification_sweep_trigger,
  ]
}

# Drive access is borrowed from the environment Drive identity, never held by
# this account directly. Bound on the identity itself rather than project-wide
# so the function can mint tokens for that one account only.
resource "google_service_account_iam_member" "reclassification_sweeper_drive_identity_token_creator" {
  service_account_id = var.drive_identity_service_account_name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.reclassification_sweeper.email}"
}

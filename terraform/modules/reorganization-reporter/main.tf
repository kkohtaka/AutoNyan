# Service account for reorganization-reporter function
resource "google_service_account" "reorganization_reporter" {
  account_id   = "${var.environment}-reorg-reporter"
  display_name = "Reorganization Reporter Service Account (${var.environment})"
  description  = "Service account for reorganization-reporter Cloud Function"
}

# IAM binding for Firestore access. The reporter reads the recorded
# re-organization outcomes and marks them as reported, so document-level access
# is enough — it never administers the database itself.
resource "google_project_iam_member" "reorganization_reporter_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.reorganization_reporter.email}"
}

# IAM binding for PubSub publisher (to publish summary notifications)
resource "google_project_iam_member" "reorganization_reporter_pubsub_publisher" {
  project = var.project_id
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${google_service_account.reorganization_reporter.email}"
}

# PubSub topic driven by the Cloud Scheduler job
resource "google_pubsub_topic" "reorganization_report_trigger" {
  name = "${var.environment}-reorganization-report-trigger"
}

# Source code archive for the function
resource "google_storage_bucket_object" "reorganization_reporter_zip" {
  name   = "reorganization-reporter.zip"
  bucket = var.function_bucket_name
  source = "../dist/functions/reorganization-reporter.zip"
}

# Cloud Function that reports finished re-organization batches. It holds no
# Drive access: the folder a summary concerns travels on the notification, and
# the dispatcher resolves the recipients from it.
resource "google_cloudfunctions2_function" "reorganization_reporter" {
  name        = "${var.environment}-reorganization-reporter"
  location    = var.region
  description = "Publish one summary notification per folder for each finished re-organization batch (${var.environment})"

  build_config {
    runtime     = "nodejs24"
    entry_point = "reorganizationReporter"
    source {
      storage_source {
        bucket     = var.function_bucket_name
        object     = google_storage_bucket_object.reorganization_reporter_zip.name
        generation = google_storage_bucket_object.reorganization_reporter_zip.generation
      }
    }
  }

  service_config {
    # Single instance on purpose: two runs at once would both read the same
    # not-yet-marked outcomes and publish every summary twice.
    max_instance_count = 1
    min_instance_count = 0
    available_memory   = "256Mi"
    timeout_seconds    = 300
    environment_variables = {
      PROJECT_ID            = var.project_id
      ENVIRONMENT           = var.environment
      FIRESTORE_DATABASE_ID = var.environment
      NOTIFICATION_TOPIC    = var.notification_topic_name
    }
    service_account_email = google_service_account.reorganization_reporter.email
  }

  event_trigger {
    trigger_region = var.region
    event_type     = "google.cloud.pubsub.topic.v1.messagePublished"
    pubsub_topic   = google_pubsub_topic.reorganization_report_trigger.id
    retry_policy   = "RETRY_POLICY_RETRY"
  }

  depends_on = [
    google_project_iam_member.reorganization_reporter_firestore,
    google_project_iam_member.reorganization_reporter_pubsub_publisher,
    google_pubsub_topic.reorganization_report_trigger,
  ]
}

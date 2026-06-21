# Service account for notification-dispatcher function
resource "google_service_account" "notification_dispatcher" {
  account_id   = "${var.environment}-notif-dispatcher"
  display_name = "Notification Dispatcher Service Account (${var.environment})"
  description  = "Service account for notification-dispatcher Cloud Function"
}

# IAM binding for Google API service usage
resource "google_project_iam_member" "notification_dispatcher_service_usage" {
  project = var.project_id
  role    = "roles/serviceusage.serviceUsageConsumer"
  member  = "serviceAccount:${google_service_account.notification_dispatcher.email}"
}

# IAM binding for Secret Manager access to read the service account key
resource "google_project_iam_member" "notification_dispatcher_secret_accessor" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.notification_dispatcher.email}"
}

# Generate a service account key used for Gmail Domain-Wide Delegation
resource "google_service_account_key" "notification_dispatcher_key" {
  service_account_id = google_service_account.notification_dispatcher.name
}

# Store the service account key JSON in Secret Manager for secure runtime access
resource "google_secret_manager_secret" "notification_sa_key" {
  secret_id = "${var.environment}-notification-sa-key"

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "notification_sa_key" {
  secret      = google_secret_manager_secret.notification_sa_key.id
  secret_data = base64decode(google_service_account_key.notification_dispatcher_key.private_key)
}

# PubSub topic for notification messages
resource "google_pubsub_topic" "notification_trigger" {
  name = "${var.environment}-notification-trigger"
}

# Source code archive for the function
resource "google_storage_bucket_object" "notification_dispatcher_zip" {
  name   = "notification-dispatcher.zip"
  bucket = var.function_bucket_name
  source = "../dist/functions/notification-dispatcher.zip"
}

# Cloud Function for dispatching notifications
resource "google_cloudfunctions2_function" "notification_dispatcher" {
  name        = "${var.environment}-notification-dispatcher"
  location    = var.region
  description = "Dispatch email notifications on document processing success and failure (${var.environment})"

  build_config {
    runtime     = "nodejs20"
    entry_point = "notificationDispatcher"
    source {
      storage_source {
        bucket     = var.function_bucket_name
        object     = google_storage_bucket_object.notification_dispatcher_zip.name
        generation = google_storage_bucket_object.notification_dispatcher_zip.generation
      }
    }
  }

  service_config {
    max_instance_count    = 5
    min_instance_count    = 0
    available_memory      = "256Mi"
    timeout_seconds       = 60
    service_account_email = google_service_account.notification_dispatcher.email
    environment_variables = {
      PROJECT_ID              = var.project_id
      ENVIRONMENT             = var.environment
      NOTIFICATION_FROM_EMAIL = var.notification_from_email
    }
    secret_environment_variables {
      key        = "NOTIFICATION_SA_KEY"
      project_id = var.project_id
      secret     = google_secret_manager_secret.notification_sa_key.secret_id
      version    = "latest"
    }
  }

  event_trigger {
    trigger_region = var.region
    event_type     = "google.cloud.pubsub.topic.v1.messagePublished"
    pubsub_topic   = google_pubsub_topic.notification_trigger.id
    retry_policy   = "RETRY_POLICY_RETRY"
  }

  depends_on = [
    google_project_iam_member.notification_dispatcher_service_usage,
    google_pubsub_topic.notification_trigger,
    google_secret_manager_secret_version.notification_sa_key,
  ]
}

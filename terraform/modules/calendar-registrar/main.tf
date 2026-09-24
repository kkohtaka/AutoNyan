# Service account for calendar-registrar function
resource "google_service_account" "calendar_registrar" {
  account_id   = "${var.environment}-calendar-registrar"
  display_name = "Calendar Registrar Service Account (${var.environment})"
  description  = "Service account for calendar-registrar Cloud Function"
}

# IAM binding for Firestore access (audit records of registered events)
resource "google_project_iam_member" "calendar_registrar_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.calendar_registrar.email}"
}

# IAM binding for Vertex AI (Gemini API) access
resource "google_project_iam_member" "calendar_registrar_vertex_ai" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.calendar_registrar.email}"
}

# Read access to the stored source files, which Gemini reads for the layout the
# OCR text loses
resource "google_storage_bucket_iam_member" "calendar_registrar_document_storage" {
  bucket = var.document_storage_bucket_name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.calendar_registrar.email}"
}

# IAM binding for PubSub publisher (to publish notifications)
resource "google_project_iam_member" "calendar_registrar_pubsub_publisher" {
  project = var.project_id
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${google_service_account.calendar_registrar.email}"
}

# The Calendar API bills against this project, which requires the caller to be
# allowed to consume the project's service quota.
resource "google_project_iam_member" "calendar_registrar_service_usage" {
  project = var.project_id
  role    = "roles/serviceusage.serviceUsageConsumer"
  member  = "serviceAccount:${google_service_account.calendar_registrar.email}"
}

# PubSub topic for calendar registration trigger
resource "google_pubsub_topic" "calendar_registration_trigger" {
  name = "${var.environment}-calendar-registration-trigger"
}

# Source code archive for the function
resource "google_storage_bucket_object" "calendar_registrar_zip" {
  name   = "calendar-registrar.zip"
  bucket = var.function_bucket_name
  source = "../dist/functions/calendar-registrar.zip"
}

# Cloud Function for registering document events on Google Calendar
resource "google_cloudfunctions2_function" "calendar_registrar" {
  name        = "${var.environment}-calendar-registrar"
  location    = var.region
  description = "Extract events from documents in watched Drive folders and register them on Google Calendar (${var.environment})"

  build_config {
    runtime     = "nodejs24"
    entry_point = "calendarRegistrar"
    source {
      storage_source {
        bucket     = var.function_bucket_name
        object     = google_storage_bucket_object.calendar_registrar_zip.name
        generation = google_storage_bucket_object.calendar_registrar_zip.generation
      }
    }
  }

  service_config {
    max_instance_count = 10
    min_instance_count = 0
    available_memory   = "512Mi"
    # A monthly newsletter can hold dozens of events, each one an individual
    # Calendar insert, so this stage runs longer than the other AI stages.
    timeout_seconds = 540
    environment_variables = {
      PROJECT_ID  = var.project_id
      ENVIRONMENT = var.environment
      # The single place the category-to-calendar mapping is declared; upstream
      # stages stay unaware of calendars.
      CALENDAR_CATEGORY_CALENDARS                  = jsonencode(var.category_calendars)
      CALENDAR_TIME_ZONE                           = var.time_zone
      CALENDAR_DEFAULT_EVENT_DURATION_MINUTES      = var.default_event_duration_minutes
      CALENDAR_CLASSIFICATION_CONFIDENCE_THRESHOLD = var.classification_confidence_threshold
      VERTEX_AI_LOCATION                           = var.region
      FIRESTORE_DATABASE_ID                        = var.environment
      NOTIFICATION_TOPIC                           = var.notification_topic_name
    }
    service_account_email = google_service_account.calendar_registrar.email
  }

  event_trigger {
    trigger_region = var.region
    event_type     = "google.cloud.pubsub.topic.v1.messagePublished"
    pubsub_topic   = google_pubsub_topic.calendar_registration_trigger.id
    retry_policy   = "RETRY_POLICY_RETRY"
  }

  depends_on = [
    google_project_iam_member.calendar_registrar_firestore,
    google_project_iam_member.calendar_registrar_vertex_ai,
    google_storage_bucket_iam_member.calendar_registrar_document_storage,
    google_project_iam_member.calendar_registrar_pubsub_publisher,
    google_project_iam_member.calendar_registrar_service_usage,
    google_pubsub_topic.calendar_registration_trigger,
  ]
}

output "service_account_email" {
  description = "Email of the calendar-registrar service account"
  value       = google_service_account.calendar_registrar.email
}

output "function_name" {
  description = "Name of the calendar-registrar function"
  value       = google_cloudfunctions2_function.calendar_registrar.name
}

output "topic_name" {
  description = "Name of the calendar registration trigger PubSub topic"
  value       = google_pubsub_topic.calendar_registration_trigger.name
}

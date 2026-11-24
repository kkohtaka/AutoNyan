output "service_account_email" {
  description = "Email of the reorganization-reporter service account"
  value       = google_service_account.reorganization_reporter.email
}

output "function_name" {
  description = "Name of the reorganization-reporter function"
  value       = google_cloudfunctions2_function.reorganization_reporter.name
}

output "topic_name" {
  description = "Name of the re-organization report trigger PubSub topic"
  value       = google_pubsub_topic.reorganization_report_trigger.name
}

output "topic_id" {
  description = "ID of the re-organization report trigger PubSub topic"
  value       = google_pubsub_topic.reorganization_report_trigger.id
}

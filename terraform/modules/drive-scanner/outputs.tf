output "service_account_email" {
  description = "Email of the drive scanner service account that needs Drive folder access"
  value       = google_service_account.drive_scanner_sa.email
}

output "function_name" {
  description = "Name of the deployed drive scanner function"
  value       = google_cloudfunctions2_function.drive_scanner.name
}

output "function_url" {
  description = "URL of the deployed drive scanner function"
  value       = google_cloudfunctions2_function.drive_scanner.service_config[0].uri
}

output "topic_name" {
  description = "Name of the drive scan trigger PubSub topic"
  value       = google_pubsub_topic.drive_scan_trigger.name
}

output "topic_id" {
  description = "Full resource ID of the drive scan trigger PubSub topic"
  value       = google_pubsub_topic.drive_scan_trigger.id
}
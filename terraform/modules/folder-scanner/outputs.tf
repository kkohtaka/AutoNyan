output "service_account_email" {
  description = "Email of the folder scanner service account that needs Drive folder access"
  value       = google_service_account.folder_scanner_sa.email
}

output "function_name" {
  description = "Name of the deployed folder scanner function"
  value       = google_cloudfunctions2_function.folder_scanner.name
}

output "function_url" {
  description = "URL of the deployed folder scanner function"
  value       = google_cloudfunctions2_function.folder_scanner.service_config[0].uri
}

output "topic_name" {
  description = "Name of the folder scan trigger PubSub topic"
  value       = google_pubsub_topic.folder_scan_trigger.name
}

output "topic_id" {
  description = "Full resource ID of the folder scan trigger PubSub topic"
  value       = google_pubsub_topic.folder_scan_trigger.id
}
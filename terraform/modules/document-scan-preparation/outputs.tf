output "service_account_email" {
  description = "Email of the document scan preparation service account that needs Drive folder access"
  value       = google_service_account.document_scan_preparation_sa.email
}

output "function_name" {
  description = "Name of the deployed document scan preparation function"
  value       = google_cloudfunctions2_function.document_scan_preparation.name
}

output "function_url" {
  description = "URL of the deployed document scan preparation function"
  value       = google_cloudfunctions2_function.document_scan_preparation.service_config[0].uri
}

output "topic_name" {
  description = "Name of the document scan preparation PubSub topic"
  value       = google_pubsub_topic.document_scan_preparation.name
}

output "topic_id" {
  description = "Full resource ID of the document scan preparation PubSub topic"
  value       = google_pubsub_topic.document_scan_preparation.id
}
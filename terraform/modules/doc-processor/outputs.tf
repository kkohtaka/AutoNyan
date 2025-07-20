output "service_account_email" {
  description = "Email of the document processor service account that needs Drive folder access"
  value       = google_service_account.doc_processor_sa.email
}

output "function_name" {
  description = "Name of the deployed document processor function"
  value       = google_cloudfunctions2_function.doc_processor.name
}

output "function_url" {
  description = "URL of the deployed document processor function"
  value       = google_cloudfunctions2_function.doc_processor.service_config[0].uri
}

output "topic_name" {
  description = "Name of the document process trigger PubSub topic"
  value       = google_pubsub_topic.doc_process_trigger.name
}

output "topic_id" {
  description = "Full resource ID of the document process trigger PubSub topic"
  value       = google_pubsub_topic.doc_process_trigger.id
}
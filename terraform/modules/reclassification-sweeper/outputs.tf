output "service_account_email" {
  description = "Email of the reclassification-sweeper service account"
  value       = google_service_account.reclassification_sweeper.email
}

output "function_name" {
  description = "Name of the reclassification-sweeper function"
  value       = google_cloudfunctions2_function.reclassification_sweeper.name
}

output "topic_name" {
  description = "Name of the re-classification sweep trigger PubSub topic"
  value       = google_pubsub_topic.reclassification_sweep_trigger.name
}

output "topic_id" {
  description = "ID of the re-classification sweep trigger PubSub topic"
  value       = google_pubsub_topic.reclassification_sweep_trigger.id
}

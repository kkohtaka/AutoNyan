output "topic_name" {
  description = "Name of the notification trigger PubSub topic"
  value       = google_pubsub_topic.notification_trigger.name
}

output "service_account_email" {
  description = "Email of the notification dispatcher service account"
  value       = google_service_account.notification_dispatcher.email
}

output "service_account_client_id" {
  description = "OAuth2 client ID of the notification dispatcher service account (used for Domain-Wide Delegation setup in Workspace Admin Console)"
  value       = google_service_account.notification_dispatcher.unique_id
}

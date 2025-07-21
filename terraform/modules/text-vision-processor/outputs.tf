output "service_account_email" {
  description = "Email of the text-vision-processor service account"
  value       = google_service_account.text_vision_processor.email
}

output "function_name" {
  description = "Name of the text-vision-processor function"
  value       = google_cloudfunctions2_function.text_vision_processor.name
}
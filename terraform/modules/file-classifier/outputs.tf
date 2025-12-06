output "service_account_email" {
  description = "Email of the file-classifier service account"
  value       = google_service_account.file_classifier.email
}

output "function_name" {
  description = "Name of the file-classifier function"
  value       = google_cloudfunctions2_function.file_classifier.name
}

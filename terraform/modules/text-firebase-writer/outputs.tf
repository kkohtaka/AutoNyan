output "service_account_email" {
  description = "Email of the text-firebase-writer service account"
  value       = google_service_account.text_firebase_writer.email
}

output "function_name" {
  description = "Name of the text-firebase-writer function"
  value       = google_cloudfunctions2_function.text_firebase_writer.name
}
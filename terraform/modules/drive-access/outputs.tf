output "writer_service_account_email" {
  description = "Email of the Drive writer identity; share the Drive folders with it as writer"
  value       = google_service_account.drive_writer.email
}

output "writer_service_account_name" {
  description = "Full resource name of the Drive writer identity, for token-creator bindings on it"
  value       = google_service_account.drive_writer.name
}

output "organizer_service_account_email" {
  description = "Email of the Drive organizer identity; share the Drive folders with it as fileOrganizer"
  value       = google_service_account.drive_organizer.email
}

output "organizer_service_account_name" {
  description = "Full resource name of the Drive organizer identity, for token-creator bindings on it"
  value       = google_service_account.drive_organizer.name
}

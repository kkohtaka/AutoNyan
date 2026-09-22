output "service_account_email" {
  description = "Email of the service account that needs Drive folder access"
  value       = module.drive_scanner.service_account_email
}

output "doc_processor_service_account_email" {
  description = "Email of the document processor service account that needs Drive folder access"
  value       = module.doc_processor.service_account_email
}

output "drive_writer_service_account_email" {
  description = "Email of the environment Drive writer identity; the sharing script grants it writer on the Drive folders"
  value       = module.drive_access.writer_service_account_email
}

output "drive_organizer_service_account_email" {
  description = "Email of the environment Drive organizer identity; the sharing script grants it fileOrganizer on the Drive folders"
  value       = module.drive_access.organizer_service_account_email
}

output "drive_scan_trigger_topic" {
  description = "PubSub topic for drive scanner trigger"
  value       = module.drive_scanner.topic_name
}

output "doc_process_trigger_topic" {
  description = "PubSub topic for document processing trigger"
  value       = module.doc_processor.topic_name
}

output "document_storage_bucket" {
  description = "Cloud Storage bucket for document data"
  value       = google_storage_bucket.document_storage.name
}

output "vision_results_bucket" {
  description = "Cloud Storage bucket for Vision API results"
  value       = google_storage_bucket.vision_results.name
}

output "text_vision_processor_service_account_email" {
  description = "Email of the text vision processor service account"
  value       = module.text_vision_processor.service_account_email
}

output "text_firebase_writer_service_account_email" {
  description = "Email of the text firebase writer service account"
  value       = module.text_firebase_writer.service_account_email
}

output "file_classifier_service_account_email" {
  description = "Email of the file classifier service account"
  value       = module.file_classifier.service_account_email
}

output "calendar_registrar_service_account_email" {
  description = "Email of the calendar registrar service account; share each target calendar with it"
  value       = module.calendar_registrar.service_account_email
}

output "reclassification_sweeper_service_account_email" {
  description = "Email of the reclassification-sweeper service account"
  value       = module.reclassification_sweeper.service_account_email
}

output "notification_dispatcher_service_account_email" {
  description = "Email of the notification dispatcher service account"
  value       = module.notification_dispatcher.service_account_email
}

output "notification_dispatcher_service_account_client_id" {
  description = "OAuth2 client ID for Domain-Wide Delegation setup in Google Workspace Admin Console"
  value       = module.notification_dispatcher.service_account_client_id
}

output "drive_folder_setup_instructions" {
  description = "Instructions for granting Google Drive access through manual sharing"
  value       = <<-EOT
    IMPORTANT: Google Drive access is granted through MANUAL SHARING only.
    Drive API roles cannot be assigned at the project level.

    Sharing is an environment bootstrap step, done once per environment, not a
    per-deployment step: functions borrow one of the two identities below
    instead of holding Drive access on their own service accounts.

    STEP 1 - Share the scanned, category root, and uncategorized folders:
      npm run setup:share-drive-folders

    Or share them by hand from Google Drive (right-click the folder > Share):
      - Contributor (writer):        ${module.drive_access.writer_service_account_email}
      - Content manager (organizer): ${module.drive_access.organizer_service_account_email}

    STEP 2 - Configure folder IDs in terraform/environments/<environment>.tfvars:
      drive_folder_id         = "FOLDER_ID_FROM_URL"
      category_root_folder_id = "FOLDER_ID_FROM_URL"
      uncategorized_folder_id = "FOLDER_ID_FROM_URL"

    Get a folder ID from its URL:
      https://drive.google.com/drive/folders/FOLDER_ID_HERE
  EOT
}

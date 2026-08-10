output "service_account_email" {
  description = "Email of the service account that needs Drive folder access"
  value       = module.drive_scanner.service_account_email
}

output "doc_processor_service_account_email" {
  description = "Email of the document processor service account that needs Drive folder access"
  value       = module.doc_processor.service_account_email
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

    Required Setup Steps:

    STEP 1 - Share Your Drive/Folders:
    1. Open Google Drive (https://drive.google.com)
    2. To grant access to entire Drive:
       - Right-click "My Drive" and select "Share"
    3. To grant access to specific folders:
       - Right-click the folder(s) and select "Share"
    4. Add these emails as editors:
       - Drive Scanner: ${module.drive_scanner.service_account_email}
       - Document Processor: ${module.doc_processor.service_account_email}
       - File Classifier: ${module.file_classifier.service_account_email}
    5. Set permission level to "Editor"
    6. Click "Send"

    STEP 2 - Configure Folder ID:
    Set drive_folder_id in terraform.tfvars:
    - For entire Drive: drive_folder_id = "root"
    - For specific folder: drive_folder_id = "FOLDER_ID_FROM_URL"

    Permissions: Once shared, the service account can:
    ✅ List files and folders (in shared areas only)
    ✅ Create new folders (in shared areas only)
    ✅ Move files between folders (within shared areas)
    ✅ Copy files (within shared areas)
    ✅ Read file metadata
    ❌ Access unshared folders
    ❌ Delete files or folders
    ❌ Manage sharing permissions

    Get folder ID from URLs like:
    https://drive.google.com/drive/folders/FOLDER_ID_HERE
  EOT
}

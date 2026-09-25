variable "project_id" {
  description = "The GCP project ID"
  type        = string
}

variable "environment" {
  description = "Deployment environment (staging or production)"
  type        = string
}

variable "region" {
  description = "The GCP region for resources"
  type        = string
}

variable "function_bucket_name" {
  description = "The name of the bucket containing function source code"
  type        = string
}

variable "category_root_folder_id" {
  description = "Google Drive folder ID containing category subfolders"
  type        = string
}

variable "uncategorized_folder_id" {
  description = "Google Drive folder ID for uncategorized files"
  type        = string
}

variable "file_classifier_trigger_topic" {
  description = "Name of the PubSub topic that triggers the file classifier"
  type        = string
}

variable "drive_identity_service_account_name" {
  description = "Full resource name of the environment Drive identity this function impersonates for Drive API calls"
  type        = string
}

variable "drive_identity_service_account_email" {
  description = "Email of the environment Drive identity this function impersonates; exposed to the function as DRIVE_IDENTITY_EMAIL"
  type        = string
}

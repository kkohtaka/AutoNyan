variable "project_id" {
  description = "The GCP project ID"
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

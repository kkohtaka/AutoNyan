variable "project_id" {
  description = "The Google Cloud project ID"
  type        = string
}

variable "environment" {
  description = "Deployment environment (staging or production)"
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "Environment must be either 'staging' or 'production'."
  }
}

variable "region" {
  description = "The Google Cloud region"
  type        = string
  default     = "us-central1"
}

variable "drive_folder_id" {
  description = "The Google Drive folder ID to scan for documents"
  type        = string
}

variable "drive_scanner_schedule" {
  description = "Cron schedule for the drive document scanner (e.g., '0 * * * *' for every hour)"
  type        = string
  default     = "0 * * * *"
}

variable "category_root_folder_id" {
  description = "Google Drive folder ID containing category subfolders for file classification"
  type        = string
}

variable "uncategorized_folder_id" {
  description = "Google Drive folder ID for uncategorized files"
  type        = string
} 
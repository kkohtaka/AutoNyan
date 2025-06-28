variable "project_id" {
  description = "The Google Cloud project ID"
  type        = string
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
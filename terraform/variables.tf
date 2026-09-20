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

variable "reclassification_sweep_schedule" {
  description = "Cron schedule for the re-classification sweep of the Uncategorized folder"
  type        = string
  default     = "30 * * * *"
}

variable "category_root_folder_id" {
  description = "Google Drive folder ID containing category subfolders for file classification"
  type        = string
}

variable "uncategorized_folder_id" {
  description = "Google Drive folder ID for uncategorized files"
  type        = string
}

variable "billing_account_id" {
  description = "Cloud Billing account ID (format: XXXXXX-XXXXXX-XXXXXX) used to create the cost budget"
  type        = string
}

variable "budget_amount" {
  description = "Monthly budget amount, in whole units of the billing account's own currency (the budget inherits that currency automatically), that triggers cost alerts"
  type        = number
  default     = 10000
}

variable "budget_alert_thresholds" {
  description = "Spend thresholds (as fractions of the budget amount) at which to send alerts"
  type        = list(number)
  default     = [0.5, 0.9, 1.0]
}

variable "notification_from_email" {
  description = "Google Workspace email address to send notifications from (must be authorized for Domain-Wide Delegation)"
  type        = string
}

variable "email_subject_prefix" {
  description = "Subject prefix for notification emails. Empty selects the per-environment default below"
  type        = string
  default     = ""
}

variable "calendar_category_calendars" {
  description = "Classification categories whose documents produce calendar events, and the calendar each one registers on. Empty disables calendar registration"
  type = list(object({
    category    = string
    calendar_id = string
  }))
  default = []
}

variable "calendar_classification_confidence_threshold" {
  description = "Minimum classification confidence for a document to register calendar events. Events are never updated or deleted, so a misclassification has to be undone by hand"
  type        = number
  default     = 0.7
}

variable "calendar_time_zone" {
  description = "IANA time zone the watched documents' dates and times are written in"
  type        = string
  default     = "Asia/Tokyo"
}

variable "calendar_default_event_duration_minutes" {
  description = "Length given to a timed calendar event whose source document stated no end time"
  type        = number
  default     = 60
}

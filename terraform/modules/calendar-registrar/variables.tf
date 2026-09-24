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

variable "document_storage_bucket_name" {
  description = "The name of the bucket holding the source documents"
  type        = string
}

variable "category_calendars" {
  description = "Classification categories whose documents produce calendar events, and the calendar each one registers on"
  type = list(object({
    category    = string
    calendar_id = string
  }))
  default = []
}

variable "classification_confidence_threshold" {
  description = "Minimum classification confidence for a document to register calendar events"
  type        = number
}

variable "time_zone" {
  description = "IANA time zone the source documents' dates and times are written in"
  type        = string
}

variable "default_event_duration_minutes" {
  description = "Length given to a timed event whose source document stated no end time"
  type        = number
}

variable "notification_topic_name" {
  description = "Name of the PubSub topic for notification messages"
  type        = string
}

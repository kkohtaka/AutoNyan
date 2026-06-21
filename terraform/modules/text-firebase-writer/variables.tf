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

variable "vision_results_bucket_name" {
  description = "The name of the bucket containing Vision API results"
  type        = string
}

variable "document_storage_bucket_name" {
  description = "The name of the document storage bucket for file size lookup"
  type        = string
}

variable "file_classifier_trigger_topic" {
  description = "The name of the PubSub topic to trigger file classification"
  type        = string
}

variable "notification_topic_name" {
  description = "Name of the PubSub topic for notification messages"
  type        = string
}
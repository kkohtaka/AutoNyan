variable "project_id" {
  description = "Google Cloud project ID"
  type        = string
}

variable "environment" {
  description = "Deployment environment (staging or production)"
  type        = string
}

variable "region" {
  description = "Google Cloud region for function deployment"
  type        = string
}

variable "function_bucket_name" {
  description = "Name of the Cloud Storage bucket containing function source code"
  type        = string
}


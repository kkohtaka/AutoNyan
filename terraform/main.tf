terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 4.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# Cloud Run Function v2 for hello world
resource "google_cloudfunctions2_function" "hello_world" {
  name        = "hello-world"
  description = "A simple hello world function"
  location    = var.region

  build_config {
    runtime     = "nodejs20"
    entry_point = "helloWorld"
    source {
      storage_source {
        bucket = google_storage_bucket.function_bucket.name
        object = google_storage_bucket_object.function_zip.name
      }
    }
  }

  service_config {
    max_instance_count = 100
    min_instance_count = 0
    available_memory   = "256M"
    timeout_seconds    = 60
    environment_variables = {
      NODE_ENV = "production"
    }
  }
}

# IAM policy for the function
resource "google_cloudfunctions2_function_iam_member" "invoker" {
  project        = google_cloudfunctions2_function.hello_world.project
  location       = google_cloudfunctions2_function.hello_world.location
  cloud_function = google_cloudfunctions2_function.hello_world.name
  role           = "roles/cloudfunctions.invoker"
  member         = "allUsers"  # Public access. Change this based on your security requirements
}

# Storage bucket for function source code
resource "google_storage_bucket" "function_bucket" {
  name     = "${var.project_id}-function-source"
  location = var.region
  uniform_bucket_level_access = true
}

# Zip the function source code
resource "google_storage_bucket_object" "function_zip" {
  name   = "function-source.zip"
  bucket = google_storage_bucket.function_bucket.name
  source = "../dist/functions/hello.zip"  # This will be created by the build script
} 
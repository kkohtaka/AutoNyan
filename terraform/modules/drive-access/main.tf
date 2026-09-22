# Environment-scoped Drive identities.
#
# Drive folder permissions cannot be expressed in Terraform, so they are granted
# once per environment to these two accounts at bootstrap
# (npm run setup:share-drive-folders). Functions never hold Drive access on
# their own runtime account: each borrows one of these identities through a
# roles/iam.serviceAccountTokenCreator binding declared in its own module, which
# Terraform owns. The two accounts map to the only two Drive roles the pipeline
# uses on the shared drive: writer (edit) and fileOrganizer (move / trash).
resource "google_service_account" "drive_writer" {
  account_id   = "${var.environment}-drive-writer-sa"
  display_name = "Drive Writer Identity (${var.environment})"
  description  = "Shared on the Drive folders as writer; impersonated by functions that read and copy documents"
}

resource "google_service_account" "drive_organizer" {
  account_id   = "${var.environment}-drive-organizer-sa"
  display_name = "Drive Organizer Identity (${var.environment})"
  description  = "Shared on the Drive folders as fileOrganizer; impersonated by functions that move or trash documents"
}

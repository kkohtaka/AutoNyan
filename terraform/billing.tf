# Cost guardrail: budget alerts for the project.
#
# The event-driven pipeline scales with the number of files in the watched Drive
# folder. A third party with edit access to a shared folder can add many files,
# and max_instance_count only caps throughput, not total spend. A budget does not
# stop spending by itself, but it surfaces runaway cost early via the billing
# account's default alert emails (sent to billing administrators) at each
# threshold below.

# Enable the Cloud Billing Budget API required to manage budgets via Terraform.
resource "google_project_service" "billingbudgets_api" {
  service = "billingbudgets.googleapis.com"

  disable_on_destroy = false
}

# Resolve the project number, required by the budget filter (projects/<number>).
data "google_project" "current" {
  project_id = var.project_id
}

# Monthly cost budget scoped to this project.
# Notifications use the billing account's default behavior (emails to billing
# admins) — no all_updates_rule / notification channel is configured.
resource "google_billing_budget" "monthly_budget" {
  billing_account = var.billing_account_id
  display_name    = "${var.environment}-autonyan-monthly-budget"

  budget_filter {
    projects = ["projects/${data.google_project.current.number}"]
  }

  amount {
    specified_amount {
      # currency_code is intentionally omitted: the Cloud Billing Budgets API
      # requires it to match the billing account's currency, and rejects any
      # mismatch with "Error 400: invalid argument". Omitting it makes the API
      # default to the billing account's own currency, so this stays correct
      # regardless of which account (and currency) the project is linked to.
      units = tostring(var.budget_amount)
    }
  }

  # Alert thresholds as a fraction of the budgeted amount.
  dynamic "threshold_rules" {
    for_each = var.budget_alert_thresholds
    content {
      threshold_percent = threshold_rules.value
    }
  }

  depends_on = [google_project_service.billingbudgets_api]
}

---
name: debug-function-logs
description: Triage a deployed Cloud Function by reading its logs — with gcloud in the devcontainer, or through the Cloud Logging MCP server in a cloud session — and mapping the findings to the common debugging scenarios (timeout, permission error, event not triggering, module not found)
argument-hint: "[function-name] [environment]"
disable-model-invocation: false
allowed-tools: Bash(gcloud *) mcp__logging
---

# Debug Function Logs

Read-only runtime triage for a deployed Cloud Function. It reads recent and
error-level logs and maps what it finds to the four documented debugging
scenarios in `CLAUDE.md`. It does not edit code, Terraform, or any cloud
resource — diagnosis only; any resulting fix goes through the normal infra/code
change workflow. It complements `debug-ci` (CI-side failures) by covering
runtime/cloud-side failures.

Logs are reachable two ways (CONVENTIONS.md §4.8). The devcontainer has
`gcloud`. A cloud session has neither `gcloud` nor a Google Cloud credential —
by design, since a cloud environment has no secrets store
(`REMOTE_SESSION_SETUP.md` §1) — and reads the same log entries through the
Cloud Logging MCP server, which authenticates with OAuth and IAM rather than a
key. Only the fetch differs: Step 4's mapping from evidence to failure mode is
the point of this skill and is applied identically either way.

## Context

**Log access mode:**

```
!`command -v gcloud >/dev/null 2>&1 && echo "gcloud available" || echo "gcloud unavailable — use the Cloud Logging MCP server"`
```

**Active gcloud project and account (gcloud route only):**

```
!`command -v gcloud >/dev/null 2>&1 && { gcloud config get-value project 2>/dev/null; gcloud config get-value account 2>/dev/null; } || echo "n/a"`
```

**Deployed Cloud Functions (gcloud route only — to resolve the target name and region):**

```
!`command -v gcloud >/dev/null 2>&1 && gcloud functions list --format="table(name,state,environment,region)" 2>/dev/null || echo "n/a — resolve the function name from its naming convention (see Step 1)"`
```

**Terraform region default (a starting guess when the region is not known):**

```
!`grep -A4 'variable "region"' terraform/variables.tf 2>/dev/null | grep default || echo "unknown"`
```

## Your Task

Follow these steps in order. Stop and ask the user if anything is unclear.

### Step 0 — Confirm the MCP route is usable

Skip this step on the `gcloud` route.

The Cloud Logging MCP server needs setup that no pull request can deliver, so
check it is there before reading anything, and name what is missing rather than
letting a tool call fail opaquely:

- The Cloud Logging MCP server (`https://logging.googleapis.com/mcp`) is added
  as a custom connector and enabled for this session.
- The account has `roles/mcp.toolUser` plus a read-only logging role on the
  target project.

`REMOTE_SESSION_SETUP.md` §4 tracks this setup and #395 carries the checklist.
If the connector is absent, say exactly that and stop — the missing piece is
configuration, not something to work around by guessing at log contents.

You also need the **project id**, which a cloud session cannot discover from the
repository: `project_id` has no default in `terraform/variables.tf` and its value
lives in the gitignored `terraform/environments/*.tfvars`. Ask the user for it
rather than inferring one.

### Step 1 — Resolve the target function, region, and environment

From `$ARGUMENTS`, determine the function name, its region, and the environment.
Functions are named `{environment}-{stage}` (e.g. `staging-drive-scanner`).

On the `gcloud` route, use the function list in Context to narrow it down. On the
MCP route there is no function list — derive the name from the convention above
and the workspace directories under `src/functions/`, and take the region from
the Terraform default in Context. Confirm both with the user before reading logs
if either is ambiguous; querying the wrong resource returns an empty result that
looks like a healthy function.

### Step 2 — Read recent logs

- **`gcloud` available** — the devcontainer:

  ```bash
  gcloud functions logs read FUNCTION_NAME --region=REGION --limit=50
  ```

- **`gcloud` unavailable** — a cloud session. Query the Cloud Logging MCP server
  for the most recent 50 entries for the same function, ordered newest first.
  `gcloud functions logs read` is a wrapper over the same Logging API, so the
  filter it implies is what to express there:

  ```
  resource.labels.function_name="FUNCTION_NAME" OR resource.labels.service_name="FUNCTION_NAME"
  resource.labels.region="REGION" OR resource.labels.location="REGION"
  ```

  Gen2 functions run on Cloud Run underneath, so their entries can carry either
  `resource.type="cloud_function"` or `resource.type="cloud_run_revision"`
  depending on which layer emitted them. Do not filter on one `resource.type`
  alone — a query that returns nothing here means the filter missed, not that the
  function is quiet. Widen it and say so before concluding anything from silence.

The functions log through the shared structured logger (`src/shared/logger.ts`),
which writes one JSON line per entry, so expect a JSON payload with a `severity`
and a `message` field rather than free text.

### Step 3 — Read error-level logs

- **`gcloud` available**:

  ```bash
  gcloud functions logs read FUNCTION_NAME --region=REGION --filter="severity>=ERROR" --limit=50
  ```

  For an actively-failing function you can stream with
  `gcloud functions logs read FUNCTION_NAME --region=REGION --follow`.

- **`gcloud` unavailable**: add `severity>=ERROR` to the Step 2 filter. There is
  no streaming equivalent — re-query instead of waiting on a follow.

### Step 4 — Classify against the common debugging scenarios

Map the log evidence to one of the four scenarios documented in `CLAUDE.md`:

- **Function timeout** — execution exceeds the configured timeout → look at the
  `timeout` in the function's Terraform module.
- **Permission error** — `PERMISSION_DENIED` / IAM errors → look at the service
  account's IAM roles in the function's Terraform module.
- **Event not triggering** — no invocations / trigger errors → look at the event
  trigger (PubSub topic / Storage bucket) configuration and its permissions.
- **Module not found** — `Cannot find module` / build-time resolution errors →
  look at the npm workspace configuration and the build output.

"Event not triggering" is the one diagnosis that rests on an *absence* of log
entries, so it is the one a mistargeted query can fabricate. Before reporting it,
confirm the query was right: that the function name and region resolved in Step 1
are correct, and on the MCP route that the filter was not narrowed to a single
`resource.type`.

### Step 5 — Report the triage

Report honestly (CONVENTIONS.md §4.6):

- Which route read the logs, and the time range covered.
- The key log lines that matter (not a raw dump).
- The single most likely scenario, with the evidence for it.
- The concrete next place to look (Terraform module timeout, service-account IAM
  roles, or trigger config) so the fix can proceed through the normal change
  workflow. This skill does not apply the fix.

If neither route was available, say so plainly and name what is missing — an
absent connector or a missing IAM grant is a setup gap with a known fix, not a
diagnosis about the function.

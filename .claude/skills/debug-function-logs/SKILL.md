---
name: debug-function-logs
description: Triage a deployed Cloud Function by reading its logs with gcloud and mapping the findings to the common debugging scenarios (timeout, permission error, event not triggering, module not found)
argument-hint: "[function-name] [environment]"
disable-model-invocation: false
allowed-tools: Bash(gcloud *)
---

# Debug Function Logs

Read-only runtime triage for a deployed Cloud Function. It reads recent and
error-level logs via the `gcloud functions logs read` patterns in `CLAUDE.md`
and maps what it finds to the four documented debugging scenarios. It does not
edit code, Terraform, or any cloud resource — diagnosis only; any resulting fix
goes through the normal infra/code change workflow. It complements `debug-ci`
(CI-side failures) by covering runtime/cloud-side failures.

## Context

**Active gcloud project and account:**
```
!`gcloud config get-value project 2>/dev/null; gcloud config get-value account 2>/dev/null`
```

**Deployed Cloud Functions (to resolve the target name and region):**
```
!`gcloud functions list --format="table(name,state,environment,region)" 2>/dev/null`
```

## Your Task

Follow these steps in order. Stop and ask the user if anything is unclear.

### Step 1 — Resolve the target function, region, and environment

From `$ARGUMENTS`, determine the function name, its region, and the environment.
Functions are named `{environment}-{stage}` (e.g. `staging-drive-scanner`). If
the name, region, or environment is missing or ambiguous, use the function list
in Context to narrow it down and confirm with the user before reading logs.

### Step 2 — Read recent logs

```bash
gcloud functions logs read FUNCTION_NAME --region=REGION --limit=50
```

### Step 3 — Read error-level logs

```bash
gcloud functions logs read FUNCTION_NAME --region=REGION --filter="severity>=ERROR" --limit=50
```

For an actively-failing function you can stream with
`gcloud functions logs read FUNCTION_NAME --region=REGION --follow`.

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

### Step 5 — Report the triage

Report honestly (CONVENTIONS.md §4.6):

- The key log lines that matter (not a raw dump).
- The single most likely scenario, with the evidence for it.
- The concrete next place to look (Terraform module timeout, service-account IAM
  roles, or trigger config) so the fix can proceed through the normal change
  workflow. This skill does not apply the fix.

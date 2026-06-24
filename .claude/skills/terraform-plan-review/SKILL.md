---
name: terraform-plan-review
description: Run npm run terraform:plan for the current ENVIRONMENT, then review the plan for unexpected resource changes, data-loss risks, and IAM least-privilege violations — reports findings only, never applies
argument-hint: "[staging|production]"
disable-model-invocation: false
allowed-tools: Bash(npm *) Bash(terraform *)
---

# Terraform Plan Review

Formalizes the "Review plan output carefully" step of the Infrastructure Change
Workflow in `CLAUDE.md`. Runs `terraform plan`, categorizes every pending
change, and surfaces three classes of risk: unexpected resource changes,
potential data loss, and IAM that violates least privilege.

This skill **NEVER runs `terraform apply`**. Apply is a separate, explicitly
confirmed action that the user performs after reviewing this report.

## Context

**Target environment (staging by default; override with $ARGUMENTS or ENVIRONMENT):**
```
!`echo "${ENVIRONMENT:-staging}"`
```

**Terraform scripts (from package.json):**
```
!`node -e "const s=require('./package.json').scripts; ['terraform:init','terraform:plan'].forEach(k=>s[k]&&console.log(k+': '+s[k]))"`
```

**Current Terraform workspace directory contents (high level):**
```
!`ls terraform/modules 2>/dev/null && echo '---' && ls terraform/*.tf 2>/dev/null`
```

## Your Task

Follow these steps in order. Stop and ask the user if anything is unclear.

### Step 1 — Confirm the target environment

Determine the environment to plan against:

- If `$ARGUMENTS` is `staging` or `production`, use that.
- Otherwise, use `${ENVIRONMENT:-staging}`.

Set the variable for subsequent steps:

```bash
export ENVIRONMENT="${ARGUMENTS:-${ENVIRONMENT:-staging}}"
echo "Target environment: $ENVIRONMENT"
```

### Step 2 — Ensure the Terraform backend is initialized

Run `terraform:init` with `-reconfigure` so it switches to the correct backend
state file for the selected environment. This is always safe to re-run.

```bash
npm run terraform:init
```

If init fails (e.g. missing backend config file
`terraform/environments/${ENVIRONMENT}.backend.hcl`), stop and report the
error — do not proceed to plan.

### Step 3 — Run the plan and capture output

```bash
npm run terraform:plan 2>&1 | tee /tmp/tf-plan-output.txt
echo "Exit code: $?"
```

`terraform:plan` includes a build step (`npm run build:function`) before
planning — this ensures the function zip artifacts are current. If the build
fails, stop and report the error before proceeding.

If plan exits non-zero, report the error verbatim and stop.

### Step 4 — Categorize pending changes

Parse `/tmp/tf-plan-output.txt` and group every resource change by action:

| Action | Symbol in plan output |
|--------|-----------------------|
| create | `+` / `will be created` |
| update in-place | `~` / `will be updated in-place` |
| replace (destroy+create) | `-/+` / `must be replaced` |
| destroy | `-` / `will be destroyed` |

```bash
grep -E '^\s*(#|[+~\-])' /tmp/tf-plan-output.txt | grep -E '(will be|must be)' || true
```

Present the counts and full resource addresses in a structured table. If the
plan shows "No changes", report that clearly and stop.

### Step 5 — Flag data-loss risks

Inspect every **destroy** (`-`) or **replace** (`-/+`) action for stateful
resources. Stateful resources in this project include:

- `google_storage_bucket.*` — Cloud Storage buckets
- `google_firestore_database.*` — Firestore databases
- `google_firestore_document.*` — Firestore documents
- Any resource whose name contains `bucket`, `firestore`, or `database`

For each stateful resource scheduled for destroy or replace:

1. Report it as a **DATA-LOSS RISK**.
2. Check whether `force_destroy` is set to `true` in the plan output or the
   Terraform source — if it is, note that the bucket/database contents will be
   permanently deleted without a separate confirmation step.
3. Recommend the user verify a backup or confirm the data is expendable before
   applying.

```bash
grep -E '(google_storage_bucket|google_firestore|force_destroy)' /tmp/tf-plan-output.txt || true
```

### Step 6 — Review IAM changes against least-privilege rules

Extract all IAM resource changes from the plan:

```bash
grep -E '(google_.*_iam|google_project_iam|google_storage.*iam|roles/)' /tmp/tf-plan-output.txt || true
```

Apply the following checks from `CLAUDE.md`'s least-privilege rules:

1. **No `roles/compute.*`** — This project has no compute resources. Any
   `roles/compute.*` binding is a violation; flag it as HIGH severity.

2. **Per-function service accounts** — IAM should be bound to individual
   function service accounts (e.g. `*-sa@...`), not a shared account. Flag
   any new binding to a broad or shared account.

3. **Scoped storage access** — Storage IAM should reference specific named
   buckets, not project-level `roles/storage.admin` or `roles/storage.objectAdmin`.
   Flag any project-level storage grant.

4. **New broad project-level roles** — Flag any new `google_project_iam_member`
   binding where the role is broader than strictly needed (e.g. `roles/editor`,
   `roles/owner`, `roles/iam.securityAdmin`).

For each finding, report: resource address, role being granted, member, and
severity (HIGH / MEDIUM / INFO).

### Step 7 — Report a structured summary

Produce a final report with these sections:

```
## Terraform Plan Review — <ENVIRONMENT> — <timestamp>

### Summary
- Environment: <staging|production>
- Resources to create:  <N>
- Resources to update:  <N>
- Resources to replace: <N>
- Resources to destroy: <N>
- No changes: <yes|no>

### Data-Loss Risks
<list each, or "None detected">

### IAM Findings
<list each with severity, or "None detected">

### Unexpected Changes
<list any resource not obviously explained by the current branch diff, or "None detected">

### Recommendation
<SAFE TO APPLY | REVIEW REQUIRED — explain what to check>

---
Note: this review is advisory. `terraform apply` is a separate, explicitly
confirmed action. Run `npm run terraform:apply` only after you have reviewed
all risks above and confirmed with the user.
```

Report failures, skipped steps, and partial results plainly
(CONVENTIONS.md §4.6). If any HIGH-severity finding was detected, set
Recommendation to "REVIEW REQUIRED" regardless of other checks.

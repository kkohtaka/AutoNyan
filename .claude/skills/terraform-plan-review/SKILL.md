---
name: terraform-plan-review
description: Review a staging or production Terraform plan for unexpected resource changes, data-loss risks, and IAM least-privilege violations — planning locally in the devcontainer, or reading the plan a pull request already produced in CI — reports findings only, never applies
argument-hint: "[staging|production] | [pr <number>]"
disable-model-invocation: false
allowed-tools: Bash(npm *) Bash(terraform *) Bash(gh *) mcp__github
---

# Terraform Plan Review

Formalizes the "Review plan output carefully" step of the Infrastructure Change
Workflow in `CLAUDE.md`. Categorizes every pending change and surfaces three
classes of risk: unexpected resource changes, potential data loss, and IAM that
violates least privilege.

This skill **NEVER runs `terraform apply`**. Apply is a separate, explicitly
confirmed action that the user performs after reviewing this report.

The plan can be obtained two ways (CONVENTIONS.md §4.8). The devcontainer runs
`terraform plan` itself. A cloud session has neither the Terraform state
backend nor the gitignored `staging.tfvars` / `staging.backend.hcl`, so it reads
the plan the Terraform Plan (Staging) workflow already produced for a pull
request. Only the way the plan text is obtained differs — Steps 3 to 6 apply the
same criteria to whichever text was produced.

## Context

**Local plan capability (Terraform state access):**

```
!`command -v terraform >/dev/null 2>&1 && test -f "terraform/environments/${ENVIRONMENT:-staging}.backend.hcl" && echo "local plan available" || echo "local plan unavailable — review a pull request's CI plan instead"`
```

**GitHub access mode:**

```
!`command -v gh >/dev/null 2>&1 && echo "gh CLI available" || echo "gh CLI unavailable — use the GitHub MCP tools"`
```

**Target environment (staging by default; override with $ARGUMENTS or ENVIRONMENT):**

```
!`echo "${ENVIRONMENT:-staging}"`
```

**Terraform scripts (from package.json):**

```
!`node -e "const s=require('./package.json').scripts; ['terraform:init','terraform:plan'].forEach(k=>s[k]&&console.log(k+': '+s[k]))" 2>/dev/null || echo "package.json unreadable"`
```

**Current Terraform workspace directory contents (high level):**

```
!`ls terraform/modules 2>/dev/null && echo '---' && ls terraform/*.tf 2>/dev/null`
```

## Your Task

Follow these steps in order. Stop and ask the user if anything is unclear.

### Step 1 — Choose the route and the target

Decide from `$ARGUMENTS` and what the Context reported:

- `$ARGUMENTS` names a pull request (`pr 417`, `#417`, or a PR URL) → **Route B**,
  reviewing that pull request's CI plan. This works in both environments.
- `$ARGUMENTS` is `staging` or `production`, or is empty → **Route A** if the
  Context reported a local plan is available, otherwise **Route B** against the
  pull request for the current branch.

If Route A is unavailable and no pull request can be identified, stop and say so
— do not report a review with no plan behind it (CONVENTIONS.md §4.6).

Route A only: confirm the choice with the user before continuing if the
environment is `production` — a production plan reads real infrastructure state.
Route B always reviews **staging**; the workflow plans no other environment.

### Step 2A — Produce the plan locally (devcontainer)

Skip to Step 2B if you are on Route B.

Run `terraform:init` with `-reconfigure` so it switches to the correct backend
state file for the selected environment. This is always safe to re-run.

```bash
export ENVIRONMENT="${ARGUMENTS:-${ENVIRONMENT:-staging}}"
npm run terraform:init
```

If init fails (e.g. missing backend config file
`terraform/environments/${ENVIRONMENT}.backend.hcl`), stop and report the
error — do not proceed to plan.

```bash
npm run terraform:plan 2>&1 | tee /tmp/tf-plan-output.txt
echo "Exit code: $?"
```

`terraform:plan` includes a build step (`npm run build:function`) before
planning — this ensures the function zip artifacts are current. If the build
fails, stop and report the error before proceeding.

If plan exits non-zero, report the error verbatim and stop. Otherwise carry
`/tmp/tf-plan-output.txt` into Step 3 as the plan text.

### Step 2B — Read the plan a pull request already produced

Resolve the pull request number, then find its most recent **Terraform Plan
(Staging)** workflow run. The plan text is in that run's job log: the workflow
tees `npm run terraform:plan` to the log, and does **not** upload it as an
artifact. Its pull request comment carries only a status line and a link to the
run, so the comment alone is not enough to review — use it to find the run and
to learn the outcome, and read the log for the plan itself.

- **`gh` available** — the devcontainer:

  ```bash
  gh pr view <number> --json headRefName,headRefOid
  gh run list --repo kkohtaka/AutoNyan --workflow terraform-plan.yml --limit 20
  gh run view <run-id> --log | sed -n '/Run Terraform plan/,$p' > /tmp/tf-plan-raw.txt
  ```

- **`gh` unavailable** — a cloud session, using the GitHub MCP tools:
  1. Read the pull request to get its head SHA.
  2. Read the pull request's **check runs** and take the `terraform-plan` one —
     its URL carries the run and job IDs. Do not list the repository's workflow
     runs to find it: that response is hundreds of thousands of characters and
     is rejected for exceeding the token limit before you can read it.
  3. Read that job's logs with the content returned inline and an explicit tail
     large enough to reach the start of the plan — the default tail is far
     shorter than a plan job's log, and truncates the plan mid-way. A tail long
     enough usually exceeds the token limit too; the tool then spools the whole
     response to a file on disk and prints its path, which is the outcome to
     aim for. Write the `logs_content` field of that JSON out to
     `/tmp/tf-plan-raw.txt` rather than reading the log into context.

If neither route is available, stop and say so.

Three outcomes need distinguishing before Step 3, because two of them mean there
is nothing to review:

- **The workflow skipped the plan.** Read this off the pull request comment
  (`⏭️ Terraform Plan (Staging) SKIPPED`) or the `terraform/plan/staging` commit
  status description, **not** off the job's conclusion: the `terraform-plan` job
  self-skips internally and still completes as `success`, so a check-run
  conclusion never says `skipped`. Report exactly that — the pull request
  touches no infrastructure, so no plan exists — and stop. Do not report an
  empty review as if the plan were clean.
- **No run exists for the head SHA at all.** A required-status-check invariant
  failure, not a review finding (`CLAUDE.md`). Say the plan was never reported
  for this commit and that it needs re-dispatching; the owner-only
  `/terraform plan` comment is the manual path. Stop.
- **The plan ran.** Normalize it as below, then carry it into Step 3.

**Normalize the raw text** — only in the third case; in the other two there is
no plan and this check does not apply. Both routes deliver log lines, not plan
lines: every line carries an ISO-8601 timestamp, and `gh` prefixes the job and
step name as well. Steps 3 to 5 anchor their patterns at the start of the line,
so they match **nothing** against un-normalized text — a silent empty review,
which §4.6 forbids. Strip the prefixes into the file those steps read:

```bash
sed -E 's/^([^\t]*\t){0,2}[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z //' \
  /tmp/tf-plan-raw.txt > /tmp/tf-plan-output.txt
grep -c 'will be' /tmp/tf-plan-output.txt
```

A count of 0 here means the normalization did not match — Step 3 would report
an empty review of a plan that has changes. Fix it before continuing. (A plan
that genuinely has no changes says `No changes.` and is Step 3's business.)

State which commit the plan describes, and say so plainly if the pull request
has been pushed to since — a plan read from an older SHA does not describe the
current head. The log itself carries the SHA it planned, in the `prDetails`
JSON the reporting step embeds; compare that against the head SHA rather than
trusting that the newest run belongs to the current head.

### Step 3 — Categorize pending changes

Parse the plan text from Step 2 and group every resource change by action:

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

### Step 4 — Flag data-loss risks

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
   permanently deleted without a separate confirmation step. Flag this as
   **HIGH RISK**.
3. Recommend the user verify a backup or confirm the data is expendable before
   applying.

```bash
grep -E '(google_storage_bucket|google_firestore|force_destroy)' /tmp/tf-plan-output.txt || true
```

### Step 5 — Review IAM changes against least-privilege rules

Extract all IAM resource changes from the plan:

```bash
sed -n '/Terraform will perform the following actions/,$p' /tmp/tf-plan-output.txt \
  | grep -E '(google_.*_iam|google_project_iam|google_storage.*iam|roles/)' || true
```

The plan's `Refreshing state...` preamble names every existing IAM binding and
its role; those are reads, not changes. Matching the whole file therefore
reports the project's entire IAM surface as findings — scope the search to the
action section, as above.

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

### Step 6 — Report a structured summary

Produce a final report with these sections:

```
## Terraform Plan Review — <ENVIRONMENT> — <timestamp>

### Summary
- Environment: <staging|production>
- Plan source: <local plan | PR #<n>, run <id>, commit <sha>>
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

---
name: docs-sync-check
description: Inspect the current diff and report documentation that must be updated in tandem but has not been; covers coupling rules between code, infrastructure, CI config, and docs
disable-model-invocation: false
allowed-tools: Bash(git *)
---

# Docs Sync Check

This is a report-only skill. It inspects the changed file set and flags
documentation gaps — it never edits files. Fixing any gap is left to the user
or another skill.

## Context

**Changed files relative to master (branch diff):**

```
!`git diff --name-only master...HEAD 2>/dev/null || echo "(no branch diff)"`
```

**Staged changes not yet committed:**

```
!`git diff --name-only --cached`
```

**Working tree status:**

```
!`git status --short`
```

## Your Task

Follow these steps in order. Stop and ask the user if anything is unclear.

### Step 1 — Compute the full changed file set

Combine all three sources into one deduplicated list:

```bash
# Branch diff
git diff --name-only master...HEAD 2>/dev/null

# Staged (not yet committed)
git diff --name-only --cached
```

Call this combined set **CHANGED**. This is the input for every rule below.

### Step 2 — Evaluate deterministic rules

For each rule, check whether the trigger files changed AND whether the coupled
doc files did NOT change. A rule fires when the trigger changed but the coupled
doc did not.

**Rule D1 — Function added or removed**

Trigger: any path matching `src/functions/*` appearing in CHANGED (as new file,
deleted file, or modification to a directory-level file like `package.json`
inside a new/removed workspace).

To detect additions and deletions specifically:

```bash
# Files that exist in HEAD but not master (additions)
git diff --name-only --diff-filter=A master...HEAD -- 'src/functions/*'

# Files that existed in master but not HEAD (deletions)
git diff --name-only --diff-filter=D master...HEAD -- 'src/functions/*'
```

Coupled docs that must also change:
- `.github/workflows/test.yml` — both `lint-functions.strategy.matrix.function`
  and `test-functions.strategy.matrix.function` arrays
- `README.md` — pipeline description section

Flag if the trigger fired but neither `.github/workflows/test.yml` nor
`README.md` appears in CHANGED.

**Rule D2 — Terraform variables changed**

Trigger: `terraform/variables.tf` in CHANGED.

Coupled doc: `terraform/terraform.tfvars.example`

Flag if `terraform/variables.tf` changed but `terraform/terraform.tfvars.example`
did not.

**Rule D3 — New GCP service added in Terraform**

Trigger: a new `resource "google_<service>_*"` block introduced in any
`terraform/**/*.tf` file in CHANGED, where `<service>` is not already covered
by the existing ROLES array in `scripts/setup-github-actions.sh`.

To inspect:

```bash
# See what new google_ resources appear in the diff
git diff master...HEAD -- 'terraform/**/*.tf' | grep '^+.*resource "google_'
```

Currently configured services (roles already in `scripts/setup-github-actions.sh`):
IAM, Cloud Storage, Cloud Functions, Pub/Sub, Cloud Scheduler,
Firestore/Datastore, Secret Manager, Service Usage, Billing.

Coupled docs that must also change:
- `scripts/setup-github-actions.sh` — `ROLES` array (lines ~198-210)
- `CLAUDE.md` — "Services currently configured" list under
  "Maintaining Infrastructure Scripts"

Flag if a new GCP service outside the already-configured list appears but
`scripts/setup-github-actions.sh` is not in CHANGED, or if `CLAUDE.md` is
not in CHANGED.

### Step 3 — Evaluate judgment rules

For each judgment rule, read the relevant portion of the diff to understand
the nature of the change, then reason about whether the coupled doc needs
updating. Explain your reasoning explicitly.

**CLAUDE.md guard:** before recommending a CLAUDE.md update, apply this test:
*Does the change introduce a new reusable pattern, workflow, or architectural
principle that a future AI assistant would need to know about?* If the change
is implementation-specific (new function names, specific file paths, version
numbers, line-level details), do NOT recommend adding it to CLAUDE.md.
CLAUDE.md documents patterns, not implementations.

**Rule J1 — npm scripts changed**

Trigger: `package.json` in CHANGED.

Inspect the diff:

```bash
git diff master...HEAD -- package.json | grep '^[+-].*"scripts"' -A 50 | head -60
```

If the scripts section changed (keys added, removed, or renamed), check whether:
- `CLAUDE.md` "Common Commands" section reflects the current script set
- `README.md` command references are still accurate

Apply the CLAUDE.md guard: only flag if the change affects the developer
workflow at the pattern level (a new category of command), not if it is a
minor flag tweak.

**Rule J2 — New design or code pattern introduced**

Trigger: substantive changes to `src/**/*.ts` in CHANGED that introduce a
new reusable pattern (new shared utility, new event handler shape, new
error-handling convention, etc.).

Inspect:

```bash
git diff master...HEAD -- 'src/**/*.ts' | head -200
```

Apply the CLAUDE.md guard strictly. Only flag when the diff shows a new
pattern that other functions would follow and that is not yet covered by an
existing section in `CLAUDE.md`. Do not flag for:
- Implementation details of a single function
- Minor refactors within an existing pattern
- Adding tests for existing patterns

**Rule J3 — Pipeline stage or event changed**

Trigger: changes to event trigger configuration in any
`terraform/modules/*/main.tf` or `terraform/main.tf` that alter the stage
count, event type (PubSub vs Storage vs Scheduler), or stage order.

Inspect:

```bash
git diff master...HEAD -- 'terraform/**/*.tf' | grep -E '^[+-].*(event_trigger|pubsub_target|schedule|storage)' | head -40
```

Coupled docs that may need updating:
- `README.md` — architecture diagram and pipeline description
- `CLAUDE.md` — pipeline section ("Event-Driven Architecture", "Event Trigger
  Types", "Pipeline Flow")

Apply the CLAUDE.md guard: only flag if the change alters the overall
architectural pattern, not if it adjusts a timeout or memory setting within
an existing stage.

### Step 4 — Report

Produce a report with two parts:

**Part A — Triggered rules table**

| Rule | Type | Trigger | Missing doc(s) | Action needed |
|------|------|---------|----------------|---------------|
| D1 | Deterministic | `src/functions/*` added/removed | `.github/workflows/test.yml`, `README.md` | Update matrix arrays and pipeline description |
| ... | ... | ... | ... | ... |

List only rules that fired. If no rule fired, write:

> No documentation gaps detected. All coupling rules passed.

**Part B — Judgment rule reasoning**

For each judgment rule (J1-J3), provide one short paragraph explaining what
you saw in the diff and why you did or did not flag it. Be specific — quote
the relevant diff lines if they are short. If you applied the CLAUDE.md guard
to suppress a flag, say so explicitly.

This skill does not edit any file. To fix a flagged gap, update the coupled
doc manually or invoke the relevant skill (`/create-pr`, `/commit`, etc.).

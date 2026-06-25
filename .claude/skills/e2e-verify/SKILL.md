---
name: e2e-verify
description: Run the end-to-end verification flow — confirm Drive auth/access, run the full-pipeline E2E checks across all four pipeline stages, and clean up test artifacts on confirmation
argument-hint: "[environment]"
disable-model-invocation: true
allowed-tools: Bash(npm *) Bash(gcloud *)
---

# E2E Verify

Formalizes the Drive integration test workflow and the E2E scripts referenced in
`CLAUDE.md`. It confirms Drive auth/access, runs the full-pipeline E2E against the
target environment, observes the four pipeline stages, and cleans up any artifacts
the run created — with a confirmation gate before any destructive cleanup. It does
not deploy infrastructure (delegated to `deploy-staging`), does not fix failing
functions, and does not perform the one-time Drive folder-sharing setup (a
documented manual prerequisite). (CONVENTIONS.md §4.4)

## Context

**Target environment:**
```
!`echo "ENVIRONMENT=${ENVIRONMENT:-staging}"`
```

**E2E-related npm scripts:**
```
!`node -e "const s=require('./package.json').scripts; Object.keys(s).filter(k=>k.includes('e2e')).forEach(k=>console.log(k+': '+s[k]))"`
```

**Active gcloud account (Drive access uses your user credentials):**
```
!`gcloud config get-value account 2>/dev/null`
```

## Your Task

Follow these steps in order. Stop and ask the user if anything is unclear.

### Step 1 — Confirm environment and the Drive prerequisite

Confirm the target environment (default `staging`). Drive folder sharing with the
service accounts is a one-time, documented manual prerequisite — this skill does
not perform it. If you are unsure it has been done, say so before proceeding.

### Step 2 — Verify Drive access

```bash
npm run test:e2e:check-drive
```

If the Drive access check fails, STOP and report the failure (likely missing
folder sharing or Drive auth) — do not continue to the pipeline run.

### Step 3 — Run the full-pipeline E2E

```bash
npm run test:e2e
```

Observe the four pipeline stages in order: discovery → preparation → extraction →
persistence.

### Step 4 — Report pass/fail per stage

Report each stage's result with the relevant evidence (the test output / log lines
that prove it passed or where it failed). Be honest about partial results
(CONVENTIONS.md §4.6).

### Step 5 — Clean up test artifacts (gated)

The E2E run may leave test files/folders in Drive/Storage. STOP and confirm with
the user before deleting anything (CONVENTIONS.md §4.3). On confirmation, clean up:

```bash
npm run test:e2e:cleanup
```

Report exactly what was removed. The cleanup is re-runnable (CONVENTIONS.md §4.7) —
if it is partial, say which artifacts remain.

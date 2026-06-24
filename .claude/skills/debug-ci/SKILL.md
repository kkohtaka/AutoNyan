---
name: debug-ci
description: Fetch CI results for a PR or workflow run, identify failed jobs and steps, and surface relevant log excerpts so a failure can be diagnosed. Use when a CI check is red and you need to know why.
argument-hint: "[pr-number | run-id]"
disable-model-invocation: false
allowed-tools: Bash(gh *) WebFetch
---

# Debug CI

Codifies the "Debugging CI/CD Workflows" guidance in `CLAUDE.md`. Read-only
investigation only — this skill fetches and reports; it does not fix, re-run,
or push anything.

## Context

**Current branch:**

```
!`git branch --show-current`
```

**Recent workflow runs on this branch:**

```
!`gh run list --branch "$(git branch --show-current)" --limit 5 2>/dev/null || echo "(gh not authenticated or no runs found)"`
```

**Open PRs for this branch:**

```
!`gh pr status 2>/dev/null || echo "(gh not authenticated or no PR found)"`
```

## Your Task

Follow these steps in order. Stop and ask the user if anything is unclear.

### Step 1 — Resolve the target

Determine what to investigate from `$ARGUMENTS` and the Context above:

- **PR number provided** (e.g. `$ARGUMENTS` is `123`): use that PR directly.
- **Run ID provided** (e.g. `$ARGUMENTS` is a long numeric ID like `12345678`):
  use that workflow run directly.
- **No argument**: look at the Context output.
  - If there is exactly one open PR for this branch, use it.
  - If there are recent runs shown, pick the latest failing one.
  - If the target is still ambiguous (multiple PRs, no failures visible), ask
    the user: "Which PR number or run ID should I investigate?"

### Step 2 — List check / job statuses

Use `gh` as the primary tool; fall back to WebFetch on the GitHub URL if `gh`
output is incomplete.

**If you resolved a PR number:**

```bash
gh pr checks <pr-number>
```

```bash
gh run list --limit 10 --json databaseId,name,status,conclusion,headBranch \
  --jq '.[] | "\(.databaseId)  \(.name)  \(.status)  \(.conclusion)"'
```

**If you resolved a run ID:**

```bash
gh run view <run-id>
```

**WebFetch alternative** — when `gh` output is truncated or unauthenticated:

```
WebFetch URL: https://github.com/<owner>/<repo>/pull/<pr-number>/checks
Prompt: "List all checks with their status and identify the failed jobs and matrix entries"
```

Identify:
- Which jobs failed (mark them clearly).
- Which matrix entries failed (e.g. `test-functions (drive-scanner)`).
- Which jobs are still in progress vs. completed.

### Step 3 — Drill into each failed job

For each failed job, get the step-level detail:

```bash
gh run view <run-id> --job <job-id>
```

```bash
# List jobs with IDs
gh run view <run-id> --json jobs \
  --jq '.jobs[] | "\(.databaseId)  \(.name)  \(.conclusion)"'
```

Find the first step that shows `failure` and note its name — that is where to
look for the root cause.

### Step 4 — Extract the relevant log excerpt

Attempt log extraction in this order:

**Option A — stream logs via `gh` (fastest):**

```bash
gh run view <run-id> --log --job <job-id> 2>/dev/null \
  | grep -E "(FAIL|Error|error|heap out of memory|Cannot find|SyntaxError|AssertionError)" \
  | tail -60
```

**Option B — download the log archive via GitHub API** (use when Option A is
empty or the job produced a large binary archive):

```bash
# IMPORTANT: use "token" prefix, NOT "Bearer" — "Bearer" causes 401 Bad credentials
curl -L -H "Authorization: token ${GITHUB_TOKEN}" \
  "https://api.github.com/repos/<owner>/<repo>/actions/runs/<run-id>/logs" \
  -o /tmp/ci-logs.zip

unzip -p /tmp/ci-logs.zip "*<job-name>*" \
  | grep -E "(FAIL|Error|heap out of memory|Cannot find|SyntaxError|AssertionError)" \
  | tail -60
```

If `GITHUB_TOKEN` is not set, remind the user to export it:

```bash
export GITHUB_TOKEN="$(gh auth token)"
```

**Option C — WebFetch** (fallback when neither `gh` nor the API archive is
accessible):

```
WebFetch URL: https://github.com/<owner>/<repo>/actions/runs/<run-id>
Prompt: "Show job statuses, error messages, and which steps failed with relevant log lines"
```

### Step 5 — Report the diagnosis

Summarise the findings concisely (CONVENTIONS.md §4.6):

1. **Target**: PR `#<n>` / run `<id>`, workflow name, branch.
2. **Failed jobs**: list each failed job and which matrix entry (if applicable).
3. **Root step**: the first failing step in each job.
4. **Key error lines**: the 5–10 most informative log lines per job.
5. **Likely cause**: your interpretation of what went wrong (e.g. type error,
   test assertion failure, coverage threshold miss, memory exhaustion).
6. **Suggested next step**: point to `lint-fix` for lint/format failures,
   `test-fix` for test failures, or describe a code change needed. Do not
   attempt to make the fix yourself — this skill is read-only.

This skill does not fix, re-run, or push anything. To fix failures, delegate to
`/lint-fix`, `/test-fix`, or a targeted code change.

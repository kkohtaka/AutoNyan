---
name: debug-ci
description: Fetch CI results for a PR or workflow run, identify failed jobs and steps, and surface relevant log excerpts so a failure can be diagnosed. Use when a CI check is red and you need to know why.
argument-hint: "[pr-number | run-id]"
disable-model-invocation: false
allowed-tools: Bash(gh *) Bash(git *) Bash(sed *) Bash(grep *) Bash(command *) mcp__github WebFetch
---

# Debug CI

Read-only investigation only — this skill fetches and reports; it does not fix,
re-run, or push anything.

## Context

**GitHub route probe (which transport this environment has):**

```
!`command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1 && echo "route A — gh CLI available" || echo "route B — no usable gh CLI; use the GitHub MCP server"`
```

**Repository (`owner/name`), resolved from the git remote:**

```
!`command -v gh >/dev/null 2>&1 && gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || git remote get-url origin 2>/dev/null | sed -E 's#^[a-zA-Z+]+://##; s#^[^/:]*[:/]##; s#\.git$##' | grep -E '^[^/]+/[^/]+$' || echo "(unresolved — pass owner/repo explicitly)"`
```

> On route A this is `gh repo view`, exactly as before. The route-B fallback
> parses the remote URL and is host-agnostic (it works for GitHub Enterprise
> too); it validates the result against `owner/repo` so a remote it cannot parse
> reports `(unresolved)` instead of a plausible-looking wrong value.

**Current branch:**

```
!`git branch --show-current`
```

**Recent workflow runs on this branch (route A only):**

```
!`command -v gh >/dev/null 2>&1 && gh run list --branch "$(git branch --show-current)" --limit 5 2>/dev/null || echo "(unavailable on this route — list runs in Step 2)"`
```

**Open PRs for this branch (route A only):**

```
!`command -v gh >/dev/null 2>&1 && gh pr status 2>/dev/null || echo "(unavailable on this route — resolve the target in Step 1)"`
```

> Every `gh` block is guarded so this skill loads cleanly in an environment
> without the CLI. On route B the same information comes from the GitHub MCP
> server in Steps 1–4.

## Your Task

Follow these steps in order. Stop and ask the user if anything is unclear.

**Routes.** Two transports reach the GitHub API, and every step below names the
call for each. Use the one the Context probe reported:

| Route | Environment | Transport |
| --- | --- | --- |
| A | local checkout / devcontainer | the `gh` CLI |
| B | Claude Code cloud session | the GitHub MCP server |

The GitHub MCP server is observed as `github`; its tool names are the same
whatever the connector is named. `owner` and `repo` for every MCP call come from
the Context repository line. The analysis and the report are identical on both
routes — only the fetch differs.

### Step 1 — Resolve the target

Determine what to investigate from `$ARGUMENTS` and the Context above:

- **PR number provided** (e.g. `$ARGUMENTS` is `123`): use that PR directly.
- **Run ID provided** (e.g. `$ARGUMENTS` is a long numeric ID like `12345678`):
  use that workflow run directly.
- **No argument**: find the candidates.
  - Route A: use the Context output — if there is exactly one open PR for this
    branch, use it; otherwise pick the latest failing run shown.
  - Route B: list runs for this branch with `actions_list`
    (`method: "list_workflow_runs"`, `workflow_runs_filter: {branch: "<current
    branch>"}`) and pick the latest failing one; use `list_pull_requests`
    (`head: "<owner>:<branch>"`) if you need the PR instead.
  - If the target is still ambiguous (multiple PRs, no failures visible), ask
    the user: "Which PR number or run ID should I investigate?"

### Step 2 — List check / job statuses

**If you resolved a PR number:**

- Route A:
  ```bash
  gh pr checks <pr-number>
  ```
  ```bash
  gh run list --limit 10 --json databaseId,name,status,conclusion,headBranch \
    --jq '.[] | "\(.databaseId)  \(.name)  \(.status)  \(.conclusion)"'
  ```
- Route B: call `pull_request_read` **twice** — once with
  `method: "get_check_runs"` and once with `method: "get_status"`, both with
  `pullNumber`. Both are required: a check reported as a *commit status* rather
  than a *check run* is invisible to the check-runs API alone, so querying only
  one of them can hide the very check that is red.

**If you resolved a run ID:**

- Route A:
  ```bash
  gh run view <run-id>
  ```
- Route B: `actions_get` with `method: "get_workflow_run"` and
  `resource_id: "<run-id>"`.

Identify:
- Which jobs failed (mark them clearly).
- Which matrix entries failed (e.g. `test (unit, macos-latest)`).
- Which jobs are still in progress vs. completed.

### Step 3 — Drill into each failed job

List the run's jobs to get their IDs and conclusions:

- Route A:
  ```bash
  gh run view <run-id> --json jobs \
    --jq '.jobs[] | "\(.databaseId)  \(.name)  \(.conclusion)"'
  ```
- Route B: `actions_list` with `method: "list_workflow_jobs"` and
  `resource_id: "<run-id>"`.

Then get the step-level detail for each failed job:

- Route A:
  ```bash
  gh run view <run-id> --job <job-id>
  ```
- Route B: `actions_get` with `method: "get_workflow_job"` and
  `resource_id: "<job-id>"`.

Find the first step that shows `failure` and note its name — that is where to
look for the root cause.

### Step 4 — Extract the relevant log excerpt

- Route A:
  ```bash
  gh run view <run-id> --log --job <job-id> 2>/dev/null \
    | grep -E "(FAIL|Error|error|heap out of memory|Cannot find|SyntaxError|AssertionError)" \
    | tail -60
  ```
- Route B: `get_job_logs` with `return_content: true` and either
  `job_id: <job-id>` for one job, or `run_id: <run-id>` with
  `failed_only: true` to get every failed job in the run at once. Use
  `tail_lines` to keep the response small (start around 200) and raise it only
  if the failure is not visible in the tail. Then scan the returned text for the
  same error markers as route A.

**Last resort — WebFetch** (public repositories only; it is unauthenticated and
sees nothing in a private repo). Note that on route A this is now the only
fallback when the `gh --log` output comes back empty — the previous
`GITHUB_TOKEN` log-archive download was removed because it obtained its token
from `gh auth token` and so could never work on route B:

```
WebFetch URL: https://github.com/<owner>/<repo>/actions/runs/<run-id>
Prompt: "Show job statuses, error messages, and which steps failed with relevant log lines"
```

If neither route is available — no `gh`, and no GitHub MCP server in this
session — stop and say so plainly, naming both routes you tried. Do not present
a partial or guessed diagnosis as a complete one.

### Step 5 — Report the diagnosis

Summarise the findings concisely and honestly — report failures, partial
results, and anything you could not retrieve:

1. **Target**: PR `#<n>` / run `<id>`, workflow name, branch.
2. **Failed jobs**: list each failed job and which matrix entry (if applicable).
3. **Root step**: the first failing step in each job.
4. **Key error lines**: the 5–10 most informative log lines per job.
5. **Likely cause**: your interpretation of what went wrong (e.g. type error,
   test assertion failure, coverage threshold miss, memory exhaustion).
6. **Suggested next step**: point to the repository's own lint/test remediation
   workflow or skills if it has them, or describe the code change needed. Do
   not attempt to make the fix yourself — this skill is read-only.

This skill does not fix, re-run, or push anything.

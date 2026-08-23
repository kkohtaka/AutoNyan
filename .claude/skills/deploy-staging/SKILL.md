---
name: deploy-staging
description: Guided deployment to the staging environment — a reviewed plan, an explicit confirmation gate, then either a local terraform apply or the Deploy workflow, followed by verification of the result
disable-model-invocation: true
allowed-tools: Bash(npm *) Bash(terraform *) Bash(gcloud *) Bash(gh *) mcp__github
---

# Deploy to Staging

Formalizes the deploy + verify half of the Infrastructure Change Workflow in
`CLAUDE.md` for the **staging** environment, with an explicit confirmation gate
before anything is applied. Production deploys are tag-driven via the Deploy
workflow and are out of scope. The read-only plan review is delegated to
`terraform-plan-review` (CONVENTIONS.md §4.4) — this skill does not re-implement
plan logic, nor does it fix code/Terraform.

There are two ways to apply (CONVENTIONS.md §4.8). The devcontainer runs
`npm run deploy` against the Terraform state directly. A cloud session has
neither Google Cloud credentials nor state access, so it starts the existing
Deploy workflow instead — that workflow authenticates with Workload Identity
Federation, so the credential stays on the GitHub side and none enters the
session. The confirmation gate is the same on both routes and is never skipped
on either: `terraform:apply` runs with `-auto-approve`, and a dispatched
workflow has no prompt of its own, so this skill's gate is the only one there is.

Route B is **split from a cloud session**: reading a run — its jobs, steps and
logs — works, but *starting* one does not, because dispatching needs an Actions
write permission the session's GitHub App token does not carry (Step 4B). Treat
that split as the design rather than a gap waiting to close: a GitHub App's
permission scopes are declared by the app's publisher, so no repository or
account setting can add `actions: write` to the token a session holds. The user
dispatches; the skill takes over from Step 5 and drives the run to a reported
outcome.

## Context

**Local apply capability (Terraform state access):**

```
!`command -v terraform >/dev/null 2>&1 && test -f "terraform/environments/staging.backend.hcl" && echo "local apply available" || echo "local apply unavailable — deploy through the Deploy workflow"`
```

**GitHub access mode:**

```
!`command -v gh >/dev/null 2>&1 && echo "gh CLI available" || echo "gh CLI unavailable — use the GitHub MCP tools"`
```

**Target environment:**

```
!`echo "ENVIRONMENT=${ENVIRONMENT:-staging}"`
```

**Current branch and working tree:**

```
!`git branch --show-current && git status --short`
```

**Terraform backend initialized for this environment?**

```
!`ls terraform/.terraform/terraform.tfstate >/dev/null 2>&1 && echo "initialized" || echo "NOT initialized — run npm run terraform:init, or deploy through the workflow"`
```

## Your Task

Follow these steps in order. Stop and ask the user if anything is unclear.

### Step 1 — Confirm the target is staging, and pick the route

This skill never deploys production — that path is tag-driven. Verify the target
is staging and stop if it is not.

Then choose the route from what the Context reported:

- **Route A — local apply.** The Context reported a local apply is available.
  Confirm `ENVIRONMENT=staging`; if it is unset or different, ask the user to
  `export ENVIRONMENT=staging` before continuing. If the backend is not
  initialized, run `npm run terraform:init`.
- **Route B — the Deploy workflow.** No local state access. Identify the git ref
  to deploy and confirm it with the user; the workflow takes a ref rather than
  deploying whatever is checked out, so this is a choice, not a detail.

If neither route is available, stop and say so rather than reporting a deploy
that did not happen (CONVENTIONS.md §4.6).

### Step 2 — Review the plan (delegated)

Delegate the read-only plan review to the `terraform-plan-review` skill rather
than re-implementing it (CONVENTIONS.md §4.4). Surface its summary: what
resources will be created, changed, or destroyed, and any data-loss or
least-privilege concerns it flags.

On Route B that skill has no local state either, so it reviews the plan the
Terraform Plan (Staging) workflow produced for the pull request holding this ref.
If the ref has no such plan, say so — deploying a ref whose plan nobody has read
is exactly what the Infrastructure Change Workflow forbids — and let the user
decide whether to get one first.

### Step 3 — Confirmation gate before applying

STOP. State exactly what will be applied to staging (the create/change/destroy
counts and any destructive changes from Step 2), and on Route B state the ref
being deployed and that the apply runs with production credentials on a runner
rather than locally. Wait for the user's explicit confirmation
(CONVENTIONS.md §4.3). Do not proceed without it.

### Step 4A — Apply locally (devcontainer)

Skip to Step 4B if you are on Route B.

On explicit confirmation, run the full deploy (build + `terraform apply`):

```bash
npm run deploy
```

### Step 4B — Apply through the Deploy workflow

On explicit confirmation, start the Deploy workflow for **staging** and follow
the run to completion.

The workflow's `environment` input is a choice that also accepts `production`.
Always pass `staging` explicitly — never take the default, and never pass the
value through from a variable that could hold something else.

Record the current UTC time before dispatching. Nothing in the dispatch returns a
run id, on either route, and the run cannot be identified by ref — see
"Finding your run" below — so the dispatch timestamp is what separates your run
from every other staging deploy.

- **`gh` available**:

  ```bash
  date -u +%Y-%m-%dT%H:%M:%SZ
  gh workflow run deploy.yml --repo kkohtaka/AutoNyan --ref master \
    -f deploy_ref=<ref> -f environment=staging
  ```

  `--ref` selects which commit's copy of `deploy.yml` runs, which is a separate
  choice from `deploy_ref` (what gets deployed). Use `master` unless you mean to
  test a change to the workflow itself. Then find the run id as below and
  `gh run watch <run-id> --repo kkohtaka/AutoNyan`.

- **`gh` unavailable** — a cloud session. Dispatch `deploy.yml` with the same two
  inputs through the GitHub MCP tools, then poll the run until it reaches a
  conclusion.

  **This currently fails.** Dispatching a workflow needs the `actions: write`
  permission, and the GitHub App token a cloud session holds is read-only for
  Actions: the call returns
  `403 Resource not accessible by integration`, for every workflow, regardless of
  who the session is authenticated as. When it does, **stop and say the deploy
  was not started** (CONVENTIONS.md §4.6) — do not report a queued or successful
  deploy. Give the user the `gh` command above, or the Actions → Deploy → Run
  workflow UI path, so they can start it themselves, and then follow their run
  from Step 5. Everything after the dispatch is read-only and does work from a
  cloud session.

**Finding your run.** `head_branch` is the ref the *workflow definition* came
from, so every dispatched staging deploy carries `head_branch: master` and the
title `Deploy to staging (master)` — filtering by ref selects other people's runs
just as readily as your own. Match instead on workflow `deploy.yml`, event
`workflow_dispatch`, and `created_at` at or after the timestamp you recorded, and
confirm `display_title` names the ref you asked for. Never take the newest run on
faith.

Listing runs returns far more than it looks like: ten runs of this workflow is
roughly 380,000 characters and is rejected for exceeding the token limit, and
asking for fewer per page does not help — the page size is ignored and 30 runs
come back regardless. Expect the response to spool to a file — that is the
outcome to aim for, not an error — and extract `id`, `display_title`, `event`,
`created_at`, `status` and `conclusion` from it rather than reading it whole.

Two things can hold the run before it applies anything, and neither is a failure
— report them as waiting rather than as success or error:

- The `staging` GitHub Environment may require an approval the user has to give.
- The run serializes on the `terraform-staging` concurrency group, which it
  shares with the plan workflow, so it queues behind any plan in flight.

### Step 5 — Verify the deployment

Verify by the route you deployed on, and report honestly (CONVENTIONS.md §4.6).

Route A, with `gcloud` and state access:

```bash
gcloud functions list --format="table(name,state,environment,region)"
terraform -chdir=terraform output
```

- Confirm the expected functions are deployed and in an active state.
- Sanity-check the event triggers (PubSub topics / scheduler / buckets) exist.

Route B, from the run itself. Step names and log text come from two different
places, and confusing them is how this step silently reports nothing:

- **Step names and their conclusions come from the job listing**, not the log.
  Listing the run's jobs returns the single `deploy` job with every step by name
  and conclusion (`success`, `failure`, `skipped`).
- **The log carries no step names at all.** A job log fetched through the API is
  bare output; the only group marker the deploy job emits is
  `##[group]Run EXIT_CODE="0"`. Searching it for `Report deployment status` finds
  nothing *even on a run that succeeded* — so read that step's result by its
  output text (`✅ Deployment to <env> completed successfully` / `Deployed ref:`,
  or the `❌` line), and never conclude from a missing step name that the step
  did not run.
- Fetching the log needs a large explicit tail. The default reaches only the
  runner's teardown; the `Deploy infrastructure` step alone emits thousands of
  lines. Ask for enough, expect the response to spool to a file, and search the
  file. Every line is prefixed with an ISO-8601 timestamp, so strip it before any
  line-anchored matching:

  ```bash
  sed -E 's/^([^\t]*\t){0,2}[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z //' raw.txt > clean.txt
  ```

- **On failure, name the step that failed** — `Deploy infrastructure`,
  `Build function packages`, `Authenticate to Google Cloud` and so on — from the
  job listing, and quote the relevant lines from the log. The workflow has a
  single `deploy` job, so the job name alone identifies nothing; the step is the
  useful unit.
- Note whether `Cleanup Terraform lock on failure` ran. It only runs when the
  apply itself failed, and it tells the user whether a stale state lock was
  cleared or may still be held. On a successful run the job listing reports it as
  `skipped`, which is the expected state, not a problem to report.

On either route, check the deployed functions' logs for startup or runtime errors
with `debug-function-logs`, which has its own route for a session without
`gcloud`.

Report success or failure plainly; if any verification step fails, or if the run
is still waiting on an approval or the concurrency group, say so and point to the
next action rather than presenting the deploy as fully done.

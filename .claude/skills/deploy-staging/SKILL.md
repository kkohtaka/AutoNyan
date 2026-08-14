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

- **`gh` available**:

  ```bash
  gh workflow run deploy.yml --repo kkohtaka/AutoNyan \
    -f deploy_ref=<ref> -f environment=staging
  gh run watch <run-id> --repo kkohtaka/AutoNyan
  ```

- **`gh` unavailable** — a cloud session. Dispatch `deploy.yml` with the same two
  inputs through the GitHub MCP tools, then poll the run until it reaches a
  conclusion. Dispatching returns no run id, so find the run by workflow and ref
  rather than assuming the newest run is yours.

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

Route B, from the run itself:

- Read the run's conclusion and the `Report deployment status` step, which states
  the environment and the deployed ref.
- **On failure, name the step that failed** — `Deploy infrastructure`,
  `Build function packages`, `Authenticate to Google Cloud` and so on — and quote
  the relevant log lines. The workflow has a single `deploy` job, so the job name
  alone identifies nothing; the step is the useful unit.
- Note whether `Cleanup Terraform lock on failure` ran. It only runs when the
  apply itself failed, and it tells the user whether a stale state lock was
  cleared or may still be held.

On either route, check the deployed functions' logs for startup or runtime errors
with `debug-function-logs`, which has its own route for a session without
`gcloud`.

Report success or failure plainly; if any verification step fails, or if the run
is still waiting on an approval or the concurrency group, say so and point to the
next action rather than presenting the deploy as fully done.

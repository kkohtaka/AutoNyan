---
name: deploy-staging
description: Guided deployment to the staging environment — build, a confirmed terraform apply, and post-apply verification, with an explicit confirmation gate before applying
disable-model-invocation: true
allowed-tools: Bash(npm *) Bash(terraform *) Bash(gcloud *)
---

# Deploy to Staging

Formalizes the deploy + verify half of the Infrastructure Change Workflow in
`CLAUDE.md` for the **staging** environment, with an explicit confirmation gate
before `terraform apply`. Production deploys are tag-driven via the Deploy
workflow and are out of scope. The read-only plan review is delegated to
`terraform-plan-review` (CONVENTIONS.md §4.4) — this skill does not re-implement
plan logic, nor does it fix code/Terraform.

## Context

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
!`ls terraform/.terraform/terraform.tfstate >/dev/null 2>&1 && echo "initialized" || echo "NOT initialized — run npm run terraform:init"`
```

## Your Task

Follow these steps in order. Stop and ask the user if anything is unclear.

### Step 1 — Confirm the target is staging

Verify `ENVIRONMENT=staging` (this skill never deploys production — that path is
tag-driven). If `ENVIRONMENT` is unset or not `staging`, stop and ask the user to
`export ENVIRONMENT=staging` before continuing. Confirm the Terraform backend is
initialized (Context above); if not, run:

```bash
npm run terraform:init
```

### Step 2 — Review the plan (delegated)

Delegate the read-only plan review to the `terraform-plan-review` skill rather
than re-implementing it (CONVENTIONS.md §4.4). Surface its summary: what
resources will be created, changed, or destroyed, and any data-loss or
least-privilege concerns it flags.

### Step 3 — Confirmation gate before applying

STOP. State exactly what `npm run deploy` will apply to the staging environment
(the create/change/destroy counts and any destructive changes from Step 2) and
wait for the user's explicit confirmation (CONVENTIONS.md §4.3). Do not proceed
without it.

### Step 4 — Build and apply

On explicit confirmation, run the full deploy (build + `terraform apply`):

```bash
npm run deploy
```

### Step 5 — Verify the deployment

Verify post-deploy and report honestly (CONVENTIONS.md §4.6):

```bash
gcloud functions list --format="table(name,state,environment,region)"
terraform -chdir=terraform output
```

- Confirm the expected functions are deployed and in an active state.
- Check function logs for startup/runtime errors (see `debug-function-logs`).
- Sanity-check the event triggers (PubSub topics / scheduler / buckets) exist.

Report success or failure plainly; if any verification step fails, say so and
point to the next action rather than presenting the deploy as fully done.

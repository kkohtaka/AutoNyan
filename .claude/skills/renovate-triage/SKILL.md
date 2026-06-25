---
name: renovate-triage
description: Triage open Renovate dependency PRs and the Dependency Dashboard — summarize each update, assess risk (dev vs runtime, major vs minor, CI status), recommend an action, and merge only approved PRs after explicit confirmation
disable-model-invocation: true
allowed-tools: Bash(gh *)
---

# Renovate Triage

Triages Renovate dependency PRs and the Dependency Dashboard: summarizes what each
update changes, assesses risk, and recommends an action — with any actual merge
gated behind explicit user confirmation. CI-failure analysis is delegated to
`debug-ci` rather than re-implementing log triage (CONVENTIONS.md §4.4). It does
not write code to satisfy an update, force-merge without CI, or triage
non-Renovate PRs.

## Context

**Open pull requests (identify the Renovate-authored ones):**
```
!`gh pr list --state open --json number,title,author,labels,headRefName,isDraft --limit 50`
```

**Dependency Dashboard issue, if present:**
```
!`gh issue list --state open --search "Dependency Dashboard in:title" --json number,title --limit 5`
```

## Your Task

Follow these steps in order. Stop and ask the user if anything is unclear.

### Step 1 — Collect the Renovate PRs

From the Context, identify the open Renovate PRs (authored by the Renovate GitHub
App bot, typically on `renovate/*` branches and labelled `dependencies`).
Optionally read the Dependency Dashboard issue for the full backlog:

```bash
gh issue view <dashboard-number>
```

### Step 2 — Summarize and check CI per PR

For each Renovate PR, summarize the dependency change and its CI status:

```bash
gh pr view <number> --json title,body,labels,statusCheckRollup,files
```

- Name the dependency, the version delta, and whether it is a **dev** or
  **runtime** dependency.
- Report the CI check status. If a check **failed**, delegate the failure analysis
  to `debug-ci` rather than re-triaging logs here (CONVENTIONS.md §4.4).

### Step 3 — Group by risk and recommend

Group the PRs and give a recommendation per group:

- **Low-risk** — green CI, dev dependency and/or minor/patch bump → recommend
  merge.
- **Needs attention** — red CI, major version bump, and/or runtime dependency →
  recommend holding for review, with the reason.

### Step 4 — Confirmation gate before merging

STOP. List exactly which PR(s) you propose to merge and wait for the user's
explicit approval of the specific PR(s) (CONVENTIONS.md §4.3). Never merge without
it, and never force-merge past failing CI. On approval, merge only the approved
PRs using the project's merge method:

```bash
gh pr merge <number> --squash
```

Report the result of each merge honestly (CONVENTIONS.md §4.6), including any that
failed or were skipped.

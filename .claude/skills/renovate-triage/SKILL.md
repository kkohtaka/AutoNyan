---
name: renovate-triage
description: Triage open Renovate dependency PRs and the Dependency Dashboard — summarize each update, assess risk (dev vs runtime, major vs minor, CI status), recommend an action, and merge only approved PRs after explicit confirmation
disable-model-invocation: false
allowed-tools: Bash(gh *) mcp__github
---

# Renovate Triage

Triages Renovate dependency PRs and the Dependency Dashboard: summarizes what each
update changes, assesses risk, and recommends an action — with any actual merge
gated behind explicit user confirmation. CI-failure analysis is delegated to
`debug-ci` rather than re-implementing log triage (CONVENTIONS.md §4.4). It does
not write code to satisfy an update, force-merge without CI, or triage
non-Renovate PRs.

Every GitHub read and write below has two routes (CONVENTIONS.md §4.8): `gh` in
the devcontainer, the GitHub MCP tools in a cloud session, which has no `gh`.
The triage judgement is identical either way — only the way the data is fetched
differs.

## Context

**GitHub access mode:**
```
!`command -v gh >/dev/null 2>&1 && echo "gh CLI available" || echo "gh CLI unavailable — use the GitHub MCP tools"`
```

**Open pull requests (identify the Renovate-authored ones):**
```
!`command -v gh >/dev/null 2>&1 && gh pr list --state open --json number,title,author,labels,headRefName,isDraft --limit 50 || echo "unavailable here — list open pull requests in Step 1 instead"`
```

**Dependency Dashboard issue, if present:**
```
!`command -v gh >/dev/null 2>&1 && gh issue list --state open --search "Dependency Dashboard in:title" --json number,title --limit 5 || echo "unavailable here — search for it in Step 1 instead"`
```

## Your Task

Follow these steps in order. Stop and ask the user if anything is unclear.

### Step 1 — Collect the Renovate PRs

Identify the open Renovate PRs (authored by the Renovate GitHub App bot,
typically on `renovate/*` branches and labelled `dependencies`). Optionally read
the Dependency Dashboard issue for the full backlog, by the route the Context
reported:

- **`gh` available** — the devcontainer:

  ```bash
  gh issue view <dashboard-number>
  ```

- **`gh` unavailable** — a cloud session. List the open pull requests and find
  the Dependency Dashboard issue for `kkohtaka/AutoNyan` with the GitHub MCP
  tools. Their issue search is semantic and takes no state filter, so it
  returns closed issues too — pick the open one from the results rather than
  the first match.

If neither route is available, stop and say so — do not triage from an assumed
PR list.

### Step 2 — Summarize and check CI per PR

For each Renovate PR, summarize the dependency change and its CI status:

```bash
gh pr view <number> --json title,body,labels,statusCheckRollup,files
```

Without `gh`, read the same information with the GitHub MCP tools: the PR body,
its labels, its changed files, and its CI state. CI is **two** separate calls
there — the check runs **and** the commit statuses. `terraform/plan/staging` is
reported as a commit status, not a check run, so a check-runs-only read misses a
required context and wrongly looks green. Do not report CI status from the PR
record alone.

- Name the dependency, the version delta, and whether it is a **dev** or
  **runtime** dependency.
- Report the CI check status. If a check **failed**, delegate the failure analysis
  to `debug-ci` rather than re-triaging logs here (CONVENTIONS.md §4.4).
  `debug-ci` is APM-managed and shells out to `gh`, so in a cloud session it is
  unavailable: report the failing check and its run link, and say the log
  triage needs the devcontainer, rather than re-implementing `debug-ci` here.

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

Without `gh`, merge through the GitHub MCP tools, squash method, one approved PR
at a time. The confirmation gate above applies unchanged — the route does not
make the merge any less irreversible.

Report the result of each merge honestly (CONVENTIONS.md §4.6), including any that
failed or were skipped.

---
name: resolve-issue
description: Turn a GitHub issue into a ready-to-merge change by reading the issue, confirming the approach, creating a correctly named branch, and delegating implementation, quality checks, commits, and PR creation to sibling skills
argument-hint: "<issue-number>"
disable-model-invocation: true
allowed-tools: Bash(git *) Bash(gh *)
---

# Resolve Issue

This is a thin orchestrator skill. It owns issue comprehension, approach
framing, branch creation, and `Closes #N` linkage. Everything else —
implementation, quality checks, committing, and PR creation — is delegated to
the sibling skills `lint-fix`, `test-fix`, `quality-gate`, `commit`, and
`create-pr` (CONVENTIONS.md §4.4).

## Context

**Current branch:**

```
!`git branch --show-current`
```

**Working tree status:**

```
!`git status --short`
```

**Issue number from arguments:** `$ARGUMENTS`

## Your Task

Follow these steps in order. Stop and ask the user if anything is unclear.

### Step 1 — Identify and read the issue

If `$ARGUMENTS` is empty, stop and ask the user for the issue number before
proceeding.

Fetch the issue:

```bash
gh issue view <issue-number>
```

Read the full output: title, body, labels, and any linked issues. Understand
what the issue asks for before moving on.

### Step 2 — Confirm the problem and approach

Restate in your own words:

1. **Problem**: what the issue describes as broken or missing.
2. **Proposed approach**: how you intend to address it (files to change, new
   behaviour to add, or infrastructure to update).

**STOP.** Present the restatement to the user and wait for explicit confirmation
before creating the branch or touching any files. Do not proceed until the user
agrees or adjusts the approach.

### Step 3 — Create a correctly named branch

Never work directly on `master`. Fetch remote state first:

```bash
git fetch origin
```

Pick a branch prefix that fits the issue:

- `feat/` — new feature or capability
- `fix/` — bug fix
- `docs/` — documentation only
- `refactor/` — code restructuring without behaviour change

Derive the branch name from the issue title (lowercase kebab-case, short but
specific). Branch-naming rules are the same as those used by the `commit` skill
(see `.claude/skills/commit/SKILL.md` Step 1 — Case A).

Create the branch off `origin/master`:

```bash
git checkout -b <prefix/short-description> origin/master
```

If the current branch is already a suitably named work branch for this issue
(not `master`), stay on it.

### Step 4 — Implement and verify

Carry out the changes agreed in Step 2. After implementation, delegate quality
checks in this order:

1. **Lint**: invoke the `lint-fix` skill to run and fix all linting issues.
2. **Tests**: invoke the `test-fix` skill to run the full test suite with
   coverage and fix any failures.
3. **Quality gate** (if the `quality-gate` skill is available): invoke it for a
   final pass-or-fail report.

Do not re-implement what those skills already do.

### Step 5 — Commit the changes

Delegate all staging and committing to the `commit` skill. Do not duplicate its
steps here.

### Step 6 — Open the PR

**STOP.** Before pushing or opening a PR, confirm with the user:

- The branch name and the commits that will be pushed.
- The PR title and a preview of the body (including the `Closes #<issue-number>`
  line).

Wait for explicit approval.

Once approved, delegate PR creation to the `create-pr` skill. Ensure the PR
body includes a `## Related issue` section near the top with:

```
Closes #<issue-number>
```

This line causes GitHub to automatically close the issue when the PR merges.
Pass this requirement to `create-pr` as context so it includes it in the body.

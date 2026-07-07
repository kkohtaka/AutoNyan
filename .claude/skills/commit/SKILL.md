---
name: commit
description: Create one or more incremental conventional commits on a properly named branch, without pushing or opening a PR
argument-hint: "[commit-scope-hint]"
disable-model-invocation: true
allowed-tools: Bash(git *) Bash(gh *)
---

# Commit

## Context

Collect the information needed to group and commit the changes.

**Remote default branch (strip the `origin/` prefix when using it):**
```
!`git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || gh repo view --json defaultBranchRef -q '"origin/" + .defaultBranchRef.name' 2>/dev/null || echo "(unresolved — run: git remote set-head origin --auto)"`
```

**Working tree status:**
```
!`git status --short`
```

**Current branch:**
```
!`git branch --show-current`
```

**Staged and unstaged diff:**
```
!`git diff HEAD`
```

**Recent commits (for message style and to detect already-committed work):**
```
!`git log --oneline -10`
```

## Your Task

Follow these steps in order. Stop and ask the user if anything is unclear.

This skill creates local commits only. A local commit is not outward-facing and
is reversible, so it needs no confirmation gate. Pushing the branch and opening
a PR are **out of scope** — those are the `create-pr` skill's job (if it is
available); do not perform them here.

Throughout these steps, `<default>` means the remote default branch resolved in
Context (e.g. `main` or `master`) — never assume a specific name, and never use
the local ref of that branch (it can silently lag behind the remote).

### Step 1 — Ensure the work is on a properly named branch

First, fetch the latest remote state:

```bash
git fetch origin
```

If the default branch could not be resolved in Context, fix the local
`origin/HEAD` ref and re-resolve before continuing:

```bash
git remote set-head origin --auto
git symbolic-ref --short refs/remotes/origin/HEAD
```

**Case A — current branch is NOT suitable** (it is the default branch, or its
name does not describe the work):

Create a new branch from the remote default branch and move the relevant changes
there:

```bash
git checkout -b <branch-name> origin/<default>
```

- Derive the branch name from the actual diff/changes — specific enough to
  convey purpose at a glance.
- Convention: `feat/`, `fix/`, `refactor/`, `docs/`, `chore/`, `ci/` + lowercase
  kebab-case description.
- If the user passed `$ARGUMENTS`, use it as a hint for the branch name and
  commit scope (adjusted to fit the convention if needed).
- Uncommitted changes follow `git checkout -b` automatically. If the work was
  already committed on the default branch or a poorly named branch, move those
  commits to the new branch (e.g. cherry-pick) and reset the old branch.

**Case B — current branch is already a suitable work branch:**

Stay on the current branch, but verify its base is not stale:

```bash
git merge-base --is-ancestor origin/<default> HEAD && echo "base OK" || echo "STALE BASE"
```

If the check reports a stale base, the branch was cut from an outdated view of
the default branch, and a PR from it will conflict or carry an outdated view of
the code. Rebase the branch onto `origin/<default>` — after committing the
working tree (Steps 2–5) if it is dirty, since a dirty tree cannot rebase — and
resolve any conflicts.

### Step 2 — Group related changes

Inspect the diff and split it into focused, logically coherent groups. Each group
becomes one commit:

- One concern per commit (e.g. keep an unrelated refactor out of a feature commit).
- Prefer a few meaningful commits over one catch-all commit when the changes
  address distinct concerns.

### Step 3 — Stage only the relevant files

For the first group, stage just the files that belong to it:

```bash
git add <file> ...
```

- Stage only files relevant to the current commit — do not blanket `git add -A`
  when multiple groups exist.
- Never stage secrets or credentials (`.env`, key files) or large binaries.

### Step 4 — Write the commit

Commit the staged group with a **conventional commit message**:

- Format: `<type>: <short imperative description>`.
- Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `ci`.
- Keep the subject line under 72 characters.
- Focus on *why*, not *what*.
- Append the Co-Authored-By trailer using the model name you are currently
  running as (e.g. `Claude Sonnet 4.6`, `Claude Opus 4.8`, `Claude Haiku 4.5`):

```bash
git commit -m "$(cat <<'EOF'
<type>: <short imperative description>

<optional body explaining why>

Co-Authored-By: Claude <model-name> <noreply@anthropic.com>
EOF
)"
```

### Step 5 — Repeat for remaining groups

If Step 2 produced more than one group, repeat Steps 3–4 for each remaining
group until all intended changes are committed. Leave out any changes that do
not belong in this set of commits.

### Step 6 — Report

Report the commits created (subject lines and hashes) and the branch they are
on. State plainly if any changes were intentionally left uncommitted.

If the user now wants to share this work, point them to the `create-pr` skill
(if available), which pushes the branch and opens a PR (with the required
confirmation gate for those outward-facing actions).

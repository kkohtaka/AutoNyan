---
name: create-pr
description: Create a pull request for the current branch following conventional branch naming and commit conventions
argument-hint: "[branch-name-suffix]"
disable-model-invocation: true
allowed-tools: Bash(git *) Bash(gh *)
---

# Create Pull Request

## Context

Collect the information needed to create the PR.

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

**Commits ahead of the remote default branch:**
```
!`git log $(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || echo origin/HEAD)..HEAD --oneline`
```

**Full diff from the remote default branch:**
```
!`git diff $(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || echo origin/HEAD)...HEAD`
```

**Repository PR template (empty if the repo has none):**
```
!`cat .github/PULL_REQUEST_TEMPLATE.md 2>/dev/null || cat .github/pull_request_template.md 2>/dev/null || echo "(no PR template)"`
```

> These comparisons use the **remote** default-branch ref, never the local one —
> a local `main`/`master` can silently lag behind the remote, which would make
> both the commit list and the diff misleading.

## Your Task

Follow these steps in order. Stop and ask the user if anything is unclear.
PR titles and bodies are written in **English**.

Throughout these steps, `<default>` means the remote default branch resolved in
Context (e.g. `main` or `master`) — never assume a specific name.

### Step 1 — Ensure the work is on a properly named branch

First, fetch the latest remote state:

```bash
git fetch origin
```

**Case A — current branch is NOT suitable** (it is the default branch, or its name does not describe the work):

Create a new branch from the remote default branch and move the relevant changes there:

```bash
git checkout -b <branch-name> origin/<default>
```

- Derive the branch name from the actual diff/changes — specific enough to convey purpose at a glance
- Convention: `feat/`, `fix/`, `refactor/`, `docs/`, `ci/`, `chore/` + lowercase kebab-case description
- If the user passed `$ARGUMENTS`, use it as the branch name (adjusted to fit the convention if needed)
- Cherry-pick any commits from the previous branch that belong to this PR, or re-stage uncommitted changes

**Case B — current branch is already a suitable work branch**:

Stay on the current branch. Rebase onto the remote default branch so the PR has a clean, up-to-date base:

```bash
git rebase origin/<default>
```

Resolve any conflicts before continuing.

### Step 2 — Commit uncommitted changes

If there are uncommitted changes, stage and commit them:

1. Stage only relevant files (avoid `.env`, credentials, large binaries)
2. Write a **conventional commit message**:
   - Format: `<type>: <short imperative description>`
   - Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `ci`
   - Keep the subject line under 72 characters
   - Focus on *why*, not *what*
3. Append the Co-Authored-By trailer using the model name you are currently running as
   (e.g. `Claude Sonnet 4.6`, `Claude Opus 4.8`, `Claude Haiku 4.5`):

```
Co-Authored-By: Claude <model-name> <noreply@anthropic.com>
```

### Step 3 — Push the branch

Pushing is an outward-facing action: confirm with the user before the first
push of a new branch, then run:

```bash
git push -u origin <branch-name>
```

### Step 4 — Write the PR

Analyse all commits in `git log origin/<default>..HEAD` (not just the latest) and draft:

**Title** (under 70 characters):
- Conventional format: `<type>(<optional scope>): <description>`
- Example: `fix(e2e): align timeout settings with service limits`

**Body** — if the repository has a PR template (shown in Context), fill it in.
Otherwise use this structure:

```markdown
## Summary

- <why this change is needed, 1–3 bullets>

## Changes

- <notable change and its reason>

## Test plan

- [ ] <concrete, checkable verification step>
```

Guidelines for the body:
- Remove all `<!-- ... -->` comments from any template output
- Summary bullets should explain the *why*, not just list files changed
- Test plan steps should be concrete and checkable
- If the change touches infrastructure or CI configuration, include how it was
  (or will be) validated — e.g. a plan/dry-run output or a link to the CI run

**Related issue** — only reference an issue when either:
- the **conversation context so far** clearly points to a specific issue this work
  addresses, or
- the **user explicitly asked** to link a particular issue.

Do not search for or guess at issues otherwise; if none is established, skip this section.
When you do reference one:
- Add a `## Related issue` section near the top of the body, just under the title-level content.
- If this PR **resolves** the issue, link it with a closing keyword so the issue is closed on merge:
  ```
  Fixes #<issue-number>
  ```
- If this PR is only **related** (does not close the issue), link it without a closing keyword:
  ```
  Related to #<issue-number>
  ```
- Never include links to AI sessions or any AI-tooling URLs in the PR body.

**Footer** — always append the following footer at the very end of the body so it is
clear the PR was authored with AI assistance. Substitute the model name you are
currently running as (e.g. `Claude Opus 4.8`, `Claude Sonnet 4.6`, `Claude Haiku 4.5`):

```
---

🤖 This pull request was created with the assistance of AI (<model-name>).
```

### Step 5 — Create the PR as a draft

Opening a PR is an outward-facing action: show the user the title and body and
wait for approval, then run:

```bash
gh pr create --draft --title "<title>" --body "$(cat <<'EOF'
<body>
EOF
)"
```

Return the PR URL to the user and ask them to:
1. Review the PR content at the URL above
2. When satisfied, mark it as ready for review — either via the GitHub UI ("Ready for review" button) or with:
   ```bash
   gh pr ready
   ```

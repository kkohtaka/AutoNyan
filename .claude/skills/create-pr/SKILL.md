---
name: create-pr
description: Create a pull request for the current branch following the project's branch naming, commit, and PR conventions
argument-hint: "[branch-name-suffix]"
disable-model-invocation: true
allowed-tools: Bash(git *) Bash(gh *)
---

# Create Pull Request

## Context

Collect the information needed to create the PR.

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

**Commits ahead of master:**
```
!`git log master..HEAD --oneline`
```

**Full diff from master:**
```
!`git diff master...HEAD`
```

## Your Task

Follow these steps in order. Stop and ask the user if anything is unclear.

### Step 1 — Ensure the work is on a properly named branch

First, fetch the latest remote state:

```bash
git fetch origin
```

**Case A — current branch is NOT suitable** (it is `master`, or its name does not describe the work):

Create a new branch from the remote default branch and move the relevant changes there:

```bash
git checkout -b <branch-name> origin/master
```

- Derive the branch name from the actual diff/changes — specific enough to convey purpose at a glance
- Convention: `feat/`, `fix/`, `refactor/`, `docs/`, `ci/`, `chore/` + lowercase kebab-case description
- If the user passed `$ARGUMENTS`, use it as the branch name (adjusted to fit the convention if needed)
- Cherry-pick any commits from the previous branch that belong to this PR, or re-stage uncommitted changes

**Case B — current branch is already a suitable work branch**:

Stay on the current branch. Rebase onto the remote default branch so the PR has a clean, up-to-date base:

```bash
git rebase origin/master
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
   (e.g. `Claude Sonnet 4.6`, `Claude Opus 4.7`, `Claude Haiku 4.5`):

```
Co-Authored-By: Claude <model-name> <noreply@anthropic.com>
```

### Step 3 — Push the branch

```bash
git push -u origin <branch-name>
```

### Step 4 — Find any related issue

Before writing the PR, check whether an open issue relates to this work. Search by
keywords drawn from the diff, the branch name, and the commit messages:

```bash
gh issue list --state open --search "<keywords>"
```

- If you find a related issue, note its number and URL for the PR body (Step 5).
- Decide whether this PR **resolves** the issue (fully addresses it) or is merely
  **related** to it (touches the same area without closing it).
- If no issue is clearly related, do not invent one — skip the issue reference.
- If you are unsure whether an issue is related or whether the PR fully resolves it,
  ask the user.

### Step 5 — Write the PR

Analyse all commits in `git log master..HEAD` (not just the latest) and draft:

**Title** (under 70 characters):
- Conventional format: `<type>(<optional scope>): <description>`
- Example: `fix(e2e): align timeout settings with Cloud Function limits`
- Follow the guidance in the title comment of the PR template below

**Body** — fill in the PR template (English, GitHub-flavoured Markdown):

```
!`cat .github/PULL_REQUEST_TEMPLATE.md`
```

Guidelines for filling in the template:
- Remove all `<!-- ... -->` comments from the output
- Summary bullets should explain the *why*, not just list files changed
- Test plan steps should be concrete and checkable
- If the change touches infrastructure (Terraform), mention `terraform plan` in the test plan
- If the change touches CI workflows, mention checking the Actions run

**Related issue** (only if Step 4 found one):
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
clear the PR was authored with AI assistance:

```
---

🤖 This pull request was created with the assistance of AI.
```

### Step 6 — Create the PR as a draft

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

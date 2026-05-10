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

### Step 1 — Create a branch (if still on master)

If the current branch is `master`, create a new branch before committing:

- Branch naming convention:
  - `feature/<description>` or `feat/<description>` — new functionality
  - `fix/<description>` — bug fix
  - `refactor/<description>` — code restructuring without behavior change
  - `docs/<description>` — documentation only
  - `ci/<description>` — CI/CD pipeline changes
  - `chore/<description>` — maintenance (deps, config)
- Use lowercase kebab-case for the description
- If the user passed `$ARGUMENTS`, use it as the branch name suffix (e.g. `fix/$ARGUMENTS`)

```bash
git checkout -b <branch-name>
```

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

### Step 4 — Write the PR

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

### Step 5 — Create the PR as a draft

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

---
name: create-pr
description: Create a pull request for the current branch following conventional branch naming and commit conventions
argument-hint: "[branch-name-suffix]"
disable-model-invocation: true
allowed-tools: Bash(git *) Bash(gh *) Bash(sed *) Bash(grep *) Bash(cat *) Bash(command *) mcp__github
---

# Create Pull Request

## Context

Collect the information needed to create the PR.

**GitHub route probe (which transport this environment has):**
```
!`command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1 && echo "route A — gh CLI available" || echo "route B — no usable gh CLI; use the GitHub MCP server"`
```

**Repository (`owner/name`), resolved from the git remote:**
```
!`command -v gh >/dev/null 2>&1 && gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || git remote get-url origin 2>/dev/null | sed -E 's#^[a-zA-Z+]+://##; s#^[^/:]*[:/]##; s#\.git$##' | grep -E '^[^/]+/[^/]+$' || echo "(unresolved — pass owner/repo explicitly)"`
```

> On route A this is `gh repo view`, exactly as before. The route-B fallback
> parses the remote URL and is host-agnostic (it works for GitHub Enterprise
> too); it validates the result against `owner/repo` so a remote it cannot parse
> reports `(unresolved)` instead of a plausible-looking wrong value.

**Remote default branch (strip the `origin/` prefix when using it):**
```
!`git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || git ls-remote --symref origin HEAD 2>/dev/null | sed -n 's#^ref: refs/heads/\(.*\)[[:space:]]HEAD$#origin/\1#p' | grep . || echo "(unresolved — run: git remote set-head origin --auto)"`
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
!`D=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || git ls-remote --symref origin HEAD 2>/dev/null | sed -n 's#^ref: refs/heads/\(.*\)[[:space:]]HEAD$#origin/\1#p'); if [ -z "$D" ]; then echo "(default branch unresolved — see above)"; elif ! git rev-parse --verify --quiet "$D" >/dev/null 2>&1; then echo "($D is resolved but not fetched locally — run: git fetch origin, then re-run this comparison)"; else git log "$D"..HEAD --oneline; fi`
```

**Full diff from the remote default branch:**
```
!`D=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || git ls-remote --symref origin HEAD 2>/dev/null | sed -n 's#^ref: refs/heads/\(.*\)[[:space:]]HEAD$#origin/\1#p'); if [ -z "$D" ]; then echo "(default branch unresolved — see above)"; elif ! git rev-parse --verify --quiet "$D" >/dev/null 2>&1; then echo "($D is resolved but not fetched locally — run: git fetch origin, then re-run this comparison)"; else git diff "$D"...HEAD; fi`
```

**Repository PR template (empty if the repo has none):**
```
!`cat .github/PULL_REQUEST_TEMPLATE.md 2>/dev/null || cat .github/pull_request_template.md 2>/dev/null || echo "(no PR template)"`
```

> These comparisons use the **remote** default-branch ref, never the local one —
> a local `main`/`master` can silently lag behind the remote, which would make
> both the commit list and the diff misleading. When the local `origin/HEAD` ref
> is missing — the usual state of the fresh clone a cloud session starts from —
> the fallback asks the remote with `git ls-remote --symref`.
>
> A cloud session's clone fetches only the branches that session needs, so the
> default branch's remote-tracking ref (`origin/<default>`) often does not exist
> locally at load time even though the *name* resolves. The two comparisons
> above therefore check the ref exists and, when it does not, say so and name
> the fix (`git fetch origin`, which Step 1 runs) instead of silently reporting
> no commits and an empty diff.

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

If the default branch could not be resolved in Context, set the local
`origin/HEAD` ref and re-resolve before continuing; if it still fails, stop and
say so rather than guessing `main` or `master`:

```bash
git remote set-head origin --auto
git symbolic-ref --short refs/remotes/origin/HEAD
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

`git push` works in every environment, including a cloud session — only Step 5
below needs a route.

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
wait for approval. The title, the body, and this gate are the same on both
routes — only the call that submits them differs. Use the route the Context
probe reported.

**Route A — `gh` CLI available** (local checkout / devcontainer):

```bash
gh pr create --draft --title "<title>" --body "$(cat <<'EOF'
<body>
EOF
)"
```

**Route B — no `gh`** (Claude Code cloud session): call the GitHub MCP server's
`create_pull_request` tool (the server is observed as `github`; the tool names
are the same whatever the connector is named) with:

- `owner` / `repo` — from the Context repository line
- `title` — the drafted title
- `body` — the drafted body
- `head` — the current branch name
- `base` — `<default>` (the default branch **without** the `origin/` prefix)
- `draft` — `true`

If neither route is available — no `gh`, and no GitHub MCP server in this
session — stop and say so plainly, naming both routes you tried. The branch is
already pushed at this point, so tell the user they can open the PR themselves
from the GitHub UI; never report the PR as created.

Return the PR URL to the user and ask them to:
1. Review the PR content at the URL above
2. When satisfied, mark it as ready for review — via the GitHub UI ("Ready for
   review" button), or with route A's `gh pr ready`, or with route B's
   `update_pull_request` tool passing `pullNumber` and `draft: false`

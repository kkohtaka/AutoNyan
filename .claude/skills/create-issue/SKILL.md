---
name: create-issue
description: File a well-structured GitHub issue for this repository using the repo's issue templates and existing labels
argument-hint: "[short topic, optionally: sub-issue of #N]"
disable-model-invocation: true
allowed-tools: Bash(gh *) Bash(git *)
---

# Create Issue

## Context

Collect the information needed to write a good issue.

**Repository (owner/name):**
```
!`gh repo view --json nameWithOwner -q .nameWithOwner`
```

**Existing labels (use only these — do not invent new ones):**
```
!`gh label list --limit 100`
```

**Available issue templates:**
```
!`ls .github/ISSUE_TEMPLATE/ 2>/dev/null`
```

**General issue template:**
```
!`cat .github/ISSUE_TEMPLATE/general.md 2>/dev/null`
```

**New-skill issue template:**
```
!`cat .github/ISSUE_TEMPLATE/skill.md 2>/dev/null`
```

**Current branch and recent commits (context, if the issue relates to current work):**
```
!`git branch --show-current && git log --oneline -10`
```

## Your Task

Follow these steps in order. Stop and ask the user if anything is unclear.
Issue titles and bodies are written in **English**.

### Step 1 — Understand the request

From `$ARGUMENTS` and the conversation, determine the issue's subject. If the
request is vague, ask the user before drafting. If the issue is a sub-issue of a
tracking issue, note the parent issue number.

### Step 2 — Choose the template

Pick the template from `.github/ISSUE_TEMPLATE/` that best fits:

- `skill.md` — developing or tracking a Claude Code agent skill.
- `general.md` — everything else (bug, feature, docs, refactor, infra).

Use the template's section structure as-is so manually-filed and skill-filed
issues stay consistent. Strip the YAML frontmatter and all `<!-- ... -->`
comments from the body you submit.

### Step 3 — Choose labels

Pick labels **only from the existing label list** in Context. Match on intent:

- `enhancement` — new feature/skill/capability
- `bug` — something is broken
- `documentation` — docs-only change
- `terraform` / `github-actions` / `npm` / `dependencies` — area tags
- `question` — needs discussion before work

Do not create new labels. The `skill.md` template already presets
`enhancement`. If nothing fits, propose the closest match and confirm.

### Step 4 — Draft the body

Fill the chosen template. Guidelines:

- Reference files and code precisely (`src/functions/...`, `terraform/...`).
- Acceptance criteria must be concrete and checkable.
- For skill issues, keep the acceptance criteria aligned with
  `.claude/skills/CONVENTIONS.md` (the template already mirrors it).

### Step 5 — Confirm before filing

Show the user the proposed **title, labels, body, and parent issue (if any)**.
Wait for explicit approval. Filing an issue is an outward-facing action — do not
run `gh issue create` until the user confirms.

### Step 6 — Create the issue

Title: concise. For a new-skill issue use the `skill(<name>): ...` prefix.

```bash
gh issue create --title "<title>" --label "<label1>" --label "<label2>" --body "$(cat <<'EOF'
<body>
EOF
)"
```

### Step 7 — Link to the parent tracking issue (if applicable)

If this is a sub-issue, link it to the parent so it appears under the parent's
sub-issue list. The REST sub-issues endpoint takes the child's **REST database
id** (not the issue number, not the GraphQL node id):

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
CHILD_DB_ID=$(gh issue view <NEW_ISSUE_NUMBER> --json id -q .databaseId 2>/dev/null \
  || gh api "repos/$REPO/issues/<NEW_ISSUE_NUMBER>" -q .id)

gh api --method POST "repos/$REPO/issues/<PARENT_NUMBER>/sub_issues" \
  -F sub_issue_id="$CHILD_DB_ID"
```

If the REST call fails, fall back to the GraphQL `addSubIssue` mutation (uses
GraphQL node ids), and if that is also unavailable, update the parent's task
list so the relationship is still tracked.

### Step 8 — Report

Return the new issue URL and (if linked) confirm it shows under the parent's
sub-issues. Note the labels applied.

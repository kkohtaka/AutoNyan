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

**Available issue templates (empty if the repo has none):**
```
!`ls .github/ISSUE_TEMPLATE/ 2>/dev/null || echo "(no issue templates)"`
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

If the repository has issue templates (listed in Context), read the candidates
with `cat .github/ISSUE_TEMPLATE/<file>` and pick the one that best fits the
issue's subject. Use the template's section structure as-is so manually-filed
and skill-filed issues stay consistent. Strip the YAML frontmatter and all
`<!-- ... -->` comments from the body you submit. Honor any labels the
template's frontmatter presets.

If the repository has no templates, use this structure:

```markdown
## Summary

## Background / Motivation

## Proposal / Tasks

## Acceptance criteria

- [ ] <a verifiable condition>
```

### Step 3 — Choose labels

Pick labels **only from the existing label list** in Context. Match on intent —
e.g. an `enhancement`-like label for new capabilities, a `bug`-like label for
defects, a `documentation`-like label for docs-only changes, and any area tags
the repository maintains.

Do not create new labels. If nothing fits, propose the closest match and
confirm; filing with no labels is acceptable when the repo has none that apply.

### Step 4 — Draft the body

Fill the chosen structure. Guidelines:

- Reference files and code precisely (paths, function names).
- Acceptance criteria must be concrete and checkable.
- Link related issues/PRs/commits where they exist.

### Step 5 — Confirm before filing

Show the user the proposed **title, labels, body, and parent issue (if any)**.
Include the Claude Code attribution footer (see Step 6) in the body you show, so
the user reviews exactly what will be filed. Wait for explicit approval. Filing
an issue is an outward-facing action — do not run `gh issue create` until the
user confirms.

### Step 6 — Create the issue

Title: concise, matching any title convention the chosen template prescribes.

Always append the Claude Code attribution footer as the **last line** of the
submitted body, separated from the content above by a blank line, so readers can
tell at a glance the issue was filed by the agent:

```
🤖 Created by Claude Code via the create-issue skill
```

This marker is added by the skill at creation time only — do **not** add it to
the repository's issue templates, so manually-filed issues remain unmarked. The
marker is **body-only**: do not apply an attribution label.

```bash
gh issue create --title "<title>" --label "<label1>" --label "<label2>" --body "$(cat <<'EOF'
<body>

🤖 Created by Claude Code via the create-issue skill
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

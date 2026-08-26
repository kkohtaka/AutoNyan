---
name: create-issue
description: File a well-structured GitHub issue for this repository using the repo's issue templates and existing labels
argument-hint: "[short topic, optionally: sub-issue of #N]"
disable-model-invocation: true
allowed-tools: Bash(gh *) Bash(git *) Bash(sed *) Bash(grep *) Bash(cat *) Bash(ls *) Bash(command *) Bash(curl *) mcp__github
---

# Create Issue

## Context

Collect the information needed to write a good issue.

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

**Existing labels (use only these — do not invent new ones):**
```
!`command -v gh >/dev/null 2>&1 && gh label list --limit 100 2>/dev/null || echo "(unavailable on this route — fetch them in Step 3)"`
```

> The repository is read from the git remote rather than `gh repo view`, and the
> label listing is guarded, so this skill loads cleanly in an environment
> without the `gh` CLI instead of failing before it starts.

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

If the Context label listing reported `(unavailable on this route)`, fetch the
label set before choosing. **The GitHub MCP server has no tool that enumerates a
repository's labels** — `get_label` reads one label by exact name, and
`issue_read` (`method: "get_labels"`) reads the labels of one issue; neither
lists the repository's set. Use the REST endpoint directly, which a cloud
session's egress proxy authenticates:

```bash
curl -s "https://api.github.com/repos/<owner>/<repo>/labels?per_page=100" \
  | grep -E '^\s*"(name|description)":'
```

If that call fails too, stop and ask the user for the label names rather than
inventing them. Whichever way you obtained the set, confirm each label you
intend to apply with `get_label` before Step 6 — a label name the repository
does not have makes the whole `issue_write` call fail.

Pick labels **only from that label list**. Match on intent —
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
an issue is an outward-facing action — do not file it on either route until the
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

The title, labels, body, and footer are the same on both routes — only the call
that submits them differs. Use the route the Context probe reported.

**Route A — `gh` CLI available** (local checkout / devcontainer):

```bash
gh issue create --title "<title>" --label "<label1>" --label "<label2>" --body "$(cat <<'EOF'
<body>

🤖 Created by Claude Code via the create-issue skill
EOF
)"
```

**Route B — no `gh`** (Claude Code cloud session): call the GitHub MCP server's
`issue_write` tool (the server is observed as `github`; the tool names are the
same whatever the connector is named) with `method: "create"`, `owner`, `repo`,
`title`, `body` (footer included), and `labels` as an array of label names.

> A comment or issue body submitted from a cloud session gets
> `_Generated by [Claude Code](https://claude.ai/code)_` appended **server-side**.
> The attribution footer above is still the last line *you* write, but it will
> not be the last line of the published body — do not match on "last line" when
> reading a body back.

If neither route is available — no `gh`, and no GitHub MCP server in this
session — stop and say so plainly, naming both routes you tried, and hand the
user the drafted title/labels/body to file themselves. Never report an issue as
filed when it was not.

### Step 7 — Link to the parent tracking issue (if applicable)

If this is a sub-issue, link it to the parent so it appears under the parent's
sub-issue list. Both routes take the child's **REST database id** (the `id`
field — not the issue number, and not the GraphQL node id).

**Route A — `gh` CLI available** (local checkout / devcontainer):

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
CHILD_DB_ID=$(gh issue view <NEW_ISSUE_NUMBER> --json id -q .databaseId 2>/dev/null \
  || gh api "repos/$REPO/issues/<NEW_ISSUE_NUMBER>" -q .id)

gh api --method POST "repos/$REPO/issues/<PARENT_NUMBER>/sub_issues" \
  -F sub_issue_id="$CHILD_DB_ID"
```

**Route B — no `gh`** (Claude Code cloud session): call the GitHub MCP server's
`sub_issue_write` tool with `method: "add"`, `owner`, `repo`,
`issue_number` = the **parent** issue number, and `sub_issue_id` = the child's
database id **as a number**.

Getting that id is the awkward part on this route: `issue_read`
(`method: "get"`) does **not** return an `id` field, and neither `list_issues`
nor `search_issues` can select one, so if the `issue_write` response of Step 6
does not carry a numeric `id`, no MCP tool will give it to you. Read it from
REST instead:

```bash
curl -s "https://api.github.com/repos/<owner>/<repo>/issues/<CHILD_NUMBER>" \
  | grep -m1 -E '^\s*"id":'
```

Pass that number — not the issue number, and not a `LA_…`/`I_…` GraphQL node
id — as `sub_issue_id`.

If the linking call fails on either route, say so and update the parent's task
list instead, so the relationship is still tracked — and report that the
sub-issue link itself was not created.

### Step 8 — Report

Return the new issue URL and (if linked) confirm it shows under the parent's
sub-issues. Note the labels applied.

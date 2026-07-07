# Skill Authoring Conventions

This document is the single source of truth for how agent skills in this
repository are written. Every skill under `.claude/skills/<name>/SKILL.md` MUST
follow it. When an existing skill and this document disagree, this document
wins and the skill should be updated.

**Exception — APM-managed skills.** The `commit`, `create-pr`, `create-issue`,
and `debug-ci` directories are deployed from the
[kkohtaka/agent-skills](https://github.com/kkohtaka/agent-skills) package and
follow that package's own conventions. Do not edit them here (see the
"APM-managed skills" note in `CLAUDE.md`); this document governs only the
repository-owned skills.

## 1. File layout

- One skill per directory: `.claude/skills/<name>/SKILL.md`.
- `<name>` is lowercase kebab-case and matches the `name:` frontmatter key.
- Supporting files (scripts, templates) live next to `SKILL.md` in the same
  directory; reference them by relative path.

## 2. Frontmatter

Required keys, in this order:

```yaml
---
name: <kebab-case, matches the directory>
description: <one sentence, imperative, says what the skill does and when to use it>
argument-hint: "[optional-arg]"        # omit if the skill takes no arguments
disable-model-invocation: <true|false> # see §4.2
allowed-tools: Bash(git *) Bash(gh *)  # see §4.1
---
```

- `description` is what the model matches on for auto-invocation — keep it
  precise and free of internal jargon.
- `allowed-tools` is a space-separated list. Scope `Bash` with a prefix matcher
  (`Bash(npm *)`, `Bash(git *)`, `Bash(gh *)`, `Bash(terraform *)`,
  `Bash(gcloud *)`). Never use a bare unscoped `Bash`.

## 3. Body structure

Two top-level sections, in this order:

### `## Context`

Gather the state the skill needs using `!`-inlined command blocks:

````markdown
**Working tree status:**
```
!`git status --short`
```
````

- **Read-only commands only.** Anything that mutates the repo, the cloud, or
  remote state belongs in a numbered step, never in a Context block — Context
  runs automatically every time the skill loads.
- Inline read-only file contents the skill depends on with `!`cat`` (templates,
  config) so the model sees them without an extra tool round-trip.

### `## Your Task`

- Open with: `Follow these steps in order. Stop and ask the user if anything is unclear.`
- Use numbered `### Step N — <imperative summary>` headings.
- Each step is concrete and checkable; show the exact commands to run.

## 4. Cross-cutting policies

### 4.1 Least privilege

List only the tools the skill actually uses, scoped as narrowly as possible. If
a skill needs to write files it relies on the `Write`/`Edit` tools (formatting
of those files is handled outside the skill — see §4.5); declare them
explicitly rather than shelling out.

### 4.2 Model invocation (`disable-model-invocation`)

- **`true` (explicit invocation only)** — any skill with side effects on the
  repo, the cloud, or external services: it commits, pushes, opens PRs/issues,
  runs `terraform apply`, deploys, or merges. The user must invoke these by
  name.
- **`false` (model may auto-invoke)** — read-only / advisory skills that only
  run, inspect, and report without mutating anything.

A skill that both inspects and fixes counts as having side effects → `true`.

### 4.3 Confirmation gates

Outward-facing or irreversible actions MUST stop and confirm with the user
before executing, even within an explicitly invoked skill. This always
includes: `git push`, opening a PR or issue, `terraform apply`, any deploy, and
merging a PR. State exactly what will happen, then wait.

### 4.4 Delegation, not duplication

Skills compose by name rather than re-implementing shared behavior. When a step
is "what another skill already does," say so and point to that skill instead of
copying its steps.

### 4.5 Formatting is not a fix step

The PostToolUse auto-format hook runs Prettier on TypeScript/JavaScript files
when they are written or edited. Other file types are formatted via
`npm run format` as part of the general workflow, not by individual skills. Do
not add formatting *fix* steps (`npm run format`, `terraform fmt`) to a skill.
A check-and-report skill may still verify that formatting is clean (e.g. as one
of its pass/fail checks).

### 4.6 Honest reporting

Report failures, skipped steps, and partial results plainly in the skill's
output. Never present an unverified or failed step as done.

### 4.7 Re-runnability

Design steps so the skill can be re-run after a mid-way failure without
corrupting state (check-before-create, detect already-committed work, etc.).

### 4.8 Language

Skill Markdown (`SKILL.md`) is written in **English**, consistent with
`CLAUDE.md`. Artifacts a skill produces (issues, PRs, commits) follow the
convention documented in that skill.

## 5. Shared "fix loop" for run-and-fix skills

Skills that run a check command and then fix what it reports share one
structure; implement them the same way:

1. **Run** the check command and capture output.
2. **Interpret** failures (group by file / workspace / rule).
3. **Fix** the smallest change that addresses each failure — do not weaken
   thresholds or disable rules to pass.
4. **Re-run** until clean, or stop and report if a failure needs a human
   decision.

## 6. Authoring checklist

Before considering a skill done, verify:

- [ ] Frontmatter follows §2 (keys, order, scoped `allowed-tools`).
- [ ] `## Context` uses read-only commands only (§3, §4.5).
- [ ] `disable-model-invocation` set per §4.2.
- [ ] Confirmation gates present for any outward/irreversible action (§4.3).
- [ ] No duplicated behavior; delegations point to sibling skills (§4.4).
- [ ] Verified by manual invocation, with reproduction steps recorded.

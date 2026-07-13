---
name: lint-fix
description: Run the project's linters (npm run lint covering TypeScript, YAML, JSON, Terraform, and shell), interpret the failures, fix them, and re-run until clean
argument-hint: "[optional: ts|terraform to scope the run]"
disable-model-invocation: false
allowed-tools: Read Edit Bash(npm *) Bash(terraform *)
---

# Lint and Fix

This is the lint half of the shared run-and-fix loop in
`.claude/skills/CONVENTIONS.md` §5. It runs `npm run lint`, interprets the
failures, applies the smallest fixes that resolve them, and re-runs until clean.

## Context

**Working tree status (so you can tell pre-existing changes from your fixes):**
```
!`git status --short`
```

**Lint scripts that `npm run lint` chains (read from package.json):**
```
!`node -e "const s=require('./package.json').scripts; ['lint','lint:ts','lint:yaml','lint:json','lint:terraform','lint:sh'].forEach(k=>s[k]&&console.log(k+': '+s[k]))"`
```

**Function workspaces (a TS lint failure is reported per workspace):**
```
!`ls src/functions 2>/dev/null && echo '--- shared ---' && ls -d src/shared 2>/dev/null`
```

> Note: `npm run lint` is **not** read-only — `lint:json` runs `eslint --fix`
> and the per-workspace `lint:ts` may auto-fix. That is why it is run in a step
> below, never in this Context block (CONVENTIONS.md §3).

## Your Task

Follow these steps in order. Stop and ask the user if anything is unclear.

### Step 1 — Run the linters and capture output

Run the full lint, or a focused variant if `$ARGUMENTS` scopes it:

```bash
npm run lint              # default: ts + yaml + json + terraform + sh
# npm run lint:ts         # if $ARGUMENTS is "ts"
# npm run lint:terraform  # if $ARGUMENTS is "terraform"
```

`npm run lint` runs the sub-lints in sequence and stops at the first failing
one. After fixing that area, re-run the full `npm run lint` so later sub-lints
(which the first failure masked) also get checked.

### Step 2 — Interpret the failures

Group what failed by sub-lint and then by file / workspace / rule:

- **`lint:ts`** — ESLint + `tsc` per workspace. Failures name the workspace,
  file, line, and rule (e.g. `@typescript-eslint/no-unused-vars`) or a TS error
  code (`TSxxxx`).
- **`lint:yaml`** — `yamllint` on `.github/`; failures name the file, line, and
  rule.
- **`lint:json`** — `eslint --fix` on `**/*.json`; this auto-fixes most issues,
  so a remaining failure is a real parse/structure error to fix by hand.
- **`lint:terraform`** — `terraform fmt -check` **then** `tflint`. Distinguish
  the two: a `fmt` failure is formatting-only (see Step 3), a `tflint` failure
  is a real lint rule to fix.
- **`lint:sh`** — `shellcheck` on `scripts/*.sh`; failures name the file, line,
  and `SCxxxx` code.

### Step 3 — Fix the smallest change per failure

Apply the minimal edit that resolves each failure. Never disable a rule, add a
blanket ignore, or weaken config just to pass — if a failure looks like it needs
a human decision (an intentional `any`, a genuinely ambiguous rule), stop and
report it instead of suppressing it.

**Formatting boundary (CONVENTIONS.md §4.5):** do not hand-edit purely to satisfy
a formatter, and do not add `npm run format` / `terraform fmt -w` as a fix step.
- TypeScript/JavaScript formatting is handled by the PostToolUse auto-format hook
  when you `Edit` those files.
- A `terraform fmt -check` failure is formatting-only: report that it is resolved
  by the project's format workflow (`npm run format` / `terraform fmt`) and let
  the user run it, rather than fixing it inside this skill.

### Step 4 — Re-run until clean

Re-run `npm run lint` (the full chain, even if you scoped Step 1) and repeat
Steps 2–3 until it exits cleanly, or until the only thing left is a failure that
needs a human decision.

### Step 5 — Report

Summarise honestly (CONVENTIONS.md §4.6):

- The final `npm run lint` result (clean, or what still fails).
- What you fixed, grouped by sub-lint / file.
- Anything you deliberately did **not** fix (formatting deferred to the format
  workflow, or rule violations that need a human decision), and why.

This skill does not commit or push — delegate that to `/commit` or `/create-pr`
(CONVENTIONS.md §4.4).

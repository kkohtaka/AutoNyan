---
name: quality-gate
description: Run the project's full pre-commit quality checks (lint, formatting verification, and coverage-gated tests) and report a per-check pass/fail verdict without editing any files
disable-model-invocation: false
allowed-tools: Bash(npm *) Bash(terraform *)
---

# Quality Gate

Judge-only counterpart to `lint-fix` and `test-fix`. Runs `npm run lint`, a
read-only formatting check, and `npm run test:coverage`, then reports a
per-check pass/fail verdict. **Never edits, commits, or pushes anything.**
Mirrors the "Pre-Commit Requirements" gates documented in `CLAUDE.md`.

## Context

**Working tree status (pre-existing changes vs. clean):**

```
!`git status --short`
```

**Quality-check scripts available (lint, format, test):**

```
!`node -e "const s=require('./package.json').scripts; ['lint','format','test:coverage'].forEach(k=>s[k]&&console.log(k+': '+s[k]))"`
```

**Format sub-scripts (used to derive check-only equivalents):**

```
!`node -e "const s=require('./package.json').scripts; ['format:ts','format:yaml','format:json','format:terraform','format:sh'].forEach(k=>s[k]&&console.log(k+': '+s[k]))"`
```

**Jest coverage thresholds (the bar test:coverage enforces):**

```
!`grep -A8 coverageThreshold jest.config.js`
```

> Note: `npm run lint`, the formatting checks, and `npm run test:coverage` can be
> slow or produce output — they belong in numbered steps below, never here
> (CONVENTIONS.md §3).

## Your Task

Follow these steps in order. Stop and ask the user if anything is unclear.

### Step 1 — Run the linter

```bash
npm run lint
```

Capture whether the command exits cleanly (exit code 0) or fails. If it fails,
keep the relevant error lines — you will include them in the final report.

Record: **lint — PASS** or **lint — FAIL**.

### Step 2 — Run the formatting check (read-only)

Run each formatter in check-only mode. These commands verify but never write:

```bash
# TypeScript / JavaScript
npm run format:ts -- --check 2>&1 || true

# YAML
npm run format:yaml -- --check 2>&1 || true

# JSON
npm run format:json -- --check 2>&1 || true

# Shell scripts
npm run format:sh -- -d 2>&1 || true

# Terraform (already check-only in the format script)
terraform fmt -check=true -recursive terraform/ 2>&1 || true
```

> `npm run format:ts -- --check` passes `--check` to prettier, turning
> `--write` into a dry-run that lists unformatted files and exits non-zero.
> `npm run format:sh -- -d` passes `-d` (diff mode) to shfmt instead of
> `-w` (write). `terraform fmt -check=true` is already read-only.

Collect each sub-check result. The overall formatting check passes only if all
five sub-checks pass.

Record: **format — PASS** or **format — FAIL** (and which sub-checks failed).

### Step 3 — Run the tests with coverage thresholds

```bash
npm run test:coverage
```

This is the threshold-enforcing variant that mirrors CI and the pre-push hook.
`npm test` (without coverage) is not sufficient — it skips the coverage gate.

Capture pass/fail and any coverage shortfall lines from the output.

Record: **test:coverage — PASS** or **test:coverage — FAIL**.

### Step 4 — Report the verdict

Print a verdict table, one row per check:

| Check         | Result      | Notes                               |
| ------------- | ----------- | ----------------------------------- |
| lint          | PASS / FAIL | key error lines if failed           |
| format        | PASS / FAIL | which sub-checks failed             |
| test:coverage | PASS / FAIL | failing suite / threshold shortfall |

Then state the **overall result**:

- **All checks passed.** The working tree is clean and ready to commit.
- **One or more checks failed.** Do not commit until failures are resolved.

On failure, point to the remediation skills rather than fixing inline:

- Lint failures → run `/lint-fix`
- Formatting failures → run `npm run format` (or the per-type sub-command)
- Test / coverage failures → run `/test-fix`

This skill does not edit files, commit, or push. All fixes are out of scope
(CONVENTIONS.md §4.4).

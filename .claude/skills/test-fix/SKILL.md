---
name: test-fix
description: Run the project's tests with coverage, interpret failures, and fix code or add tests until tests pass and Jest coverage thresholds are satisfied
argument-hint: "[workspace-name]"
disable-model-invocation: true
allowed-tools: Read Edit Bash(npm *)
---

# Test Fix

## Context

Gather the state the skill needs to run and interpret the tests.

**Function workspaces (each runs its own test suite):**
```
!`ls src/functions/`
```

**Jest coverage thresholds (the bar tests must meet, mirrors CI):**
```
!`grep -A8 coverageThreshold jest.config.js`
```

**Test scripts available at the repo root:**
```
!`grep -E '"test' package.json`
```

## Your Task

Follow these steps in order. Stop and ask the user if anything is unclear.

This is the test half of the shared run-and-fix loop in
`.claude/skills/CONVENTIONS.md` §5. Linting is **not** in scope — delegate it to
the `lint-fix` skill. Judging tests without fixing is **not** in scope — that is
the `quality-gate` skill. Committing and pushing are out of scope — delegate to
the `commit` and `create-pr` skills.

### Step 1 — Run the tests with coverage

Run the coverage-gated test command so results match CI thresholds. Do **not**
use bare `npm test`, which skips the coverage gate:

```bash
npm run test:coverage
```

If `$ARGUMENTS` names a single workspace, scope the run to it for a faster loop:

```bash
npm run test:coverage --workspace=src/functions/<workspace-name>
```

Capture the full output, including the per-file coverage table.

### Step 2 — Interpret the failures

Read the output and group failures so each can be fixed deliberately:

- **By workspace / suite:** which `src/functions/*` workspace and which test
  file reported the failure.
- **By kind:** a failing assertion (behaviour is wrong) vs. a coverage shortfall
  (a branch, function, line, or statement falls below the threshold shown in
  Context).

If the run is clean and every workspace meets the thresholds, skip to Step 5.

### Step 3 — Fix the smallest change per failure

For each grouped failure, make the minimal correct change:

- **Failing assertion:** fix the implementation under test, or correct the test
  if the test itself encodes the wrong expectation. Read the relevant
  `src/functions/<workspace>/index.ts` and `index.test.ts` before editing.
- **Coverage shortfall:** add tests that exercise the uncovered branch or path
  (success and error paths, per the Testing Pattern in `CLAUDE.md`).

Never weaken the coverage thresholds in `jest.config.js`, delete or loosen
assertions, or skip tests to make the run pass. If a failure needs a human
decision (ambiguous expected behaviour, a real product bug), stop and report it
rather than guessing.

### Step 4 — Re-run until clean

Re-run the same command from Step 1 (scoped to the workspace you changed for
speed, then unscoped for a final full pass):

```bash
npm run test:coverage
```

Repeat Steps 2–4 until the full suite passes and every workspace meets the
coverage thresholds, or until a remaining failure needs a human decision.

### Step 5 — Report

Summarise honestly:

- Which workspaces / suites failed and what each fix was (code change vs. added
  test).
- The final result of `npm run test:coverage` (all green, or what still fails
  and why it needs a human).
- Note that linting is handled separately by the `lint-fix` skill.

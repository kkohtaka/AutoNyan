---
name: add-function
description: Scaffold and wire a new Cloud Function end to end — its npm workspace, Terraform module, main.tf wiring, and CI matrix entries — following the project's Adding a New Function Workflow
argument-hint: "<function-name> [pubsub|storage]"
disable-model-invocation: false
allowed-tools: Read Write Edit Bash(npm *)
---

# Add Function

Scaffolds a new Cloud Function across all the places this repo expects one: the
`src/functions/<name>/` npm workspace, the `terraform/modules/<name>/` module,
the wiring in `terraform/main.tf`, and the CI matrices in
`.github/workflows/test.yml`. The shape of each artifact is discovered from the
existing functions in Context — adapt an existing one rather than inventing a
layout.

## Context

Inspect how this repo is actually organized so the new function matches it.

**Existing function workspaces (copy the layout of one of these):**
```
!`ls src/functions/`
```

**Files in a representative workspace (this is the file set to scaffold):**
```
!`ls src/functions/$(ls src/functions/ | head -1)/`
```

**Workspace package.json (note the `test` script wires to the root jest config — there is no per-workspace jest.config.js):**
```
!`cat src/functions/$(ls src/functions/ | head -1)/package.json`
```

**Existing Terraform modules (copy the layout of one of these):**
```
!`ls terraform/modules/`
```

**Files in a representative Terraform module:**
```
!`ls terraform/modules/$(ls terraform/modules/ | head -1)/`
```

**How modules are wired in main.tf (module blocks and pipeline connections):**
```
!`grep -n "^module" terraform/main.tf`
```

**CI matrices to update in test.yml (both lint-functions and test-functions):**
```
!`grep -n "function:" -A 12 .github/workflows/test.yml`
```

## Your Task

Follow these steps in order. Stop and ask the user if anything is unclear.

### Step 1 — Determine the function name and trigger type

Read the new function name and trigger type from `$ARGUMENTS`
(`<function-name> [pubsub|storage]`). The name is lowercase kebab-case and is
used identically for the workspace directory, the Terraform module directory,
the module block name (underscored), and the CI matrix entries.

- If the name is missing, ask the user for it.
- If the trigger type is missing or is neither `pubsub` nor `storage`, ask which
  it is — it determines the CloudEvent type, the event trigger, and the IAM the
  function needs.
- If `src/functions/<name>/` or `terraform/modules/<name>/` already exists, stop
  and report; do not overwrite existing work.

### Step 2 — Scaffold the function workspace

Read a representative existing workspace's files, then create
`src/functions/<name>/` by adapting them. Create:

- `index.ts` — a CloudEvent handler. For `pubsub` use the
  `CloudEvent<MessagePublishedData>` + `parsePubSubEvent` shape; for `storage`
  use the `CloudEvent<StorageObjectData>` shape. Use `autonyan-shared` for
  parsing, validation, and error handling — do not reimplement them. The
  exported function name must match the Terraform `entry_point` you set in
  Step 3.
- `index.test.ts` — at least one success-path and one error-path test, with all
  GCP services mocked, following the existing test pattern.
- `package.json` — same scripts as the sibling workspace, with the
  `--testPathPatterns` / coverage globs retargeted to `<name>`. Keep the `test`
  script pointing at the root `jest.config.js` (do **not** add a per-workspace
  jest config — the repo does not use one).
- `tsconfig.json` — copied from the sibling workspace.

The root `package.json` discovers workspaces via the `src/functions/*` glob, so
no root edit is needed.

### Step 3 — Scaffold the Terraform module

Create `terraform/modules/<name>/` (`main.tf`, `variables.tf`, `outputs.tf`) by
adapting an existing module that uses the same trigger type. Follow the module
pattern:

- A dedicated service account.
- **Least-privilege** IAM — grant only the roles this trigger and business logic
  require (e.g. storage object viewer for the bucket it reads, pubsub publisher
  for the next stage). Do not over-grant.
- A `google_cloudfunctions2_function` whose `entry_point` matches the exported
  function name from Step 2 and whose `event_trigger` matches the chosen trigger
  type (PubSub topic, or Storage object-finalized).
- Inputs in `variables.tf` and any values other stages need (e.g. `topic_name`)
  in `outputs.tf`.

### Step 4 — Wire the module into main.tf and the pipeline

Add a `module "<name_underscored>"` block to `terraform/main.tf`, passing the
standard inputs (`project_id`, `environment`, `region`,
`function_bucket_name`, …) the same way the sibling modules do. Connect it to
the pipeline by passing the upstream/downstream topic or bucket references
(e.g. `next_stage_topic_name = module.<other>.topic_name`) so the new stage is
reachable. Add a `depends_on` if it touches Firestore or another resource that
must exist first.

### Step 5 — Add the function to both CI matrices

Add `<name>` to **both** the `lint-functions` and `test-functions` `function:`
matrices in `.github/workflows/test.yml`, keeping each list **alphabetical**.
Both matrices must stay in sync.

### Step 6 — Build, test, and report

Run the build and the new workspace's tests:

```bash
npm run build
npm test --workspace=src/functions/<name>
```

Then report what was created and edited, and **remind the user to review
`terraform plan` before applying** — this skill does not run `terraform apply`
or deploy.

If `npm run build` or the tests fail on the scaffold, fix only what is needed to
make the scaffold valid. For broader lint or test failures, delegate to the
`lint-fix` and `test-fix` skills rather than fixing inline here. Do not weaken
thresholds or disable rules.

### Step 7 — Hand off

This change set adds files under `src/functions/*` and updates the
`.github/workflows/test.yml` matrices, so it already satisfies the
`docs-sync-check` rule's expectation (also update the README pipeline section if
the new stage changes the documented flow).

Committing and opening a PR are out of scope here — hand off to the `commit` and
`create-pr` skills. Running `terraform apply` and deploying are likewise out of
scope.

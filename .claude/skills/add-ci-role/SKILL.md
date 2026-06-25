---
name: add-ci-role
description: Update the GitHub Actions service-account IAM when Terraform starts managing a new GCP service — add the minimum required role to the ROLES array in scripts/setup-github-actions.sh and CLAUDE.md, then optionally apply on confirmation
argument-hint: "[gcp-service-or-role]"
disable-model-invocation: true
allowed-tools: Read Edit Bash(npm *)
---

# Add CI Role

Codifies the "GitHub Actions Service Account Permissions" maintenance checklist
in `CLAUDE.md`: when Terraform begins managing a new GCP service, add the minimum
required role to the `ROLES` array in `scripts/setup-github-actions.sh`, update
the "Services currently configured" list in `CLAUDE.md`, and — only on explicit
confirmation — run `npm run setup:github-actions` to apply the IAM change. It does
not author the Terraform change that introduces the service (that is the infra
workflow), and broader doc-gap detection is delegated to `docs-sync-check`
(CONVENTIONS.md §4.4).

## Context

**Current `ROLES` array in scripts/setup-github-actions.sh:**
```
!`awk '/ROLES=\(/,/^\)/' scripts/setup-github-actions.sh`
```

**"Services currently configured" in CLAUDE.md:**
```
!`grep -n -A 12 "Services currently configured" CLAUDE.md`
```

## Your Task

Follow these steps in order. Stop and ask the user if anything is unclear.

### Step 1 — Determine the minimum required role

From `$ARGUMENTS`, identify the new GCP service (or the explicit role) that
Terraform now manages. Determine the **minimum** IAM role(s) required for that
service per Google Cloud documentation. Apply least privilege (CLAUDE.md): add
only roles for services Terraform actually manages, and **never** reintroduce a
`roles/compute.*` role — those are deliberately excluded and actively revoked. If
the right minimum role is unclear, stop and confirm with the user.

### Step 2 — Add the role to the ROLES array

Edit `scripts/setup-github-actions.sh` and add the role to the `ROLES` array,
matching the existing entry format (tab-indented, quoted). Do not touch
`DEPRECATED_ROLES`.

### Step 3 — Update CLAUDE.md

Add the new service to the "Services currently configured" list in `CLAUDE.md` so
the documentation stays in sync with the script.

### Step 4 — Confirmation gate before applying IAM

STOP. State exactly which role will be granted to the GitHub Actions service
account and wait for the user's explicit confirmation before running
`npm run setup:github-actions` (CONVENTIONS.md §4.3) — it mutates real IAM
bindings. On approval:

```bash
npm run setup:github-actions
```

If the user declines, leave the edits in place for a later manual run and say so.

### Step 5 — Remind to verify CI access

Remind the user to verify the Terraform plan workflow can access the new service
(check the plan workflow succeeds and review the Actions logs for permission
errors). Report honestly what was edited and whether the IAM change was applied
(CONVENTIONS.md §4.6).

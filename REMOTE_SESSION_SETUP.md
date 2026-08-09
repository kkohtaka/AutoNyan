# Remote Session Setup

How to bring an ephemeral machine — a Claude Code on the web cloud session, or
any box that is not the devcontainer — to the point where it can lint, test,
and build, and how it reads and deploys Google Cloud resources without ever
holding a Google Cloud credential.

The devcontainer image already contains everything below; this document is
for environments that start with only Node.js and a fresh clone.

## 1. Access model

This repository keeps its architecture unchanged (Terraform-managed Cloud
Functions gen2, the existing GitHub Actions pipeline) but a cloud session
reaches Google Cloud differently than the devcontainer does, because cloud
environments have **no dedicated secrets store** — environment variables are
readable by anyone who uses the environment, and the environment dialog warns
against putting credentials there. A Google Cloud service account key must
never be placed in a cloud session's `GOOGLE_APPLICATION_CREDENTIALS` or any
other environment variable.

Instead:

- **Reading Google Cloud** (e.g. Cloud Logging) goes through Google's managed
  remote MCP servers, authenticated with OAuth 2.0 and IAM rather than a key.
  Connector traffic travels through Anthropic's servers rather than the
  session's own network, so this needs no network allowlist entry and puts no
  credential in the session VM.
- **Deployment** is delegated to the existing GitHub Actions pipeline
  (`.github/workflows/deploy.yml`), which already authenticates with Workload
  Identity Federation and stores no keys. A cloud session starts and follows a
  run rather than running `terraform apply` itself.
- **Terraform plan review** reads the plan `.github/workflows/terraform-plan.yml`
  already posts as a pull request comment, rather than running
  `terraform plan` locally (which needs the GCS state backend and the
  gitignored `terraform/environments/*.tfvars` / `*.backend.hcl`).

A consequence: a cloud session never runs `terraform init`, `plan` or `apply`,
so it never needs `terraform/environments/staging.tfvars` or
`staging.backend.hcl`. The `lint:terraform` script only needs the `terraform`
and `tflint` binaries — `terraform fmt` and `tflint` read Terraform source,
not those gitignored files.

This access model is why several skills behave differently depending on the
environment — see each skill's own notes and the sub-issues of #395 for the
current state of that work.

## 2. Network egress allowlist

Cloud sessions route outbound HTTPS through a policy-enforcing proxy allowlist.
The **Trusted default** allowlist already covers `*.googleapis.com`,
`accounts.google.com`, `releases.hashicorp.com`, `github.com` and the Ubuntu
package archive — the hosts most of this project's tooling needs. Under the
access model in section 1, **no additional host needs to be added** for
routine development:

- Google Cloud reads travel through the managed MCP connector, not the
  session's own network (see section 1) — no host to allowlist.
- `registry.terraform.io` is needed only by `terraform init`, which a cloud
  session never runs (deployment and plan review are delegated, per section 1).
- The gcloud CLI distribution hosts (`packages.cloud.google.com`,
  `dl.google.com`) are not needed — a cloud session does not install `gcloud`
  (see `scripts/setup-dev-tools.sh`; it installs only the linters `npm run
lint` needs).
- `drive.google.com` is not an API host. `src/shared/email-renderer.ts` uses
  it only to build human-facing links in notification emails; the session
  never fetches it.

If a future change genuinely needs a host outside the Trusted default, record
it here with the command or dependency that needs it — don't assume the
Trusted default already covers it.

## 3. Bootstrap

```bash
npm install                          # also installs the pre-push hook
sudo ./scripts/setup-dev-tools.sh    # or: npm run setup:dev-tools
tflint --init --chdir=terraform/
```

`npm install` runs automatically at the start of a cloud session via the
`SessionStart` hook in `.claude/settings.json` — see #396. The other two
commands install packages system-wide (`apt-get`, `/usr/local/bin`) and are
not committed-repo-triggered, so they belong in the cloud environment's
**Setup script** field, which runs once before Claude Code launches and is
cached in the environment snapshot. Paste:

```bash
sudo ./scripts/setup-dev-tools.sh && tflint --init --chdir=terraform/
```

## 4. Verification checklist

Run in order and stop at the first failure.

**Local quality gates** (no Google Cloud access needed):

- [ ] `npm run build` exits 0 in a single pass on a clean tree
- [ ] `npm run lint` exits 0 (all five linters, including `lint:terraform`)
- [ ] `npm run test:coverage` exits 0
- [ ] The `quality-gate` skill reports PASS for lint, formatting and tests

**Git:**

- [ ] A branch created during the session pushes to `origin` successfully
      (the GitHub proxy restricts `git push` to the session's current working
      branch)

**Google Cloud reads (MCP):**

- [ ] The `debug-function-logs` skill's cloud-session path reads logs from a
      deployed staging function

**Deployment and plan review (GitHub Actions):**

- [ ] The `deploy-staging` skill's cloud-session path starts a staging deploy
      via `workflow_dispatch` and reports the run's outcome
- [ ] The `terraform-plan-review` skill's cloud-session path reviews the
      staging plan from a pull request's plan comment

The last two checklist items depend on work that has not landed yet — see
#399, #400 and #401. Until then, those skills' cloud-session paths are not
available; use the devcontainer for infrastructure changes that need a real
plan or deploy.

## 5. What a cloud session still cannot do

- **`npm run test:e2e` / `npm run test:e2e:check-drive`.** Both need
  `gcloud auth login --enable-gdrive-access`, an interactive browser flow that
  cannot run headless.
- **`npm run setup:share-drive-folders`.** Same reason — it is a one-time,
  workstation-only task; once folders are shared, the grant persists across
  deployments.
- **Anything that writes GCP IAM, billing, or other project-level
  configuration directly.** Only the GitHub Actions deploy pipeline (Workload
  Identity Federation) writes to the staging project; a cloud session has no
  standing Google Cloud credential to do so itself.

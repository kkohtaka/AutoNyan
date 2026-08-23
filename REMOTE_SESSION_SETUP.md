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
- **Terraform plan review** reads the plan from the run
  `.github/workflows/terraform-plan.yml` already produces, rather than running
  `terraform plan` locally (which needs the GCS state backend and the
  gitignored `terraform/environments/*.tfvars` / `*.backend.hcl`). Note that
  the workflow's pull request comment carries only a status line and a link to
  the run — the plan text itself stays in the job log, so reading a plan means
  fetching that log, not the comment.

A consequence: a cloud session never runs `terraform init`, `plan` or `apply`,
so it never needs `terraform/environments/staging.tfvars` or
`staging.backend.hcl`. The `lint:terraform` script only needs the `terraform`
and `tflint` binaries plus tflint's ruleset plugins (section 3) — `terraform
fmt` and `tflint` read Terraform source, not those gitignored files.

**Connector prerequisites.** The Cloud Logging connector is configuration
rather than code, so nothing in this repository installs it. Configured once per
Google Cloud project:

- An OAuth client in the project, with `https://claude.ai/api/mcp/auth_callback`
  as an authorized redirect URI. Google's MCP servers do not support Dynamic
  Client Registration, so the client has to exist before the connector is added.
- `roles/mcp.toolUser` and `roles/logging.viewer` on the principal that
  authorizes the connector. `roles/logging.viewer` is enough — listing log names
  and reading entries both succeed without `roles/logging.admin`. Grant them
  with `gcloud projects add-iam-policy-binding --condition=None`: this project's
  IAM policy already carries conditional bindings, so gcloud otherwise refuses
  to guess and prompts for a condition. `scripts/setup-github-actions.sh` passes
  the same flag for the same reason.
- `https://logging.googleapis.com/mcp` added as a custom connector, with the
  display name `Cloud Logging` so it registers under the server name the
  `debug-function-logs` grant expects (section 4).
- The target project id, which a session cannot discover: it has no default in
  `terraform/variables.tf` and its value lives in the gitignored
  `terraform/environments/*.tfvars`, so the session has to be told it.

Adding a connector reaches an already-running cloud session on **resume** — no
new session is needed to pick it up.

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
  `dl.google.com`) are not needed — a cloud session does not install
  `gcloud` (see `scripts/setup-dev-tools.sh`; it installs only the linters
  that `npm run lint` needs).
- `drive.google.com` is not an API host. `src/shared/email-renderer.ts` uses
  it only to build human-facing links in notification emails; the session
  never fetches it.

The bootstrap in section 3 does reach one host worth recording:
`scripts/setup-dev-tools.sh` downloads tflint **and its ruleset plugins** from
GitHub Releases, which redirects to `objects.githubusercontent.com`. It
resolved in a verified cloud session; if an environment ever blocks it,
installing tflint is what breaks.

`api.github.com` is reachable, but a session's GitHub API access is scoped to the
repositories attached to that session — paths under `repos/{owner}/{repo}` for any
other repository answer 403. That is why the script unpacks the ruleset plugins
from their release assets, which carry no such scope, rather than running
`tflint --init`, whose installer resolves releases through that API. No allowlist
change lifts this: the constraint is the API scope, not the host.

Two hosts a session will reach for and not get are Google Cloud's own
documentation: **`docs.cloud.google.com` and `codelabs.developers.google.com`
are blocked by the proxy.** No command here needs them, so this is not an
allowlist request — it is recorded because the reflex on meeting an unfamiliar
Google Cloud surface is to go read the doc, and in a cloud session that reflex
returns nothing. Settle such questions by observation instead.

If a future change genuinely needs a host outside the Trusted default, record
it here with the command or dependency that needs it — don't assume the
Trusted default already covers it.

## 3. Bootstrap

```bash
npm install                     # also installs the pre-push hook
./scripts/setup-dev-tools.sh    # or: npm run setup:dev-tools
```

A cloud session runs both of these for itself: the `SessionStart` hook in
`.claude/settings.json` invokes `.claude/hooks/session-start-install.sh`,
which runs them whenever `CLAUDE_CODE_REMOTE` is set — see #396. Nothing needs
to go in the cloud environment's **Setup script** field; putting
`setup-dev-tools.sh` there as well only repeats what the hook already does.

On an ephemeral machine that is not a cloud session, run the two commands by
hand. The second installs system-wide (`apt-get`, `/usr/local/bin`), so it
needs root: prefix it with `sudo` unless you are already root, as a cloud
session is.

`setup-dev-tools.sh` also installs the tflint ruleset plugins that
`terraform/.tflint.hcl` pins, so `npm run lint:terraform` enforces the full
rule set here exactly as it does in CI. Do not replace that with
`tflint --init`, which cannot work behind the proxy — the script records why.

The plugins install under `$HOME`, so run the script as the user that will
later run `npm run lint` (in a cloud session both are root), or set
`TFLINT_PLUGIN_DIR` to a shared location for both.

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

- [ ] The Cloud Logging connector is registered under the server name
      `Cloud_Logging`, matching the `mcp__Cloud_Logging` grant in
      `debug-function-logs`. A custom connector takes its server name from the
      display name given when it is added (`Cloud Logging`), not from its URL —
      a mismatch prompts for permission on every log read instead of failing
      outright
- [ ] The account's `roles/mcp.toolUser` and `roles/logging.viewer` on the
      target project are enough to list log names and read entries; no
      `roles/logging.admin` is needed
- [ ] The `debug-function-logs` skill's cloud-session path reads logs from a
      deployed staging function

**Deployment and plan review (GitHub Actions):**

- [ ] The `deploy-staging` skill's cloud-session path follows a staging Deploy
      run and reports its outcome. It cannot start the run — `workflow_dispatch`
      needs the Actions write permission the session's token does not carry, so
      the skill hands the dispatch back to the user (#420)
- [ ] The `terraform-plan-review` skill's cloud-session path reviews the
      staging plan from the plan workflow run's job log (the pull request
      comment only links to the run — see section 1)

All three cloud-session paths have landed (#399, #400, #401); what is unchecked
above is verification, not implementation. The Cloud Logging item additionally
needs the connector prerequisites in section 1 to be configured before it can
be checked at all.

## 5. What a cloud session still cannot do

- **Anything that shells out to `gh` or `gcloud`.** Neither is installed, and
  `scripts/setup-dev-tools.sh` deliberately does not add them — the access
  model in section 1 removes the need for `gcloud`, and GitHub work goes
  through the GitHub MCP tools instead. The APM-managed skills (`commit`,
  `create-pr`, `create-issue`, `debug-ci`) still assume `gh`, so they are
  unavailable here until that changes upstream; see #398 and the note in #395.
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

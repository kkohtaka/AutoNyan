# Remote Session Setup

How to bring an ephemeral machine — a Claude Code remote session, a fresh
container, any box that is not the devcontainer — to the point where it can
lint, test, `terraform plan`, deploy to **staging**, and read Cloud Logging.

The devcontainer image already contains everything below; this document exists
for environments that start with only Node.js and a network egress allowlist.

## 1. Network egress allowlist

Remote sessions route outbound HTTPS through a policy-enforcing proxy. Hosts
that are not allowed answer `403` to `CONNECT`, which surfaces as an install
failure or an opaque timeout. The allowlist must contain the following.

If the policy supports wildcards, sections B–D collapse to
`*.googleapis.com`, `accounts.google.com` and `drive.google.com`.

### A. Tool installation

| Host                                          | Needed for                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------- |
| `releases.hashicorp.com`                      | Terraform CLI **and** provider binaries (`hashicorp/google`)              |
| `registry.terraform.io`                       | Provider registry metadata resolved by `terraform init`                   |
| `packages.cloud.google.com`                   | gcloud CLI apt repository                                                 |
| `dl.google.com`                               | gcloud CLI tarball (alternative to the apt repository)                    |
| `checkpoint-api.hashicorp.com`                | Terraform version check — optional, avoidable with `CHECKPOINT_DISABLE=1` |
| `github.com`, `objects.githubusercontent.com` | tflint and shfmt release archives                                         |
| Debian/Ubuntu archive                         | shellcheck, yamllint                                                      |

### B. Authentication

| Host                            | Needed for                                                        |
| ------------------------------- | ----------------------------------------------------------------- |
| `oauth2.googleapis.com`         | Token endpoint used by gcloud, Terraform and every client library |
| `accounts.google.com`           | OAuth login flow                                                  |
| `sts.googleapis.com`            | Workload Identity Federation token exchange                       |
| `iamcredentials.googleapis.com` | Service account impersonation / access token minting              |
| `www.googleapis.com`            | `google-auth-library` and the Drive API client                    |

### C. Terraform and staging deployment

| Host                                                                                                            | Needed for                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `storage.googleapis.com`                                                                                        | GCS state backend, function source buckets and objects                                                                          |
| `cloudresourcemanager.googleapis.com`                                                                           | `data "google_project"`                                                                                                         |
| `serviceusage.googleapis.com`                                                                                   | `google_project_service`                                                                                                        |
| `iam.googleapis.com`                                                                                            | Service accounts, keys, project IAM bindings                                                                                    |
| `cloudfunctions.googleapis.com`                                                                                 | `google_cloudfunctions2_function`                                                                                               |
| `run.googleapis.com`, `eventarc.googleapis.com`, `artifactregistry.googleapis.com`, `cloudbuild.googleapis.com` | Cloud Functions **gen2** backing services. No Terraform resource names them, so a missing entry here only fails late in `apply` |
| `pubsub.googleapis.com`                                                                                         | `google_pubsub_topic`                                                                                                           |
| `cloudscheduler.googleapis.com`                                                                                 | `google_cloud_scheduler_job`                                                                                                    |
| `firestore.googleapis.com`                                                                                      | `google_firestore_database`                                                                                                     |
| `secretmanager.googleapis.com`                                                                                  | `google_secret_manager_secret`                                                                                                  |
| `billingbudgets.googleapis.com`, `cloudbilling.googleapis.com`                                                  | `google_billing_budget`                                                                                                         |

### D. Logs, pipeline runtime and E2E

| Host                                       | Needed for                                                              |
| ------------------------------------------ | ----------------------------------------------------------------------- |
| `logging.googleapis.com`                   | `gcloud logging read`, `gcloud functions logs read`, E2E log assertions |
| `drive.googleapis.com`, `drive.google.com` | Drive API                                                               |
| `vision.googleapis.com`                    | Vision API                                                              |
| `aiplatform.googleapis.com`                | Vertex AI classification                                                |
| `gmail.googleapis.com`                     | Notification delivery                                                   |

`compute.googleapis.com` is deliberately **not** on this list — the project
manages no compute resources, matching the least-privilege stance in
`CLAUDE.md`.

## 2. Prerequisites the allowlist does not cover

1. **Google Cloud credentials.** A remote session is headless, so the
   `gcloud auth login` browser flow is unavailable. Supply either a service
   account key referenced by `GOOGLE_APPLICATION_CREDENTIALS`, or a Workload
   Identity Federation configuration. If the environment injects a placeholder
   `CLOUDSDK_AUTH_ACCESS_TOKEN`, clear it — a non-token value breaks gcloud
   even when other credentials are present.
2. **Terraform configuration files**, both gitignored and therefore absent from
   a fresh clone:
   - `terraform/environments/staging.tfvars` — every key in
     `terraform/terraform.tfvars.example`
   - `terraform/environments/staging.backend.hcl` — generated by
     `npm run setup:terraform-backend`, which itself needs working gcloud auth
3. **Environment variables**: `ENVIRONMENT=staging`, plus `TF_STATE_BUCKET` when
   the state bucket is not the default `autonyan-terraform-state`.
4. **Drive folder sharing.** `npm run setup:share-drive-folders` requires
   `gcloud auth login --enable-gdrive-access`, which cannot run headless. The
   grants persist across deployments, so this is a one-time task to perform from
   a workstation; Drive-dependent E2E cannot pass from a remote session until it
   is done.

## 3. Bootstrap

```bash
npm install                          # also installs the pre-push hook
sudo ./scripts/setup-dev-tools.sh    # or: npm run setup:dev-tools
tflint --init --chdir=terraform/
```

`npm run build` fails on a clean tree the first time with `TS6305`, because
`npm run build --workspaces` compiles `autonyan-shared` last. Re-running
succeeds; `npm run build:function` is unaffected because it builds the shared
workspace first.

## 4. Verification checklist

Run in order and stop at the first failure.

**Connectivity** — cheaper to diagnose here than mid-`apply`:

- [ ] Every host in section 1 answers without `403`
- [ ] Especially `run`, `eventarc`, `artifactregistry` and `cloudbuild`

**Authentication:**

- [ ] `gcloud auth list` shows a real account
- [ ] `gcloud config get-value project` returns the staging project
- [ ] `npm run test:e2e:check-auth` prints `Authentication successful`

**Local quality gates:**

- [ ] `npm run lint` exits 0 (all five linters, including `terraform fmt`)
- [ ] `npm run test:coverage` exits 0
- [ ] `npm run build:function` and `npm run validate:function` exit 0

**Terraform:**

- [ ] `ENVIRONMENT=staging npm run terraform:init` succeeds
- [ ] `ENVIRONMENT=staging npm run terraform:plan` succeeds and the diff is
      expected — review with the `terraform-plan-review` skill

**Deployment** (only after reviewing the plan; `terraform:apply` runs with
`-auto-approve`):

- [ ] `deploy-staging` skill, or `ENVIRONMENT=staging npm run deploy`
- [ ] `gcloud functions list` shows the `staging-` prefixed functions as active

**Logs:**

- [ ] `gcloud functions logs read staging-drive-scanner --region=<region> --limit=10`
- [ ] `gcloud logging read 'resource.type="cloud_function"' --limit=1 --format=json`
- [ ] The `debug-function-logs` skill collects its context successfully

**E2E** (creates real Drive and Storage objects in staging):

- [ ] `npm run test:e2e:check-drive`
- [ ] `npm run test:e2e`

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

**GitHub access.** GitHub work goes through the GitHub MCP tools (server name
`github`); `gh` is not installed. `api.github.com` is reachable directly as
well, and **requests to it are authenticated by the egress proxy, not by
anything in the session**: `GH_TOKEN` and `GITHUB_TOKEN` are set but hold a
14-character `prox…` placeholder, and a deliberately bogus `Authorization`
header is answered exactly like a correct one. A plain `curl` therefore reads
this repository as its owner, at a GitHub App installation's rate limit. Never
read those variables expecting a credential — they are not one.

`POST /graphql` is refused with 403 by policy — only a pinned set of
pull-request-review operations is relayed — so anything reachable *only* through
GraphQL is unreachable here regardless of credentials (section 5).

Details that are easy to get wrong, each measured rather than assumed:

- **Review thread resolution state** comes only from the MCP `pull_request_read`
  tool's `get_review_comments` method. Its wire format spells the flag
  `is_resolved`, even though the tool's own description says `isResolved`. The
  REST review-comments endpoint carries no resolution field at all, so there is
  no REST fallback for it — which matters because `master`'s ruleset sets
  `required_review_thread_resolution`, making unresolved threads a merge blocker.
- **A pull request's merge state is `mergeable_state`,** returned by
  `pull_request_read`'s `get` method with lowercase values (`clean`, `dirty`,
  `behind`, `blocked`, `unknown`). The tool returns no `mergeable` and no
  `mergeStateStatus` key, so anything written against the GraphQL spelling or
  its uppercase values matches nothing and silently mis-reports every pull
  request. Same trap as `is_resolved` above: match what the call returns.
- **Replying to a thread and resolving one take different ids.**
  `add_reply_to_pull_request_comment` wants the numeric part of the comment's
  `#discussion_r…` anchor, which the response carries only inside `html_url` and
  has to be cut out of it; `resolve_review_thread` wants the GraphQL node id
  (`PRRT_…`) that the same response returns as `id`. Passing either one to the
  other tool fails.
- **Repository rulesets** have no MCP tool. Read them with
  `curl https://api.github.com/repos/{owner}/{repo}/rulesets`, which works through
  the proxy authentication described above. That listing carries only each
  ruleset's summary — the required status check contexts are not in it, so
  anything that counts merge blockers has to follow up with
  `/rulesets/{ruleset_id}`. Whether the proxy authentication makes this
  independent of repository visibility is untested: it has only been exercised
  against this repository, which is public.
- **Comments a session posts get `_Generated by [Claude Code](https://claude.ai/code)_`
  appended server-side.** Anything that matches on comment bodies — for example
  to recognize its own earlier posts — must not assume its own footer is the
  last line.

MCP server names derive from each connector's display name (`Cloud Logging` →
`Cloud_Logging`), not from a stable identifier, so **renaming a connector
silently breaks any `allowed-tools` grant written against its name.**

The Slack connector registers as **`Slack`** (`mcp__Slack__…`), not `slack`.
Reaching the maintainer's own DM needs no channel lookup: `slack_search_users`
resolves the login to a user id, and that user id can be passed straight to
`slack_read_channel` / `slack_send_message` as the `channel_id`.

**`allowed-tools` restricts; `permissions.allow` grants.** The two are separate
layers and neither implies the other. A skill's `allowed-tools` frontmatter
narrows what that skill may reach and pre-approves nothing; the permission
prompt is suppressed only by a `permissions.allow` rule in a settings file.
So a skill can name an MCP tool in `allowed-tools`, pass every review, and still
stall an unattended session on the prompt for that same tool. Measured on
2026-09-03: the scheduled `/daily-triage` run completed every GitHub write
without a prompt and blocked on `mcp__Slack__slack_send_message`.

Consequences for an unattended routine:

- Every MCP tool it calls needs an entry in the checked-in
  `.claude/settings.json`. `.claude/settings.local.json` is not a route — a
  cloud session starts from a fresh clone, so a gitignored local settings file
  never exists there. Nor is raising `permissions.defaultMode`: `auto` and
  `bypassPermissions` take effect only from user or managed settings, or
  `--permission-mode`, not from project settings.
- The rule must spell the tool exactly as `/mcp` reports it in the session that
  will run the routine; a name that does not match is ignored silently — the
  same failure class as the connector rename above.
- An `mcp__` rule carrying a parenthesised argument matcher is discarded
  outright, so an MCP grant is per-tool and all-or-nothing. A restriction on
  *which* Slack destination a routine may post to therefore cannot be expressed
  mechanically and stays textual, in the skill's `Prohibited` section.
- An organization-level `ask` control on a tool overrides allow rules entirely,
  in every permission mode. `/mcp` shows whether one applies.
- **An agent cannot make this edit.** Writes to `.claude/settings.json` are
  refused by the sandbox classifier — an agent must not widen its own
  permissions — so the maintainer applies the allowlist by hand.

**A skill marked `disable-model-invocation: true` cannot be started in an
unattended session.** Such a skill is absent from the session's available-skills
list, and invoking it through the `Skill` tool is refused outright:

```
Skill <name> cannot be used with Skill tool due to disable-model-invocation.
Ask the user to run /<name> themselves — it cannot be invoked via the Skill tool.
```

The slash-command route is no escape hatch: a scheduled routine whose prompt was
exactly `/e2e-verify` ran and did nothing. The flag is what stops it, not the
route — the control run, a routine whose prompt was exactly `/quality-gate`,
loaded that skill and completed all three of its checks. So a scheduled prompt
**can** be a single slash command, and that is the reliable way to start a
routine's skill, but the skill it names must not carry
`disable-model-invocation: true` — which the unattended exception in
`.claude/skills/CONVENTIONS.md` §4.3 currently requires it to.

**What the flag gates is the originator, not the route.** A gated skill still
loads normally when a person types `/<name>` themselves in an interactive
session — measured with `/create-issue`, which loaded and ran to completion
while remaining absent from the same session's available-skills list. So the
three cases are:

| Started by | Gated skill |
| --- | --- |
| The model, via the `Skill` tool | Refused |
| A scheduled routine's prompt | Does nothing |
| A person typing `/<name>` interactively | **Runs normally** |

This is why the flag remains the right default for a skill with side effects
(§4.2) and is still fatal for an unattended one: a scheduled routine has no
person to type the command. Read "cannot be started" above as scoped to the
unattended case, which is the only one this document is about.

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

The bootstrap in section 3 reaches two hosts worth recording, both of which
resolved in a verified cloud session:

- `scripts/setup-dev-tools.sh` downloads tflint **and its ruleset plugins** from
  GitHub Releases, which redirects to `objects.githubusercontent.com`. If an
  environment ever blocks it, installing tflint is what breaks.
- `scripts/setup-node.sh` downloads the Node.js binary release and its
  `SHASUMS256.txt` from `nodejs.org`. There is no substitute host: the
  `nodejs/node` GitHub releases carry source only, no binary assets.

`api.github.com` is reachable (section 1 covers what authenticates those
requests), but a session's GitHub API access is scoped to the repositories
attached to that session — paths under `repos/{owner}/{repo}` for any other
repository answer 403. That is why the script unpacks the ruleset plugins
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
./scripts/setup-node.sh         # or: npm run setup:node
npm ci                          # also installs the pre-push hook
./scripts/setup-dev-tools.sh    # or: npm run setup:dev-tools
```

**Node comes first, and comes from `.nvmrc`.** The cloud image's own Node is
older than the `>=24.15.0` this project requires — it ships a 22 on `PATH` and a
20 at `/usr/local/bin/node` — so everything after it would otherwise run on a
different major than CI, the devcontainer and the deployed Cloud Functions, all
three of which already derive their Node from `.nvmrc`. `setup-node.sh` reads
that file (never a hardcoded version, so a Renovate bump moves the cloud session
too), downloads the matching binary release from `nodejs.org`, verifies its
`SHASUMS256.txt` checksum, and unpacks it under `/opt`.

It then **shadows `node`, `npm`, `npx` and `corepack` in whichever directory
currently wins on `PATH`**, rather than prepending a directory of its own. That
is not a stylistic choice: a cloud session's shells inherit a `PATH` fixed when
the container started and re-source neither `/etc/profile.d` nor `~/.bashrc`, so
a prepended directory — or an `nvm alias default`, measured — reaches nothing.
The image does carry an nvm at `/opt/nvm`, and `nvm install` reads `.nvmrc`
correctly, but its effect dies with the shell that ran it.

**`npm ci`, not `npm install`.** `npm ci` installs from the lockfile without
ever writing it, which is what an ephemeral fresh clone wants regardless of the
Node version, and it still runs `prepare`, so the pre-push hook is installed
either way. This started as the fix for a lockfile hole (#454): under the image's
older npm, `npm install` quietly rewrote `package-lock.json`, dropping the `libc`
fields npm 11 writes — 48 deleted lines on every fresh session, leaving a dirty
tree that an unattended routine could sweep into a commit. Raising Node closes
that hole at the cause; `npm ci` remains correct on its own terms.

`.npmrc` sets `engine-strict=true` so a Node that does not satisfy `engines`
fails the install loudly (`EBADENGINE`) instead of proceeding and rewriting the
lockfile. It applies to every environment, not just cloud sessions — that is the
point: nothing else announces a version skew.

A cloud session runs all three of these for itself: the `SessionStart` hook in
`.claude/settings.json` invokes `.claude/hooks/session-start-install.sh`,
which runs them whenever `CLAUDE_CODE_REMOTE` is set — see #396. Nothing needs
to go in the cloud environment's **Setup script** field; putting
`setup-dev-tools.sh` there as well only repeats what the hook already does.

On an ephemeral machine that is not a cloud session, run the three commands by
hand. The first two write to `/opt` and system-wide (`apt-get`,
`/usr/local/bin`), so they need root: prefix them with `sudo` unless you are
already root, as a cloud session is.

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

- [x] `node -v` matches `.nvmrc`, and `npm install` — not just `npm ci` — leaves
      `package-lock.json` unmodified
- [x] `npm run build` exits 0 in a single pass on a clean tree
- [x] `npm run lint` exits 0 (all five linters, including `lint:terraform`)
- [x] `npm run test:coverage` exits 0
- [x] The `quality-gate` skill reports PASS for lint, formatting and tests

**Git:**

- [x] A branch created mid-session pushes to `origin` successfully, creating a
      new ref and transferring new objects. The proxy does not restrict pushes
      to the session's own working branch, as was assumed before this was
      measured — but it does refuse to delete a ref (section 5)

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

**GitHub (MCP), measured in a cloud session:**

- [x] Review threads come back with their resolution state, via
      `pull_request_read` / `get_review_comments` — verified against PR #225,
      whose two threads both reported resolved
- [x] A reply posted with `add_reply_to_pull_request_comment` lands *inside* the
      existing inline thread rather than as a pull request comment — observed on
      PR #225, whose thread went from one comment to two while the PR's thread
      count stayed at two. The probe reply was deleted afterwards, so #225 no
      longer shows it; re-checking this means posting a fresh reply. The input is
      the numeric `discussion_r…` id, not the GraphQL `PRRT_…` thread node id
- [x] Issues and issue comments can be filtered by author, server-side
      (`search_issues` with `author:`) and client-side (`user.login` is present
      on both). Bot logins are not spelled consistently across tools —
      `list_issues` renders one actor as `kohtaka-bot` where `list_pull_requests`
      renders it `kohtaka-bot[bot]` — so filter by matching the wanted author
      positively, never by excluding bots by name
- [x] Workflow runs, jobs, and **job log text** are readable (`actions_list`,
      `actions_get`, `get_job_logs`). Reading a pull request's required checks
      needs both `get_check_runs` and `get_status`, because
      `terraform/plan/staging` is a commit status (see the Required Status Check
      Invariant in `CLAUDE.md`)

**The `daily-triage` routine, measured in a cloud session on 2026-09-01:**

Every mechanism the skill depends on was exercised read-only before any
unattended run. Reproduce by re-running each of these in a cloud session:

- [x] The skill is startable here — it appears in the session's available-skills
      list, while all five skills carrying `disable-model-invocation: true`
      (`add-ci-role`, `create-issue`, `create-pr`, `deploy-staging`,
      `e2e-verify`) are absent from it. That reproduces the section 1 measurement
      independently, and confirms the `create-pr` / `create-issue` delegations
      really are unavailable, which is why Step 5 opens its pull request itself
- [x] All five `## Context` probes exit cleanly on a fresh clone
- [x] Step 1 reads the ruleset: the listing returns id 6228805, and
      `/rulesets/6228805` returns every rule the skill asserts —
      `required_review_thread_resolution: true`,
      `strict_required_status_checks_policy: false`,
      `require_extra_approval_for_unattributed_changes: true`,
      `allowed_merge_methods: ["rebase"]`, `required_linear_history`,
      `review_draft_pull_requests: false`, and the two required contexts `test`
      and `terraform/plan/staging`
- [x] Step 2's author filter is load-bearing: of the two open issues, #440 is
      the maintainer's and #210 is `kohtaka-bot`'s
- [x] Step 6A's two-call rule reproduces live on PR #453 —
      `terraform/plan/staging` appears in none of the 10 check runs and only in
      `get_status`
- [x] Step 6B's wire format holds: `get_review_comments` on PR #411 returns
      `is_resolved` / `is_outdated` / `is_collapsed`, the thread `id` is a
      `PRRT_…` node id, and the numeric `discussion_r…` id appears only inside
      `html_url`. The REST endpoint's comment objects carry no resolution key at
      all, confirming there is no fallback
- [x] Step 4's re-send suppression is sound: the server-appended
      `_Generated by [Claude Code](https://claude.ai/code)_` follows the
      routine's own footer, so only a substring match finds it
- [x] Step 8's destination resolves: `slack_search_users` on the maintainer's
      login returns exactly one user id, which is the DM target
- [x] The quality gate Step 5 depends on passes here — `npm run lint` and
      `npm run test:coverage` both exit 0, and neither dirties the tree
- [x] Step 5's "has this branch already landed?" check is `git diff
      origin/master HEAD` with **two** dots. Measured on a branch whose content
      had just been rebase-merged: the SHA count `git log origin/master..HEAD`
      listed the commit as unmerged, the three-dot `git diff origin/master...HEAD`
      reported 95 insertions because it diffs from the merge base, and only the
      two-dot form came back empty — the correct answer. Both wrong forms
      reproduce #452
- [x] An actual `/daily-triage` run, with the maintainer watching, takes only
      the writes `## Permitted writes` enumerates. Run 2026-09-01 after the
      local scheduled task was disabled, so the two could not duplicate each
      other. Audited against a baseline captured beforehand: the only writes
      were one issue comment (#440) and one Slack DM to the maintainer. Branch
      count unchanged at 8, `master` unmoved, no pull request opened (Step 5's
      budget of three went unused because nothing open was actionable as code),
      no force push, no merge, no thread resolved, no draft taken out of draft.
      Step 4's re-send suppression was exercised for real: #453's open wording
      question was recognized as already reported and carried into the digest's
      `継続中` list instead of being re-posted

**Deployment and plan review (GitHub Actions):**

- [x] The `deploy-staging` skill's cloud-session path follows a staging Deploy
      run and reports its outcome — verified against run 32621449624, reading
      all 13 steps of the `deploy` job and the `✅ Deployment to staging
      completed successfully` line the reporting step emits. It cannot start the
      run: `workflow_dispatch` needs the Actions write permission the session's
      token does not carry, and that is permanent rather than pending, since a
      GitHub App's permission scopes are fixed by its publisher and no account
      or repository setting can widen them. The user dispatches, the skill takes
      over (#420)
- [x] The `terraform-plan-review` skill's cloud-session path reviews the
      staging plan from the plan workflow run's job log (the pull request
      comment only links to the run — see section 1) — verified against PR #421,
      whose plan reported 12 in-place updates with no replacements

All three cloud-session paths have landed (#399, #400, #401). The deployment and
plan-review paths are now verified as well, within the split described above.
What remains unchecked is the Cloud Logging group: implementation is done, and
the connector prerequisites in section 1 are configured, so those items need
only to be exercised and ticked.

## 5. What a cloud session still cannot do

- **Anything that shells out to `gh` or `gcloud`.** Neither is installed, and
  `scripts/setup-dev-tools.sh` deliberately does not add them — the access
  model in section 1 removes the need for `gcloud`, and GitHub work goes
  through the GitHub MCP tools instead. The APM-managed skills (`commit`,
  `create-pr`, `create-issue`, `debug-ci`) no longer assume `gh`: since
  agent-skills `v0.2.0` each probes for it and falls back to the GitHub MCP
  server, so all four are usable here.
- **Run an arbitrary GraphQL query against GitHub.** `POST /graphql` answers 403
  by policy, not for want of a credential (section 1), so no token or header
  changes it.
- **Rebase-update a pull request branch.** `gh pr update-branch --rebase` drives
  a GraphQL mutation, and the MCP `update_pull_request_branch` tool has no
  update-method parameter — it merges the base into the head, producing a merge
  commit that `master`'s rebase-only, linear-history ruleset does not allow. The
  only remaining route is a local `git` rebase and a force push, which is a
  judgement call rather than something to automate. Little is lost by leaving a
  branch behind its base: the ruleset sets `strict_required_status_checks_policy`
  to `false`, so being out of date is not a merge blocker — report the condition
  rather than trying to clear it.
- **`npm run test:e2e` / `npm run test:e2e:check-drive`.** Both need
  `gcloud auth login --enable-gdrive-access`, an interactive browser flow that
  cannot run headless.
- **`npm run setup:share-drive-folders`.** Same reason — it is a one-time,
  workstation-only task; once folders are shared, the grant persists across
  deployments.
- **Delete a remote ref.** `git push origin --delete <branch>` and
  `git push origin :refs/heads/<branch>` both die with `send-pack: unexpected
  disconnect while reading sideband packet`, while creating and updating refs
  over the same proxy succeeds, and the GitHub MCP tool surface has no
  branch-delete tool. A session therefore cannot clean up after itself: any
  throwaway branch it pushes outlives it and has to be removed by hand.
- **Anything that writes GCP IAM, billing, or other project-level
  configuration directly.** Only the GitHub Actions deploy pipeline (Workload
  Identity Federation) writes to the staging project; a cloud session has no
  standing Google Cloud credential to do so itself.

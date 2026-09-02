#!/usr/bin/env bash

# The devcontainer image already has the `.nvmrc` Node, node_modules and the
# lint toolchain baked in; only a cloud session starts from a fresh clone with
# none of them.

set -euo pipefail

if [ -z "${CLAUDE_CODE_REMOTE:-}" ]; then
	exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-"$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"}"

# The cloud image's Node is older than the `>=24.15.0` this project requires, so
# raise it to the `.nvmrc` pin before anything runs on it — a quality gate that
# passes on a different major than CI and the deployed functions is weaker
# evidence than it looks.
./scripts/setup-node.sh

# `npm ci` rather than `npm install`: correct for an ephemeral fresh clone
# regardless of the Node version, since it installs from the lockfile without
# ever writing it.
npm ci

# `npm run lint` shells out to shellcheck, yamllint, shfmt, tflint and
# terraform, none of which ship in the cloud image.
./scripts/setup-dev-tools.sh

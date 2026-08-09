#!/usr/bin/env bash

# The devcontainer image already has node_modules and the lint toolchain baked
# in; only a cloud session starts from a fresh clone with neither.

set -euo pipefail

if [ -z "${CLAUDE_CODE_REMOTE:-}" ]; then
	exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-"$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"}"

npm install

# `npm run lint` shells out to shellcheck, yamllint, shfmt, tflint and
# terraform, none of which ship in the cloud image.
./scripts/setup-dev-tools.sh

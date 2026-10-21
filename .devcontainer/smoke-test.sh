#!/bin/bash

# Proves a built devcontainer image works the way it is used: every tool the
# project's lint and build steps call is present, and `npm run lint` passes
# inside the container. Run by .github/workflows/devcontainer.yml through
# `devcontainer exec`; a developer can run it inside their own container to
# check the environment.

set -euo pipefail

# nvm puts Node on PATH only through .bashrc, which a non-interactive shell
# does not read; this mirrors what postCreateCommand in devcontainer.json does.
export NVM_DIR="$HOME/.nvm"
# shellcheck source=/dev/null
. "$NVM_DIR/nvm.sh"
nvm use --silent

for tool in node npm terraform tflint gcloud shellcheck shfmt yamllint; do
	printf '%s: ' "$tool"
	"$tool" --version | head -1
done

npm ci
npm run build
tflint --chdir=terraform/ --init
npm run lint

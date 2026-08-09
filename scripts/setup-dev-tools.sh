#!/bin/bash

# Installs the non-npm tooling `npm run lint` depends on: shellcheck, yamllint,
# shfmt, tflint and terraform. Needed on ephemeral machines (Claude Code remote
# sessions, fresh CI-like containers) where only Node.js is preinstalled; the
# devcontainer image already bakes these in.
#
# terraform and tflint are pinned to the versions .github/workflows/test.yml
# installs so local lint results match CI. Requires root (apt-get, /usr/local/bin).

set -euo pipefail

TFLINT_VERSION=${TFLINT_VERSION:-"v0.50.3"}
TERRAFORM_VERSION=${TERRAFORM_VERSION:-"1.8.5"}

TMP_DIR=$(mktemp -d)
trap 'rm -rf "${TMP_DIR}"' EXIT

echo "Installing development tools..."

echo "  - shellcheck, shfmt, yamllint, unzip (apt)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends shellcheck shfmt yamllint unzip

if command -v tflint >/dev/null 2>&1; then
	echo "  - tflint already installed ($(tflint --version | head -1))"
else
	echo "  - tflint ${TFLINT_VERSION}"
	curl -fsSL -o "${TMP_DIR}/tflint.zip" \
		"https://github.com/terraform-linters/tflint/releases/download/${TFLINT_VERSION}/tflint_linux_amd64.zip"
	unzip -o -q "${TMP_DIR}/tflint.zip" -d /usr/local/bin
	chmod +x /usr/local/bin/tflint
fi

if command -v terraform >/dev/null 2>&1; then
	echo "  - terraform already installed ($(terraform version | head -1))"
else
	echo "  - terraform ${TERRAFORM_VERSION}"
	curl -fsSL -o "${TMP_DIR}/terraform.zip" \
		"https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/terraform_${TERRAFORM_VERSION}_linux_amd64.zip"
	unzip -o -q "${TMP_DIR}/terraform.zip" -d /usr/local/bin
	chmod +x /usr/local/bin/terraform
fi

echo ""
echo "Installed versions:"
shellcheck --version | grep version: | tail -1
yamllint --version
shfmt --version
tflint --version | head -1
terraform version | head -1

echo ""
echo "Next: run 'tflint --init --chdir=terraform/' to fetch tflint plugins."

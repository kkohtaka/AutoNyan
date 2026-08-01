#!/bin/bash

# Installs the non-npm tooling that `npm run lint`, `npm run terraform:*` and the
# gcloud-based skills depend on. Needed on ephemeral machines (Claude Code remote
# sessions, fresh CI-like containers) where only Node.js is preinstalled; the
# devcontainer image already bakes these in.
#
# Versions are pinned to the ones .github/workflows/test.yml installs so local
# lint results match CI. Requires root (apt-get, /usr/local/bin).

set -euo pipefail

TFLINT_VERSION=${TFLINT_VERSION:-"v0.50.3"}
TERRAFORM_VERSION=${TERRAFORM_VERSION:-"1.8.5"}
SHFMT_VERSION=${SHFMT_VERSION:-"v3.10.0"}

TMP_DIR=$(mktemp -d)
trap 'rm -rf "${TMP_DIR}"' EXIT

echo "Installing development tools..."

echo "  - shellcheck, yamllint, unzip (apt)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends shellcheck yamllint unzip

if command -v tflint >/dev/null 2>&1; then
	echo "  - tflint already installed ($(tflint --version | head -1))"
else
	echo "  - tflint ${TFLINT_VERSION}"
	curl -fsSL -o "${TMP_DIR}/tflint.zip" \
		"https://github.com/terraform-linters/tflint/releases/download/${TFLINT_VERSION}/tflint_linux_amd64.zip"
	unzip -o -q "${TMP_DIR}/tflint.zip" -d /usr/local/bin
	chmod +x /usr/local/bin/tflint
fi

if command -v shfmt >/dev/null 2>&1; then
	echo "  - shfmt already installed ($(shfmt --version))"
else
	echo "  - shfmt ${SHFMT_VERSION}"
	curl -fsSL -o "${TMP_DIR}/shfmt" \
		"https://github.com/mvdan/sh/releases/download/${SHFMT_VERSION}/shfmt_${SHFMT_VERSION}_linux_amd64"
	install -m 755 "${TMP_DIR}/shfmt" /usr/local/bin/shfmt
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

if command -v gcloud >/dev/null 2>&1; then
	echo "  - gcloud already installed"
else
	echo "  - google-cloud-cli (apt)"
	curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg |
		gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg
	echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" \
		>/etc/apt/sources.list.d/google-cloud-sdk.list
	apt-get update -qq
	apt-get install -y --no-install-recommends google-cloud-cli
fi

echo ""
echo "Installed versions:"
shellcheck --version | grep version: | tail -1
yamllint --version
tflint --version | head -1
shfmt --version
terraform version | head -1
gcloud version 2>/dev/null | head -1

echo ""
echo "Next: run 'tflint --init --chdir=terraform/' to fetch tflint plugins."

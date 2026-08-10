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

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
TFLINT_CONFIG="${SCRIPT_DIR}/../terraform/.tflint.hcl"
TFLINT_PLUGIN_ROOT=${TFLINT_PLUGIN_DIR:-"${HOME}/.tflint.d/plugins"}

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

# Plugins are unpacked straight from their GitHub release assets instead of via
# `tflint --init`, whose installer resolves releases through api.github.com — a
# host the Claude Code on the web proxy blocks, while release *asset* downloads
# (used for tflint itself above) succeed. Versions are read from
# terraform/.tflint.hcl so the pins live in exactly one place.
#
# The plugins land under $HOME, so lint must later run as the same user that
# ran this script; pass TFLINT_PLUGIN_DIR to install somewhere shared instead.
echo "  - tflint plugins"
while read -r plugin_name plugin_version; do
	plugin_dir="${TFLINT_PLUGIN_ROOT}/github.com/terraform-linters/tflint-ruleset-${plugin_name}/${plugin_version}"
	plugin_bin="${plugin_dir}/tflint-ruleset-${plugin_name}"
	if [ -x "${plugin_bin}" ]; then
		echo "      ${plugin_name} ${plugin_version} already installed"
		continue
	fi
	echo "      ${plugin_name} ${plugin_version}"
	curl -fsSL -o "${TMP_DIR}/ruleset-${plugin_name}.zip" \
		"https://github.com/terraform-linters/tflint-ruleset-${plugin_name}/releases/download/v${plugin_version}/tflint-ruleset-${plugin_name}_linux_amd64.zip"
	mkdir -p "${plugin_dir}"
	unzip -o -q "${TMP_DIR}/ruleset-${plugin_name}.zip" -d "${plugin_dir}"
	chmod +x "${plugin_bin}"
done < <(awk '
	/^plugin "/ { name = $2; gsub(/"/, "", name); version = ""; next }
	name != "" && $1 == "version" { version = $3; gsub(/"/, "", version); next }
	name != "" && /^}/ { if (version != "") print name, version; name = "" }
' "${TFLINT_CONFIG}")

echo ""
echo "Installed versions:"
shellcheck --version | grep version: | tail -1
yamllint --version
shfmt --version
terraform version | head -1
# --chdir makes tflint read terraform/.tflint.hcl, so the rulesets it lists
# confirm the plugins above are actually loadable.
tflint --chdir="${SCRIPT_DIR}/../terraform" --version

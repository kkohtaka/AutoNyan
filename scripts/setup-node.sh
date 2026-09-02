#!/bin/bash

# Brings the running machine onto the Node.js version `.nvmrc` pins, so an
# ephemeral machine (a Claude Code cloud session) lints, tests and builds on the
# same major as CI, the devcontainer and the deployed Cloud Functions. The
# version is always read from `.nvmrc` — never hardcoded — so a Renovate bump to
# that file moves every environment at once.
#
# The devcontainer and CI already derive their Node from `.nvmrc` at image build
# time, so this script is a no-op there.

set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
NODE_VERSION=$(tr -d ' \tv\r\n' <"${REPO_ROOT}/.nvmrc")

if [ -z "${NODE_VERSION}" ]; then
	echo "Could not read a version from ${REPO_ROOT}/.nvmrc" >&2
	exit 1
fi

current_version=$(node -v 2>/dev/null | tr -d 'v' || true)
if [ "${current_version}" = "${NODE_VERSION}" ]; then
	echo "Node ${NODE_VERSION} already active (matches .nvmrc)"
	exit 0
fi

case "$(uname -m)" in
x86_64) node_arch="x64" ;;
aarch64 | arm64) node_arch="arm64" ;;
*)
	echo "Unsupported architecture $(uname -m) for a Node.js binary release" >&2
	exit 1
	;;
esac

dist_name="node-v${NODE_VERSION}-linux-${node_arch}"
install_root=${NODE_INSTALL_ROOT:-"/opt/${dist_name}"}

if [ ! -x "${install_root}/bin/node" ]; then
	echo "Installing Node ${NODE_VERSION} (${node_arch}) into ${install_root}"

	tmp_dir=$(mktemp -d)
	trap 'rm -rf "${tmp_dir}"' EXIT

	# nodejs.org is on the cloud session's Trusted default egress allowlist;
	# nodejs/node's GitHub releases carry no binary assets, so this is the only
	# route. The checksum is verified because the download is a binary that then
	# runs everything else.
	curl -fsSL -o "${tmp_dir}/${dist_name}.tar.xz" \
		"https://nodejs.org/dist/v${NODE_VERSION}/${dist_name}.tar.xz"
	curl -fsSL -o "${tmp_dir}/SHASUMS256.txt" \
		"https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"
	(cd "${tmp_dir}" && grep " ${dist_name}.tar.xz\$" SHASUMS256.txt | sha256sum -c -)

	mkdir -p "${install_root}"
	tar -xJf "${tmp_dir}/${dist_name}.tar.xz" -C "${install_root}" --strip-components=1
fi

# A cloud session's shells inherit a PATH fixed when the container started, and
# re-source neither /etc/profile.d nor ~/.bashrc — so prepending a directory (or
# setting an nvm default alias) reaches nothing. Shadowing the binaries in the
# directory that currently *wins* on PATH is what actually takes effect, and it
# needs no assumption about how that PATH is ordered.
shadow_dir=$(dirname "$(command -v node || echo /usr/local/bin/node)")
if [ "${shadow_dir}" != "${install_root}/bin" ]; then
	echo "Pointing ${shadow_dir}/{node,npm,npx,corepack} at ${install_root}"
	for tool in node npm npx corepack; do
		[ -x "${install_root}/bin/${tool}" ] || continue
		ln -sfn "${install_root}/bin/${tool}" "${shadow_dir}/${tool}"
	done
fi

echo "node $(node -v), npm $(npm -v)"

active_version=$(node -v | tr -d 'v')
if [ "${active_version}" != "${NODE_VERSION}" ]; then
	echo "Node ${active_version} is active but .nvmrc pins ${NODE_VERSION}" >&2
	exit 1
fi

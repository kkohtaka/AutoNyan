#!/bin/bash

# Create a git worktree under .claude/worktrees/ with a ready-to-use node_modules.
#
# A fresh `npm ci` costs ~424MB and ~90s per worktree, which is what actually
# fills the disk when many worktrees pile up (the checkout itself is ~3MB).
# On APFS `cp -c` clones node_modules copy-on-write instead: ~7MB and ~3s, with
# blocks shared until npm rewrites a file.

set -euo pipefail

usage() {
	echo "Usage: $(basename "$0") <name> [branch]"
	echo ""
	echo "  name    Worktree directory name under .claude/worktrees/"
	echo "  branch  Branch to check out (default: <name>, created from origin/master)"
	exit 1
}

[ $# -ge 1 ] || usage

NAME="$1"
BRANCH="${2:-$NAME}"

# Resolve the main checkout even when invoked from inside another worktree,
# where .git is a file pointing into the shared common dir
GIT_COMMON_DIR="$(git rev-parse --path-format=absolute --git-common-dir)"
MAIN_ROOT="$(dirname "${GIT_COMMON_DIR}")"
WORKTREE_PATH="${MAIN_ROOT}/.claude/worktrees/${NAME}"

if [ -e "${WORKTREE_PATH}" ]; then
	echo "❌ ${WORKTREE_PATH} already exists."
	exit 1
fi

echo "📥 Fetching origin..."
git -C "${MAIN_ROOT}" fetch origin

echo "🌱 Creating worktree at ${WORKTREE_PATH}..."
if git -C "${MAIN_ROOT}" show-ref --verify --quiet "refs/heads/${BRANCH}"; then
	git -C "${MAIN_ROOT}" worktree add "${WORKTREE_PATH}" "${BRANCH}"
else
	git -C "${MAIN_ROOT}" worktree add -b "${BRANCH}" "${WORKTREE_PATH}" origin/master
fi

if [ -d "${MAIN_ROOT}/node_modules" ]; then
	echo "📦 Cloning node_modules from the main checkout..."
	cp -c -R "${MAIN_ROOT}/node_modules" "${WORKTREE_PATH}/node_modules"

	# The clone reflects the main checkout's lockfile, which may be older or
	# newer than this branch's
	if ! cmp -s "${MAIN_ROOT}/package-lock.json" "${WORKTREE_PATH}/package-lock.json"; then
		echo "🔄 package-lock.json differs from the main checkout; reconciling..."
		npm install --prefix "${WORKTREE_PATH}"
	fi
else
	echo "📦 Main checkout has no node_modules; installing from scratch..."
	npm ci --prefix "${WORKTREE_PATH}"
fi

echo ""
echo "✅ Worktree ready on branch '${BRANCH}':"
echo "   ${WORKTREE_PATH}"

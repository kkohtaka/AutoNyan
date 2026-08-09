#!/usr/bin/env bash

project_dir="${CLAUDE_PROJECT_DIR:-"$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"}"

echo "[$(date)] $USER: $(jq -r '.tool_input.command')" >>"${project_dir}/.claude/command_history.log"

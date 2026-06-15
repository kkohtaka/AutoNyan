#!/usr/bin/env bash

echo "[$(date)] $USER: $(jq -r '.tool_input.command')" >> /workspaces/AutoNyan/.claude/command_history.log

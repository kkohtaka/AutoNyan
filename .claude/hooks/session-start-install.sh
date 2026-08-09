#!/usr/bin/env bash

# The devcontainer image already has node_modules installed; only a cloud
# session starts from a fresh clone with no install step of its own.
if [ -n "$CLAUDE_CODE_REMOTE" ]; then
	npm install
fi

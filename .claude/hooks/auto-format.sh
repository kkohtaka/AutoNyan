#!/usr/bin/env bash

jq -r '.tool_input.file_path | select(endswith(".js") or endswith(".ts") or endswith(".jsx") or endswith(".tsx"))' | xargs --no-run-if-empty npx prettier --write

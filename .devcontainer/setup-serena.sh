#!/bin/bash
set -e

# Create Serena cache directory
echo "Creating Serena cache directory..."
mkdir -p "$(pwd)/.serena/cache"

# Check if Serena MCP server is already configured
if claude mcp list 2>&1 | grep -q "serena:"; then
  echo "Serena MCP server is already configured"
  exit 0
fi

# Add Serena MCP server
echo "Adding Serena MCP server to Claude Code..."
claude mcp add serena -- uvx --from git+https://github.com/oraios/serena serena start-mcp-server --context claude-code --project "$(pwd)"

echo "Serena MCP server configured successfully"

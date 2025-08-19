#!/bin/bash

# Exit on error
set -e

# Change to project root directory
cd "$(dirname "$0")/.."

# Get list of function directories
mapfile -t FUNCTIONS < <(find src/functions -maxdepth 1 -mindepth 1 -type d -exec basename {} \;)

# Copy shared utilities to each function directory for testing
echo "Setting up shared utilities for testing..."
for FUNCTION in "${FUNCTIONS[@]}"; do
	echo "  - Copying shared utilities to $FUNCTION..."
	mkdir -p "src/functions/$FUNCTION/shared"
	cp "src/shared"/*.ts "src/functions/$FUNCTION/shared/"
done

echo "Test setup complete!"

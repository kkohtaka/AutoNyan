#!/bin/bash

# Exit on error
set -e

# Change to project root directory
cd "$(dirname "$0")/.."

# Get list of function directories
mapfile -t FUNCTIONS < <(find src/functions -maxdepth 1 -mindepth 1 -type d -exec basename {} \;)

# Clean up shared utilities from function directories after testing
echo "Cleaning up shared utilities after testing..."
for FUNCTION in "${FUNCTIONS[@]}"; do
	echo "  - Removing shared utilities from $FUNCTION..."
	rm -rf "src/functions/$FUNCTION/shared"
done

echo "Test cleanup complete!"

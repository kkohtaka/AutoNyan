#!/bin/bash

# Exit on error
set -e

# Build TypeScript
echo "Building TypeScript..."
npm run build

# Get list of function directories
FUNCTIONS=($(ls -d src/functions/*/ | xargs -n 1 basename))

# Copy function-specific package.json files (Cloud Functions will install dependencies)
echo "Preparing function packages..."
for FUNCTION in "${FUNCTIONS[@]}"; do
	echo "  - Preparing $FUNCTION function package..."
	cp "src/functions/$FUNCTION/package.json" "dist/functions/$FUNCTION/"
done

# Create function zips (source code only)
echo "Creating function zips..."
for FUNCTION in "${FUNCTIONS[@]}"; do
	echo "  - Creating $FUNCTION function zip..."
	pushd "dist/functions/$FUNCTION" >/dev/null
	rm -f "../$FUNCTION.zip"
	zip -r "../$FUNCTION.zip" . -x "*test.js" "node_modules/*"
	popd >/dev/null
done

echo "Build complete! Function zips created:"
for FUNCTION in "${FUNCTIONS[@]}"; do
	echo "  - dist/functions/$FUNCTION.zip"
done

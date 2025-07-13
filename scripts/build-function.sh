#!/bin/bash

# Exit on error
set -e

# Build TypeScript
echo "Building TypeScript..."
npm run build

# Get list of function directories
mapfile -t FUNCTIONS < <(find src/functions -maxdepth 1 -mindepth 1 -type d -exec basename {} \;)

# Copy function source files for Cloud Functions to compile
echo "Preparing function packages..."
for FUNCTION in "${FUNCTIONS[@]}"; do
	echo "  - Preparing $FUNCTION function package..."
	mkdir -p "dist/functions/$FUNCTION"
	cp "src/functions/$FUNCTION/package.json" "dist/functions/$FUNCTION/"
	cp "src/functions/$FUNCTION/tsconfig.json" "dist/functions/$FUNCTION/"
	cp "src/functions/$FUNCTION"/*.ts "dist/functions/$FUNCTION/"
done

# Create function zips (TypeScript source files for Cloud Functions to compile)
echo "Creating function zips..."
for FUNCTION in "${FUNCTIONS[@]}"; do
	echo "  - Creating $FUNCTION function zip..."
	pushd "dist/functions/$FUNCTION" >/dev/null
	rm -f "../$FUNCTION.zip"
	zip -r "../$FUNCTION.zip" . -x "*test.ts" "node_modules/*"
	popd >/dev/null
done

echo "Build complete! Function zips created:"
for FUNCTION in "${FUNCTIONS[@]}"; do
	echo "  - dist/functions/$FUNCTION.zip"
done

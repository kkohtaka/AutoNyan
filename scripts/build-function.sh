#!/bin/bash

# Exit on error
set -e

# Get list of function directories
mapfile -t FUNCTIONS < <(find src/functions -maxdepth 1 -mindepth 1 -type d -exec basename {} \;)

# Copy shared utilities to each function directory before building
echo "Copying shared utilities..."
for FUNCTION in "${FUNCTIONS[@]}"; do
	echo "  - Copying shared utilities to $FUNCTION..."
	mkdir -p "src/functions/$FUNCTION/shared"
	cp "src/shared"/*.ts "src/functions/$FUNCTION/shared/"
	# Also copy the shared tsconfig.json to the shared directory
	cp "src/shared/tsconfig.json" "src/functions/$FUNCTION/shared/"
done

# Build shared module first
echo "Building shared module..."
npm run build --workspace=src/shared

# Build TypeScript
echo "Building TypeScript..."
npm run build

# Copy function source files for Cloud Functions to compile
echo "Preparing function packages..."
for FUNCTION in "${FUNCTIONS[@]}"; do
	echo "  - Preparing $FUNCTION function package..."
	mkdir -p "dist/functions/$FUNCTION"
	cp "src/functions/$FUNCTION/package.json" "dist/functions/$FUNCTION/"
	# Copy and modify tsconfig.json to include shared files for cloud deployment
	sed 's/"include": \["index.ts", "index.test.ts"\]/"include": ["index.ts", "shared\/**\/*"]/' "src/functions/$FUNCTION/tsconfig.json" |
		sed '/^[[:space:]]*"references":/,/^[[:space:]]*\]/d' >"dist/functions/$FUNCTION/tsconfig.json"

	# Copy and transform TypeScript files to use relative imports
	for ts_file in "src/functions/$FUNCTION"/*.ts; do
		if [ -f "$ts_file" ]; then
			filename=$(basename "$ts_file")
			# Transform 'autonyan-shared' imports to './shared' for cloud deployment
			sed "s/from 'autonyan-shared'/from '.\/shared'/g" "$ts_file" >"dist/functions/$FUNCTION/$filename"
		fi
	done

	# Copy shared utilities
	mkdir -p "dist/functions/$FUNCTION/shared"
	cp "src/functions/$FUNCTION/shared"/*.ts "dist/functions/$FUNCTION/shared/"
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

# Clean up shared utilities from function directories
echo "Cleaning up shared utilities..."
for FUNCTION in "${FUNCTIONS[@]}"; do
	rm -rf "src/functions/$FUNCTION/shared"
done

echo "Build complete! Function zips created:"
for FUNCTION in "${FUNCTIONS[@]}"; do
	echo "  - dist/functions/$FUNCTION.zip"
done

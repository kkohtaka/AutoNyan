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

# Build TypeScript (compiles to .js files)
echo "Building TypeScript..."
npm run build

# Prepare function packages with compiled JavaScript
echo "Preparing function packages..."
for FUNCTION in "${FUNCTIONS[@]}"; do
	echo "  - Preparing $FUNCTION function package..."
	mkdir -p "dist/functions/$FUNCTION"

	# Copy package.json and modify to remove workspace dependency
	cp "src/functions/$FUNCTION/package.json" "dist/functions/$FUNCTION/"

	# Copy compiled JavaScript files (from src/functions/$FUNCTION/*.js)
	for js_file in "src/functions/$FUNCTION"/*.js; do
		if [ -f "$js_file" ]; then
			filename=$(basename "$js_file")
			# Skip test files
			if [[ ! "$filename" =~ \.test\.js$ ]] && [[ ! "$filename" =~ \.spec\.js$ ]]; then
				# Transform 'autonyan-shared' and "autonyan-shared" imports to './shared' for deployment
				sed "s/from ['\"]autonyan-shared['\"]/from '.\/shared'/g; s/require(['\"]autonyan-shared['\"])/require('.\/shared')/g" "$js_file" >"dist/functions/$FUNCTION/$filename"
			fi
		fi
	done

	# Copy compiled shared utilities (.js files from src/shared/dist)
	mkdir -p "dist/functions/$FUNCTION/shared"
	if [ -d "src/shared/dist" ]; then
		for shared_js in src/shared/dist/*.js; do
			if [ -f "$shared_js" ] && [[ ! "$(basename "$shared_js")" =~ \.test\.js$ ]] && [[ ! "$(basename "$shared_js")" =~ \.spec\.js$ ]]; then
				cp "$shared_js" "dist/functions/$FUNCTION/shared/"
			fi
		done
	fi

	# Install production dependencies in the function directory
	echo "  - Installing production dependencies for $FUNCTION..."
	pushd "dist/functions/$FUNCTION" >/dev/null
	# Modify package.json for Cloud Functions deployment:
	# - Remove autonyan-shared workspace dependency
	# - Remove devDependencies
	# - Remove scripts (prevent Cloud Functions from running build commands)
	node -e "
    const pkg = require('./package.json');
    delete pkg.dependencies['autonyan-shared'];
    delete pkg.devDependencies;
    delete pkg.scripts;
    require('fs').writeFileSync('./package.json', JSON.stringify(pkg, null, 2));
  "
	npm install --omit=dev --silent --no-audit --no-fund
	popd >/dev/null
done

# Create function zips (compiled JavaScript + node_modules)
echo "Creating function zips..."
for FUNCTION in "${FUNCTIONS[@]}"; do
	echo "  - Creating $FUNCTION function zip..."
	pushd "dist/functions/$FUNCTION" >/dev/null
	rm -f "../$FUNCTION.zip"
	# Include compiled .js files and node_modules, exclude source and test files
	zip -r "../$FUNCTION.zip" . -x "*.ts" "*.test.js" "*.spec.js" "*.map" "tsconfig.json"
	popd >/dev/null
done

# Clean up shared utilities from function directories
echo "Cleaning up shared utilities..."
for FUNCTION in "${FUNCTIONS[@]}"; do
	rm -rf "src/functions/$FUNCTION/shared"
done

echo "Build complete! Function zips created:"
for FUNCTION in "${FUNCTIONS[@]}"; do
	ZIP_SIZE=$(du -h "dist/functions/$FUNCTION.zip" | cut -f1)
	echo "  - dist/functions/$FUNCTION.zip ($ZIP_SIZE)"
done

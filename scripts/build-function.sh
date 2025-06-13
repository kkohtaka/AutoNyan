#!/bin/bash

# Exit on error
set -e

# Build TypeScript
echo "Building TypeScript..."
npm run build

# Create function zip
echo "Creating function zip..."
cd dist/functions/hello
rm -f ../hello.zip
zip -r ../hello.zip . -x "*test.js"
cd ../../..

echo "Build complete! Function zip created at dist/functions/hello.zip" 
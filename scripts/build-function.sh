#!/bin/zsh

# Exit on error
set -e

# Build TypeScript
echo "Building TypeScript..."
npm run build

# Create function zip
echo "Creating function zip..."
cd dist/functions/hello
zip -r ../hello.zip ./*
cd ../../..

echo "Build complete! Function zip created at dist/functions/hello.zip" 
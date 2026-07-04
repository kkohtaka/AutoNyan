#!/bin/bash

# Setup Git hooks for AutoNyan project
# This script installs pre-push hook to run lint and tests before pushing

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# Resolve via git so this works in worktrees, where .git is a file
HOOKS_DIR="$(git -C "${PROJECT_ROOT}" rev-parse --path-format=absolute --git-path hooks)"

echo "Setting up Git hooks for AutoNyan..."

# Create pre-push hook
cat >"${HOOKS_DIR}/pre-push" <<'EOF'
#!/bin/bash

# Pre-push hook: Build, lint, and test before pushing
# This prevents pushing code that will fail CI

set -e

echo "🔍 Running pre-push checks..."
echo ""

# Build TypeScript to ensure .js files are up-to-date before linting
echo "🏗️  Building TypeScript..."
if ! npm run build; then
    echo ""
    echo "❌ Build failed. Please fix the errors before pushing."
    echo "   Run 'npm run build' to see details."
    exit 1
fi

# Run TypeScript and JSON linters (skip YAML, Terraform, Shell that require system packages)
# Full linting (including YAML, Terraform, Shell) will be performed in CI
echo ""
echo "📝 Running TypeScript and JSON linters..."
if ! npm run lint:ts; then
    echo ""
    echo "❌ TypeScript linting failed. Please fix the errors before pushing."
    echo "   Run 'npm run lint:ts' to see details."
    exit 1
fi

if ! npm run lint:json; then
    echo ""
    echo "❌ JSON linting failed. Please fix the errors before pushing."
    echo "   Run 'npm run lint:json' to see details."
    exit 1
fi

# Run tests with coverage thresholds (matches CI's test-functions job)
echo ""
echo "🧪 Running tests with coverage..."
if ! npm run test:coverage; then
    echo ""
    echo "❌ Tests failed or coverage thresholds not met. Please fix before pushing."
    echo "   Run 'npm run test:coverage' to see details."
    exit 1
fi

echo ""
echo "✅ All pre-push checks passed!"
exit 0
EOF

# Make the hook executable
chmod +x "${HOOKS_DIR}/pre-push"

echo "✅ Git hooks installed successfully!"
echo ""
echo "Pre-push hook will now run 'npm run build', 'npm run lint', and 'npm run test:coverage' before every push."
echo "To skip the hook temporarily, use: git push --no-verify"

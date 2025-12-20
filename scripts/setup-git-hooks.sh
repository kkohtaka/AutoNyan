#!/bin/bash

# Setup Git hooks for AutoNyan project
# This script installs pre-push hook to run lint and tests before pushing

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
HOOKS_DIR="${PROJECT_ROOT}/.git/hooks"

echo "Setting up Git hooks for AutoNyan..."

# Create pre-push hook
cat >"${HOOKS_DIR}/pre-push" <<'EOF'
#!/bin/bash

# Pre-push hook: Run TypeScript lint and tests before pushing
# This prevents pushing code that will fail CI

set -e

echo "🔍 Running pre-push checks..."
echo ""

# Run TypeScript and JSON linters (skip YAML, Terraform, Shell that require system packages)
# Full linting (including YAML, Terraform, Shell) will be performed in CI
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

# Run tests
echo ""
echo "🧪 Running tests..."
if ! npm test; then
    echo ""
    echo "❌ Tests failed. Please fix the failing tests before pushing."
    echo "   Run 'npm test' to see details."
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
echo "Pre-push hook will now run 'npm run lint' and 'npm test' before every push."
echo "To skip the hook temporarily, use: git push --no-verify"

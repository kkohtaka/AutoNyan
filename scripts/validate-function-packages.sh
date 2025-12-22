#!/bin/bash

# Exit on error
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🔍 Validating function deployment packages..."

# Get list of function directories
mapfile -t FUNCTIONS < <(find src/functions -maxdepth 1 -mindepth 1 -type d -exec basename {} \;)

VALIDATION_ERRORS=0

for FUNCTION in "${FUNCTIONS[@]}"; do
	echo ""
	echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	echo "Validating: $FUNCTION"
	echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

	ZIP_FILE="dist/functions/$FUNCTION.zip"

	# Check if zip file exists
	if [ ! -f "$ZIP_FILE" ]; then
		echo -e "${RED}❌ ERROR: Zip file not found: $ZIP_FILE${NC}"
		VALIDATION_ERRORS=$((VALIDATION_ERRORS + 1))
		continue
	fi

	echo -e "${GREEN}✓${NC} Zip file exists: $ZIP_FILE"

	# Create temporary directory for extraction
	TEMP_DIR=$(mktemp -d)

	# Extract zip file
	echo "  Extracting to temporary directory..."
	unzip -q "$ZIP_FILE" -d "$TEMP_DIR"

	# Test zip file integrity
	echo "  Testing zip file integrity..."
	if unzip -t "$ZIP_FILE" >/dev/null 2>&1; then
		echo -e "${GREEN}  ✓${NC} Zip file integrity check passed"
	else
		echo -e "${RED}  ❌ Zip file is corrupted${NC}"
		VALIDATION_ERRORS=$((VALIDATION_ERRORS + 1))
	fi

	# Validate required files exist
	echo "  Checking required files..."

	REQUIRED_FILES=(
		"package.json"
		"index.js"
	)

	for FILE in "${REQUIRED_FILES[@]}"; do
		if [ ! -f "$TEMP_DIR/$FILE" ]; then
			echo -e "${RED}  ❌ Missing required file: $FILE${NC}"
			VALIDATION_ERRORS=$((VALIDATION_ERRORS + 1))
		else
			echo -e "${GREEN}  ✓${NC} Found: $FILE"
		fi
	done

	# Check if shared utilities are included
	if [ ! -d "$TEMP_DIR/shared" ]; then
		echo -e "${RED}  ❌ Missing shared utilities directory${NC}"
		VALIDATION_ERRORS=$((VALIDATION_ERRORS + 1))
	else
		SHARED_FILE_COUNT=$(find "$TEMP_DIR/shared" -name "*.js" | wc -l)
		if [ "$SHARED_FILE_COUNT" -eq 0 ]; then
			echo -e "${RED}  ❌ Shared directory exists but contains no JavaScript files${NC}"
			VALIDATION_ERRORS=$((VALIDATION_ERRORS + 1))
		else
			echo -e "${GREEN}  ✓${NC} Shared utilities included ($SHARED_FILE_COUNT files)"
		fi
	fi

	# Check if node_modules exists
	if [ ! -d "$TEMP_DIR/node_modules" ]; then
		echo -e "${RED}  ❌ Missing node_modules directory${NC}"
		VALIDATION_ERRORS=$((VALIDATION_ERRORS + 1))
	else
		MODULE_COUNT=$(find "$TEMP_DIR/node_modules" -maxdepth 1 -type d | wc -l)
		echo -e "${GREEN}  ✓${NC} node_modules included ($((MODULE_COUNT - 1)) packages)"
	fi

	# Validate no test files are included
	echo "  Checking for excluded files..."
	TEST_FILES=$(find "$TEMP_DIR" -name "*.test.js" -o -name "*.spec.js" -o -name "*.test.ts" -o -name "*.spec.ts" | wc -l)
	if [ "$TEST_FILES" -gt 0 ]; then
		echo -e "${RED}  ❌ Test files found in package ($TEST_FILES files)${NC}"
		find "$TEMP_DIR" -name "*.test.js" -o -name "*.spec.js" -o -name "*.test.ts" -o -name "*.spec.ts" | while read -r file; do
			echo -e "${RED}     - $(basename "$file")${NC}"
		done
		VALIDATION_ERRORS=$((VALIDATION_ERRORS + 1))
	else
		echo -e "${GREEN}  ✓${NC} No test files included"
	fi

	# Validate no TypeScript source files are included (except type definitions)
	echo "  Checking for TypeScript source files..."
	TS_FILES=$(find "$TEMP_DIR" -name "*.ts" ! -name "*.d.ts" | wc -l)
	if [ "$TS_FILES" -gt 0 ]; then
		echo -e "${RED}  ❌ TypeScript source files found in package ($TS_FILES files)${NC}"
		find "$TEMP_DIR" -name "*.ts" ! -name "*.d.ts" | while read -r file; do
			echo -e "${RED}     - $(basename "$file")${NC}"
		done
		VALIDATION_ERRORS=$((VALIDATION_ERRORS + 1))
	else
		echo -e "${GREEN}  ✓${NC} No TypeScript source files included"
	fi

	# Check import statements in JavaScript files
	echo "  Checking import statements..."
	AUTONYAN_IMPORTS=$(grep -rE "(from ['\"]autonyan-shared['\"]|require\(['\"]autonyan-shared['\"]\))" "$TEMP_DIR" --include="*.js" 2>/dev/null | wc -l || true)
	if [ "$AUTONYAN_IMPORTS" -gt 0 ]; then
		echo -e "${RED}  ❌ Found 'autonyan-shared' imports (should be './shared')${NC}"
		grep -rE "(from ['\"]autonyan-shared['\"]|require\(['\"]autonyan-shared['\"]\))" "$TEMP_DIR" --include="*.js" 2>/dev/null | while read -r line; do
			echo -e "${RED}     $line${NC}"
		done
		VALIDATION_ERRORS=$((VALIDATION_ERRORS + 1))
	else
		echo -e "${GREEN}  ✓${NC} All imports use relative paths"
	fi

	# Validate entry point function exists
	echo "  Validating entry point function..."
	# Map function directory names to entry point function names (from Terraform config)
	case "$FUNCTION" in
	"drive-scanner")
		ENTRY_POINT="driveScanner"
		;;
	"doc-processor")
		ENTRY_POINT="docProcessor"
		;;
	"text-vision-processor")
		ENTRY_POINT="textVisionProcessor"
		;;
	"text-firebase-writer")
		ENTRY_POINT="textFirebaseWriter"
		;;
	"file-classifier")
		ENTRY_POINT="fileClassifier"
		;;
	*)
		echo -e "${YELLOW}  ⚠️  Warning: Unknown function $FUNCTION, skipping entry point validation${NC}"
		ENTRY_POINT=""
		;;
	esac

	if [ -n "$ENTRY_POINT" ]; then
		if grep -q "exports\.$ENTRY_POINT\|exports\.\[\"$ENTRY_POINT\"\]\|exports\.\['$ENTRY_POINT'\]" "$TEMP_DIR/index.js" 2>/dev/null; then
			echo -e "${GREEN}  ✓${NC} Entry point function '$ENTRY_POINT' found"
		else
			echo -e "${RED}  ❌ Entry point function '$ENTRY_POINT' not found in index.js${NC}"
			echo -e "${RED}     Expected: exports.$ENTRY_POINT${NC}"
			VALIDATION_ERRORS=$((VALIDATION_ERRORS + 1))
		fi
	fi

	# Check package size (Cloud Functions limit: 500MB)
	ZIP_SIZE_BYTES=$(stat -f%z "$ZIP_FILE" 2>/dev/null || stat -c%s "$ZIP_FILE")
	ZIP_SIZE_MB=$((ZIP_SIZE_BYTES / 1024 / 1024))
	ZIP_SIZE_HUMAN=$(du -h "$ZIP_FILE" | cut -f1)

	if [ "$ZIP_SIZE_BYTES" -gt 524288000 ]; then
		echo -e "${RED}  ❌ Package size exceeds 500MB limit: $ZIP_SIZE_HUMAN (${ZIP_SIZE_MB}MB)${NC}"
		VALIDATION_ERRORS=$((VALIDATION_ERRORS + 1))
	else
		echo -e "${GREEN}  ✓${NC} Package size: $ZIP_SIZE_HUMAN (${ZIP_SIZE_MB}MB / 500MB limit)"
	fi

	# Clean up temp directory
	rm -rf "$TEMP_DIR"

	if [ "$VALIDATION_ERRORS" -eq 0 ]; then
		echo -e "${GREEN}✅ $FUNCTION validation passed${NC}"
	fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ "$VALIDATION_ERRORS" -gt 0 ]; then
	echo -e "${RED}❌ Validation failed with $VALIDATION_ERRORS error(s)${NC}"
	exit 1
else
	echo -e "${GREEN}✅ All function packages validated successfully!${NC}"
fi

# E2E Test Fixtures

This directory contains sample documents for end-to-end testing.

## Sample Documents

### test-document.txt
A simple text file with invoice information for testing the complete pipeline.

### test-invoice.pdf (To be added)
To create a test PDF:
```bash
# On Linux/macOS with LibreOffice installed:
libreoffice --headless --convert-to pdf test-document.txt --outdir fixtures/sample-documents/
mv test-document.pdf test-invoice.pdf

# Or use an online converter to convert test-document.txt to PDF
```

### test-receipt.png (To be added)
To create a test image:
```bash
# Create a simple image with text using ImageMagick:
convert -size 800x600 xc:white \
  -font Arial -pointsize 24 -fill black \
  -gravity center -annotate +0+0 'Receipt\n\nTotal: $99.99\nDate: 2024-01-15' \
  test-receipt.png

# Or take a screenshot of test-document.txt and save as test-receipt.png
```

## Requirements

- Files should be small (< 1MB) to minimize Vision API costs
- Content should be readable by Vision API OCR
- Files should have meaningful text for AI classification testing

## Usage

These fixtures are automatically used by the full pipeline E2E test in `tests/e2e/full-pipeline.e2e.test.ts`.

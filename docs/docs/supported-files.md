---
title: Supported File Types
sidebar_position: 4
---

# Supported File Types

AutoNyan reads the text inside your documents in order to classify and file
them. Which file types it can read end to end is what this page describes.

## Fully supported

These documents are read, classified, and filed automatically:

- **PDF** (`.pdf`) — including scanned or photographed pages that have been saved
  as a PDF. The text inside the PDF is extracted for you, even when the page is
  an image of paper.
- **Plain text** (`.txt`).

For the best results, **save or export documents as PDF** before dropping them in
the watched folder.

## Picked up, but not yet read

AutoNyan currently *notices* the following types and copies them, but it cannot
yet extract their text. As a result they are **not classified or filed**, and you
will not get a useful summary for them:

- **Microsoft Office** — Word (`.doc`, `.docx`), Excel (`.xls`, `.xlsx`),
  PowerPoint (`.ppt`, `.pptx`).
- **Rich Text** (`.rtf`).
- **Google Workspace** — Google Docs, Sheets, and Slides.

To process one of these today, **export it as a PDF** first (in Google Docs:
*File → Download → PDF*; in Microsoft Office: *Save As → PDF*) and drop the PDF
into the folder.

## Images on their own

A standalone image file — a photo or screenshot such as `.jpg` or `.png` — is
**not picked up** from the watched folder by itself. To process a photo of a
paper document, **save it as a PDF** first; the text will then be extracted as
described above.

:::note

This page reflects what AutoNyan does today. When in doubt, PDF is the format
that always works.

:::

## Next steps

- **[Getting Started](./getting-started.md)** — add your first document.
- **[How AutoNyan Works](./overview.md)** — the concepts behind the flow.

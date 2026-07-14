---
title: How AutoNyan Works
sidebar_position: 2
---

# How AutoNyan Works

AutoNyan turns a single shared Google Drive folder into a self-organizing inbox.
You drop documents in; AutoNyan reads each one, decides where it belongs, files
it, and tells you what it did. Everything below happens automatically — there is
nothing to click.

## The flow, end to end

When you add a document to the watched folder, it travels through five steps:

1. **Discovered** — AutoNyan periodically checks the watched folder and notices
   any new documents you have added.
2. **Read** — the text inside each document is extracted, including scanned or
   photographed pages saved as a PDF.
3. **Classified** — the extracted text is matched against your categories, and
   AutoNyan chooses the one that fits best.
4. **Filed** — the document is moved into the matching category folder and
   renamed to a short, content-based name that matches how the files already in
   that folder are named. If nothing fits well, it goes to an **Uncategorized**
   folder instead — with its original name — so a document is never lost.
5. **Reported** — you receive an email summarizing what was processed, which
   category each document landed in, and a short summary of its contents.

> **You drop a file → Discovered → Read → Classified → Filed → You get an
> email**

## You define the categories

AutoNyan does not invent categories. The categories are simply the **folders you
create** inside the category area of Drive — for example `Invoices`, `Receipts`,
or `Contracts`. AutoNyan reads your folder names and files each document into the
one that fits. To add a new category, create a new folder; to retire one, remove
it. You stay in control of how your documents are organized.

## What stays the same for you

- You keep using Google Drive exactly as you do today.
- You never have to sort documents by hand.
- Original documents are moved, not deleted — you can always find them in their
  category folder.

:::note

This site describes AutoNyan from a user's point of view. If you want to deploy
or operate AutoNyan yourself, see the
[developer documentation](https://github.com/kkohtaka/AutoNyan#readme) in the
project repository.

:::

## Next steps

- **[Getting Started](./getting-started.md)** — what you need and how to add your
  first document.
- **[Supported File Types](./supported-files.md)** — which kinds of documents
  AutoNyan can read.

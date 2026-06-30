---
title: Daily Use
sidebar_position: 5
---

# Daily Use

This is the everyday flow: you drop a document into Drive, AutoNyan classifies
and files it, and you read the notification email. There is nothing to install
and nothing to click — once a document is in the watched folder, the rest is
automatic.

## Putting documents in

Add documents to the **watched Drive folder** that was shared with you — the
same folder you used for your first document in
[Getting Started](./getting-started.md). Drag a file in, or upload it the way
you normally would in Google Drive.

A few things to expect:

- **Processing is not instant.** AutoNyan scans the watched folder on a
  schedule — about **once an hour** by default — rather than the moment you drop
  a file. If a document is still sitting in the watched folder a few minutes
  after you added it, that is normal; it simply has not been scanned yet.
- **Add as many documents as you like.** Each one is processed on its own, so
  you can drop a whole batch in at once.
- **Stick to supported formats.** AutoNyan reads PDF and plain-text files end to
  end. Other types may be noticed but not read, so they will not be classified
  or filed. See [Supported File Types](./supported-files.md) for the details —
  when in doubt, save the document as a PDF first.

## Classification and filing

When a scan picks up your document, AutoNyan reads the text inside it and
decides where it belongs:

1. **It reads your categories.** Your categories are simply the folders you
   created in the category area of Drive (for example `Invoices`, `Receipts`,
   `Contracts`). AutoNyan looks at the current list every time, so any folder
   you add or rename is taken into account on the next document.
2. **It picks the best fit.** The document's text is matched against your
   category names, and AutoNyan chooses the single category that fits best. It
   also produces a short summary of the document and a confidence figure for how
   sure it is about the category.
3. **It files the document.** The file is **moved** out of the watched folder
   and into the matching category folder. If nothing fits well, it goes to the
   **Uncategorized** folder instead — so a document is never lost, even when
   AutoNyan is unsure.

A few things worth knowing:

- **"Uncategorized" means "no good match," not "failed."** The document was read
  and filed; AutoNyan just did not find a category confident enough to use. If
  you expected it to land somewhere specific, check that a matching category
  folder exists, then move the file there yourself.
- **Files are moved, not copied.** After filing, the document is no longer in the
  watched folder — look for it in its category folder (or Uncategorized).
- **You stay in control of categories.** To create a new category, add a folder;
  to retire one, remove it. AutoNyan never invents categories on its own.

## Notification emails

After AutoNyan finishes with a document, it sends a **notification email** so
you know what happened without having to go and look. You get one email per
document.

:::note

Notification emails are currently sent in **Japanese**, regardless of the
language you are reading these docs in.

:::

**Who receives them.** Success notifications go to the people the **destination
category folder** is shared with — so whoever can see a category folder is told
when a new document lands in it. Failure notifications go to the **owner** of the
relevant folder.

**When a document is processed successfully**, the email tells you:

- the **file name** that was processed,
- the **category** it was filed under (or *Uncategorized* if nothing fit),
- a **confidence** figure for that category,
- the **reasoning** behind the choice, and
- a short **summary** of the document's contents.

This is usually all you need to confirm a document was filed where you expected.

**When something goes wrong**, AutoNyan sends a failure notification instead. It
names the stage where processing stopped and includes the error, so the folder
owner can look into it. If you receive one of these, or a document never seems to
get processed, see [Troubleshooting & FAQ](./troubleshooting.md).

## Next steps

- **[How AutoNyan Works](./overview.md)** — the concepts behind the flow.
- **[Supported File Types](./supported-files.md)** — what AutoNyan can read.
- **[Troubleshooting & FAQ](./troubleshooting.md)** — when something does not
  look right.

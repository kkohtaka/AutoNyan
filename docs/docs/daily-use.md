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
   and into the matching category folder, and **renamed** to a short name that
   describes its contents, following the naming style of the files already in
   that folder. If nothing fits well, it goes to the **Uncategorized** folder
   instead — keeping its original name — so a document is never lost, even when
   AutoNyan is unsure.

A few things worth knowing:

- **"Uncategorized" means "no good match," not "failed."** The document was read
  and filed; AutoNyan just did not find a category confident enough to use. If
  you expected it to land somewhere specific, create that category folder — see
  below.
- **Adding a category folder works backwards, too.** Whenever the set of
  category folders changes, AutoNyan re-examines the documents sitting in
  *Uncategorized* and files the ones that now match, about once an hour. You do
  not have to move anything by hand, and documents that still match nothing stay
  where they are without sending another email.
- **Files are moved, not copied.** After filing, the document is no longer in the
  watched folder — look for it in its category folder (or Uncategorized).
- **Renaming is careful, not forced.** The new name always keeps the original
  file extension, and when AutoNyan is not confident enough about a better name,
  the file simply keeps its original one. Documents filed under Uncategorized
  are never renamed — if one is later re-filed into a category folder, it is
  renamed at that point, and the email tells you the name it had before.
- **You stay in control of categories.** To create a new category, add a folder;
  to retire one, remove it. AutoNyan never invents categories on its own.

## Calendar registration

Some watched folders have a **calendar** attached to them. For a document in one
of those, AutoNyan also reads the dates out of the text and registers them as
events — useful when one document carries a month of them, like a school
newsletter.

This happens **in parallel with classification**, so events are registered
whether or not the document was filed successfully, including when it lands in
*Uncategorized*.

### Which folders are watched

Not all of them. Whoever runs your AutoNyan instance decides which folders are
watched for events and which calendar each one writes to, and gives each pairing
a short **label** — `Class newsletter`, say — that appears in the subject line of
the email. A document from a folder with no calendar attached is classified and
filed exactly as before, and nothing about it changes.

If you are not sure whether your folder is watched, ask them; there is nothing
in Drive that shows it.

### What lands on the calendar

Only entries whose date AutoNyan can actually pin down become events. For each
one:

- **A date with a time** becomes a timed event. If the document gives no end
  time, the event is **one hour** long by default.
- **A date with no time** becomes an **all-day** event.
- **A year that the document leaves out** — as most newsletters do, writing just
  `15日（水）` — is resolved against the date the document itself was last
  modified in Drive, rolling into the next year when the month has already
  passed. A January entry in a March newsletter is therefore *next* January.
- **The location and any note** in the document are carried onto the event.
- **Reminders follow your own calendar settings.** AutoNyan does not choose a
  reminder for you.

AutoNyan **cannot invite anyone** to the events it creates. They appear on the
calendar for everyone who already has access to that calendar, but nobody is
sent an invitation.

### One document, one email

However many events a document produced — one or thirty — you get **a single
email**, not one per event. It tells you:

- the **calendar** the events went to and the **file** they came from,
- the list of **events that were registered**, with their dates and times,
- the list of **events that were not registered** because AutoNyan was not
  confident enough about them, each with its confidence figure — these are
  reported rather than dropped silently, so you can add them by hand if they are
  real, and
- a warning **if the document was too long to read all of it**, which means some
  events may be missing entirely.

**Who receives it.** Unlike the classification email, which goes to the people
the *destination category folder* is shared with, the calendar email goes to the
people the **watched folder** is shared with — everyone who can put documents in
is told what came out.

### Adding the same document again

**Re-adding or re-scanning a document creates no duplicates and sends no second
email.** Each event is identified by the document it came from together with its
date and title, so registering it a second time does nothing. Since no new event
was registered, no email is sent either — silence after a re-add is the expected
result, not a failure.

One consequence is worth knowing: if a **corrected** version of a document moves
an event to a different date, that counts as a *new* event. The event on the old
date stays on the calendar, and you should delete it yourself. AutoNyan never
moves or removes an event it has already created.

## Notification emails

After AutoNyan finishes with a document, it sends a **notification email** so
you know what happened without having to go and look. You get one email per
document. This section describes the email about
**classification and filing**; the separate email about calendar events is
described in [Calendar registration](#calendar-registration) above.

:::note

Notification emails are currently sent in **Japanese**, regardless of the
language you are reading these docs in.

:::

**Who receives them.** Success notifications go to the people the **destination
category folder** is shared with — so whoever can see a category folder is told
when a new document lands in it. Failure notifications go to the **owner** of the
relevant folder.

**When a document is processed successfully**, the email tells you:

- the **file name** the document now has in Drive — and, when it was renamed,
  its **original name** as well, so you can tell which document it was,
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

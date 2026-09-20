---
title: Troubleshooting & FAQ
sidebar_position: 6
---

# Troubleshooting & FAQ

When a document does not get processed, filed, or reported the way you expected,
this page helps you tell what is normal, what you can fix yourself, and when it
is time to ask whoever runs your AutoNyan instance. Every entry is framed around
what you actually see — a document that has not moved, an email that never
arrived, a file that landed in the wrong place.

## Troubleshooting

### My document is still sitting in the watched folder

This is almost always **timing, not a failure**. AutoNyan scans the watched
folder on a schedule — about **once an hour** by default — rather than the moment
you drop a file in. A document you added a few minutes ago simply has not been
scanned yet.

What to check, in order:

- **Give it time.** Wait for the next scan (up to about an hour) before assuming
  anything is wrong.
- **Confirm it is a supported file type.** AutoNyan reads PDF and plain-text
  files end to end. Other types may be noticed but not read, so they are never
  classified or filed and stay put. See
  [Supported File Types](./supported-files.md) — when in doubt, save the document
  as a PDF and drop that in instead.
- **Confirm it is in the right folder.** The document must be in the **watched
  folder** that was shared with you, not in a category folder or your own private
  Drive. If you are not sure which folder that is, see
  [Getting Started](./getting-started.md).

If a **supported** document is still in the watched folder well after the next
scan should have run, ask the person who runs your AutoNyan instance to take a
look — see [Something is genuinely broken](#something-is-genuinely-broken).

### My document landed in "Uncategorized"

**"Uncategorized" means "no good match," not "failed."** The document *was* read
and filed — AutoNyan just did not find a category it was confident enough to use,
so it filed the document safely instead of guessing. Your document is never lost.

What to do:

- **Create the category folder you expected.** Categories are just the folders
  you create in the category area of Drive. If there is no `Invoices` folder, an
  invoice has nowhere confident to go. See
  [Getting Started](./getting-started.md) for how categories work.
- **Then wait — the document sorts itself.** Whenever you add or remove a
  category folder, AutoNyan looks again at everything sitting in *Uncategorized*
  and re-files the documents that now match. This runs about once an hour, so
  give it that long before assuming nothing happened. You get an email when a
  document moves this way.
- **Or move it yourself, if you prefer.** Dragging the document into the right
  category folder works just as well; AutoNyan leaves anything you have already
  filed alone. What it will not do is rename it for you — that only happens when
  AutoNyan files it.
- **Read the notification email.** It includes the reasoning and a confidence
  figure, which usually explain why nothing matched well.

### No notification email arrived

AutoNyan emails a summary after it finishes with a document. If you did not get
one:

- **Give it time first.** No email arrives until the document has actually been
  scanned and processed, which follows the same once-an-hour schedule described
  above.
- **Check who the email goes to.** Success notifications go to the people the
  **destination category folder** is shared with — so if the document was filed
  into a folder you cannot see, you will not be notified. Failure notifications go
  to the **owner** of the relevant folder, not to you. The email about **calendar
  events** is different again: it goes to the people the **watched folder** is
  shared with.
- **Check spam and the sending address.** The notification comes from the address
  configured by whoever runs your instance. If you have never seen a notification,
  confirm with them which address it is sent from and which address it is sent
  to.
- **Remember the language.** Notification emails are currently sent in
  **Japanese**, regardless of the language you read these docs in — so an email
  may have arrived but looked unfamiliar.

If you believe an email should have reached you but never did, that is a
configuration matter for the person who runs your instance.

### My file was noticed but never read

Some file types are **picked up but not yet read** — Microsoft Office documents,
Rich Text, and Google Workspace files. AutoNyan copies them but cannot extract
their text, so they are **not classified or filed** and you will not get a useful
summary. Standalone images (a `.jpg` or `.png` on its own) are **not picked up**
from the watched folder at all.

The fix is the same in both cases: **export or save the document as a PDF** and
drop the PDF into the watched folder. See
[Supported File Types](./supported-files.md) for the full list and export tips.

### Processing seems slow

AutoNyan is **not instant by design.** It checks the watched folder on a schedule
— about once an hour by default — so there is a natural delay between dropping a
file and seeing it filed. Adding a large batch of documents at once is fine; each
is processed on its own, and they may finish at slightly different times. A wait
of up to roughly an hour is expected, not a sign of a problem.

### No events were registered from a document that clearly has some

First, check that the document is in a folder that has a **calendar attached**.
Only some watched folders do, and a document in any other folder is classified
and filed normally but never looked at for events. Whoever runs your AutoNyan
instance knows which folders are watched — nothing in Drive shows it.

If the folder is watched, the likely causes are:

- **The dates are not pinned down.** Only entries AutoNyan can resolve to an
  actual date become events. "Early next month" or a date given only as a
  weekday has nothing to register.
- **AutoNyan was not confident enough.** Events it is unsure about are *not*
  registered, but they are listed in the email under the events it did not
  register, with a confidence figure. If the email lists them there, add those
  by hand.
- **You added the same document before.** A document you have already processed
  registers nothing the second time and sends no email — that is deliberate, see
  [Daily Use](./daily-use.md#calendar-registration). The events from the first
  time are already on the calendar.
- **The document held an unreasonable number of events.** Above roughly 50,
  AutoNyan registers **none of them** rather than flooding the calendar, and
  sends a failure notification to the folder owner instead. A document that
  large usually means the text was misread.

### Nothing was registered, and a failure email arrived

If the failure notification mentions the calendar not being accessible, the
**calendar has not been shared** with AutoNyan's account, or it has been shared
without permission to change events.

This is a **permanent failure**: AutoNyan does not retry it, because retrying
cannot fix a permission. Nothing will be registered from that folder until it is
sorted out, and this is not something you can fix from Drive — ask whoever runs
your AutoNyan instance to share the calendar with the service account, giving it
permission to **make changes to events**. Once that is done, re-adding a document
will register its events.

### Only some of a long document's events appeared

AutoNyan reads a large but finite amount of text from each document. A document
longer than that is read **only up to the limit**, so events written past that
point are never seen.

You do not have to guess when this happened: **the email says so**, with a note
that the document was too long to read in full and that events may be missing.
If you see that note, check the tail end of the document and add anything missing
by hand. Splitting a very long document into two and adding them separately also
works.

### An event was registered with the wrong year

This comes from documents that write dates **without a year** — `15日（水）` and
the like, which is normal in a newsletter. AutoNyan fills in the year from the
date the **document itself was last modified** in Drive, rolling forward when the
month has already passed (a January entry in a March newsletter becomes *next*
January).

So a wrong year almost always means the document's modified date is not when it
was written — for example an old newsletter uploaded today, or a file edited long
after it was issued. Correct the events on the calendar by hand; AutoNyan does
not move an event it has already created. For documents where the year matters,
having the year written in the document itself avoids the guess entirely.

### Something is genuinely broken

A few problems are not something you can fix from Drive — for example, a document
that is a supported type but never gets processed across several scans, or a
failure notification naming a stage that stopped. These are **operator concerns**
(cloud configuration, permissions, deployment) handled by whoever runs your
AutoNyan instance.

When you report one, it helps to include the **file name**, roughly **when** you
added it, and anything the **notification email** said. The operator-facing
troubleshooting steps live in the
[developer documentation](https://github.com/kkohtaka/AutoNyan#readme), not on
this site.

## What AutoNyan can and cannot access in Drive

AutoNyan works entirely through **folders that were explicitly shared with it.**
Understanding this explains most "why can't it see my document" questions:

- **It only touches shared folders.** AutoNyan can see and work in the watched
  folder and the category folders that were shared with its account — and nothing
  else. Documents in your private Drive, or in folders that were never shared,
  are invisible to it.
- **It moves your documents; it never deletes them.** When a document is filed, it
  is *moved* from the watched folder into a category folder (or *Uncategorized*).
  The original is always somewhere you can find it — AutoNyan cannot delete your
  files or change who they are shared with.
- **It cannot reach your wider Google account.** AutoNyan has no access to your
  email, other Drives, or files outside the folders shared with it.

If AutoNyan does not seem to see a document, the most common reason is that the
document is not in a shared folder. Move it into the watched folder that was
shared with you.

## What AutoNyan can and cannot do with your calendar

Calendars work the same way Drive folders do — **explicit sharing, nothing
more:**

- **It only writes to calendars shared with it.** AutoNyan can add events to the
  calendars that were explicitly shared with its account, and to no others. Your
  personal calendar is invisible to it unless someone shared it deliberately.
- **It adds events; it does not change or remove them.** Once an event has been
  created, AutoNyan never moves, edits, or deletes it — not even when a corrected
  version of the document gives a different date. Tidying up after a correction
  is yours to do, and nothing AutoNyan does can wipe your calendar.
- **It cannot invite anyone.** Events appear for the people who already have
  access to that calendar; no invitations are sent, and guests cannot be added.
- **It cannot read what is already on the calendar.** AutoNyan does not see your
  existing events, and it cannot change who a calendar is shared with.

## Frequently asked questions

**Which file types can AutoNyan read?**
PDF (including scanned or photographed pages saved as a PDF) and plain-text
(`.txt`) files are read end to end. Office, Rich Text, and Google Workspace files
are noticed but not yet read; standalone images are not picked up. Save anything
else as a PDF first. Details are on [Supported File Types](./supported-files.md).

**How long does processing take?**
There is no instant trigger. AutoNyan scans the watched folder about once an hour
by default, so expect up to roughly an hour between dropping a file and seeing it
filed. See [Daily Use](./daily-use.md).

**Where do my documents end up?**
Each processed document is **moved** out of the watched folder into the category
folder that best matches it, or into **Uncategorized** if nothing fits well. It
is no longer in the watched folder afterward — look in the category folder.

**Who decides the categories?**
You do. Categories are simply the folders you create in the category area of
Drive; AutoNyan reads that list every time and never invents categories of its
own. Add a folder to add a category, remove one to retire it. See
[How AutoNyan Works](./overview.md).

**Does AutoNyan ever delete my files?**
No. It only *moves* documents between shared folders. The original is always
recoverable in its category folder or Uncategorized.

**Can AutoNyan see my other Drive files or my email?**
No. It can only access the folders explicitly shared with it, as described in
[What AutoNyan can and cannot access in Drive](#what-autonyan-can-and-cannot-access-in-drive).

**What language are the notification emails in?**
Currently Japanese, regardless of the language you read these docs in.

**Why did my document go to "Uncategorized"?**
AutoNyan did not find a category confident enough to use. The document was still
read and filed safely. Create the category folder you expected, and AutoNyan
re-files the document there on its own, usually within the hour.

**Do all my documents get put on a calendar?**
No — only documents in folders that have a calendar attached, which is decided by
whoever runs your instance. Everything else is classified and filed as usual. See
[Daily Use](./daily-use.md#calendar-registration).

**I added the same document twice — will I get the events twice?**
No. A repeat registers nothing and sends no second email. The events from the
first time are already there.

**Can AutoNyan invite people to the events it creates?**
No. Events appear for whoever already has access to that calendar, and no
invitations are sent.

**I still cannot explain what happened — who do I ask?**
If the problem looks like a genuine failure rather than timing or an unsupported
file, contact whoever runs your AutoNyan instance, with the file name, the
approximate time you added it, and any notification email you received.

## Next steps

- **[Daily Use](./daily-use.md)** — the everyday flow, including timing and
  notification emails.
- **[Supported File Types](./supported-files.md)** — what AutoNyan can read.
- **[How AutoNyan Works](./overview.md)** — the concepts behind the flow.

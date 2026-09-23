# Household storage: every person's files, shared on their terms, capped by a parent (2026-09-23)

For Jesse. A design record (L), spec first; the questions that are yours
to rule on are numbered at the end. Your words: "every user has their
own storage (for example the pictures they create), admin can cap per
user, users can share with others or with the family, and admin can cap
family storage."

## Why this exists

A family's pictures, videos, stories and files live on one hub that
several people share. Without one owner per file, one place they live,
and a parent's limits, three things go wrong: a child's pictures are
nobody's and everybody's; a package that made a picture takes it along
when the package goes; and one person fills the disk for everyone.
PACKAGES.md's "Uninstall, and a person's files" rule (2026-09-23)
already says a person's output is a household record the package never
owns; this record says what that record is, who owns it, how it is
shared, and how it is capped.

## The record: one file record for everything a person made or sent

The spec has `attachment.schema.json` today (a file a person sent in
chat: owner, conversation and turn, media type, size, digest, storage
path, retention, provenance) and `artifact.schema.json` (a generated
document version, `created_by`). Neither carries sharing, and nothing
carries a cap. The decision: **one record, `file`, which the attachment
record becomes**, not a sibling. Why one: no attachment rows exist in any
household yet (ATT-01's input side is unbuilt), so generalizing costs
nothing now and would cost a migration later; and one record means one
library, one usage number, one sharing rule and one cap, which is what a
parent's page needs. `MEDIA-RECORD-01` (filed earlier today) folds into
this.

`spec/schemas/file.schema.json`, additive over the attachment shape:

| Field | Meaning |
|---|---|
| `id`, `hlc`, `created_at` | the record's identity and clock, as every spec record |
| `owner_person_id` | one person, always; the household is never an owner |
| `origin` | `sent` (a file the person gave in chat), `made` (a package or a job produced it), `exported` (a copy the person asked for) |
| `kind` | `image`, `video`, `audio`, `document`, `story`, `other` |
| `media_type`, `size`, `sha256`, `storage_path` | the bytes below the household data directory, as today |
| `retention` | as today; a person's own files default to "kept until deleted", a chat attachment keeps the conversation's retention |
| `provenance` | the package id, the turn id and the job id that made it, or the conversation and turn it was sent in |
| (sharing) | not a field on the file: a share is its own pointer record, below |

**No duplicates, at any level (owner's rule, 2026-09-23).** The bytes are
stored once, content-addressed: the blob store keys on `sha256`, so one
blob exists per hash. One file record exists per blob, with one owner.
When a second person adds the same bytes (two people send the same
photo), no second blob and no second file record is written: the first
arrival owns the file, and the second person receives a share pointer
to it (the natural rule, stated: first in, owner). A share is a pointer
record, `spec/schemas/share.schema.json`: `id`, `file_id`, `from_person_id`,
`to` (a person id or `"household"`), `created_at`, `hlc`, `provenance`
(the turn or the page that made it); never a second file record, never
a copy of the bytes. Re-sharing (bramble shares a picture with lucia,
lucia shares it with the family) is another pointer on the same file;
what a person may re-share is question 6.

The attachment fixture becomes a `file` fixture with `origin: sent`; the
Python package regenerates; the tag is bumped and `home` and `bot` pin
it. A package's output from PACKAGES.md's rule is written as this record
with `origin: made` and the package in `provenance`; the host's record
API is the only write path, and the manifest lint's output check reads
this record's kinds.

## Ownership

Every file has exactly one owner. A parent (owner or admin) sees every
person's usage and can delete a child's file with the child told; a
parent does not read a child's private file without the child's sharing
or the existing parental-view rule for a minor's data, which applies
here as it applies to memory. A person who leaves the household keeps
ownership of their records until the person lifecycle rules (removal,
memorialization) act on them; nothing here invents a new rule for that.

## Sharing, and its bounds

The owner creates share pointers: to named people or to the household. A
shared file appears in the recipients' Library under the owner's name
and counts against the owner's usage only, never the recipient's. Bounds
that already exist apply: a child's sharing is limited by the consent
floors (a child may share with the household and with the household's
adults; sharing with a named sibling is a household share in practice;
sharing outside the household does not exist for anyone today, see
question 2), a package reads a shared file only if its `min_role` and
permissions allow, and the disclosure filter in the turn pipeline treats
a shared file as context with the owner's disclosure. Unsharing deletes the
pointer, the owner's one action, and takes effect at once; a re-share
made from a pointer dies with the pointer it came from.

## The two caps, declared once

Settings keys, in the registry, rendered by the generic renderer
(SETTINGS.md) with the three disclosure levels:

| Key | Scope | Level | Meaning |
|---|---|---|---|
| `storage.household.cap_bytes` | household | basic | the total the whole household may use |
| `storage.person.default_cap_bytes` | household | basic | every person's cap unless overridden |
| `storage.person.cap_bytes` | person, set by an admin | advanced | one person's override |

Defaults are question 1. A cap is a number a parent reads in the
wizard's words ("Each person can keep 20 GB; the family 100 GB").

## Enforcement: at write time, in the person's words, never a purge

The host's record API is the one write path, so the cap is checked
there: a write that would take the owner past their cap, or the
household past its total, is refused with the reason in the person's
words: for a child, "Your storage is full; delete some pictures or ask a
parent for more room"; for an adult, the same with "or raise the limit
under Settings". Nothing is ever deleted by a background job to make
room. A running picture or video job whose output would not fit is
question 3.

## Usage, computed from the records

Usage per person is the sum of `size` over the files the person owns,
each file once, never against the people it is shared with; the
household's is the sum over everyone plus the household-owned files
(below). Because bytes are stored once and a file record exists once,
the numbers a person sees are the bytes on disk, with no double count
to explain. Never a disk walk: the records are the truth, and a
reconcile that finds bytes with no record or a record with no bytes
reports it as a health item (the one health list), not as usage.

## The page

A Storage page under Settings, the template's data table (no hand-built
UI): each person's usage against their cap, the household total against
its cap, the largest kinds per person, and the cap controls for an
admin. The Admin performance page's storage panel (053b1422) reads the
same numbers from the same function, so there is one source.

## When a person is deleted

The existing person-deletion path (`backend/src/lib/personLifecycle.ts`)
gains one step, in one place: the person's files with no live share
pointer are purged with the person, records and blobs (a blob is purged
only when no file record points at it); a file with any live share
remains. Decision, with the reasoning: the surviving file's ownership
passes to the household, it counts against the household cap and
against nobody's personal cap, and the deleted person's name stays in
`provenance` as history. Why the household and not the recipient: a
file shared with three people has no one recipient to inherit it, a
recipient who did not ask for the bytes should not lose their own room
to them, and a parent's page then shows the inherited files under one
row, "shared by people no longer here", which is what a family would
expect to find. This is not close enough to be a question.

## Backups, uninstall, and the robot

Backups treat the store as precious state per BACKUPS.md (the records
and the bytes together, restored together). Uninstall never touches it
(PACKAGES.md). The robot keeps its own people's files in its own store
with the same record, its own caps from its own settings, and pairing
transfers records and bytes to the hub and back as the portability rules
say: a transfer, never a translation.

## Rows

- `STORE-SPEC-01` (commons, S, spec first): the `file` record and the
  `share` pointer record above, the blob store keyed on `sha256`, the
  attachment fixture migrated, `MEDIA-RECORD-01` folded in, the tag
  bumped.
- `STORE-CAP-01` (home, M): the three keys, enforcement at the record
  API with the two messages, usage from records, the reconcile health
  item; tests in these exact words: a child at the cap writing a picture
  gets "Your storage is full; delete some pictures or ask a parent for
  more room", an adult gets the version with "or raise the limit under
  Settings", a shared file counts once against its owner, no job ever
  deletes a file.
- `STORE-SHARE-01` (home, M): share pointers created and deleted by the
  owner, re-sharing as a further pointer, the recipients' Library view,
  the consent bounds for a child, the disclosure filter reading a shared
  file with the owner's disclosure, and a second person's identical bytes
  becoming a pointer to the first person's file.
- `STORE-DELETE-01` (home, S): the person-deletion step: unshared files
  and their orphaned blobs purged, shared files passed to the household.
- `STORE-PAGE-01` (home, S): the Storage page and the performance panel
  on one function.
- The robot's side rides on the portability rows in `bot`, not a new row
  here.

## Questions for Jesse

1. Defaults for the caps: a per-person default and a household total for
   a first install (a proposal: 20 GB per person, the household total
   set by the wizard from the disk, leaving the hub its own room).
2. Can a child share a file outside the household at all (a link, an
   export to a device), or is sharing bounded to the household for a
   child until an adult acts?
3. What a full store does to a running picture or video job: refuse the
   job before it starts when the estimate will not fit (my
   recommendation), or let it run and refuse the write at the end.
4. Whether a shared file counts against the owner only (my
   recommendation), or against every recipient.
5. What happens to a person's files when that person is removed or
   memorialized: the deletion rule above purges the unshared ones; is an
   export offered first, and does memorialization keep everything.
6. What a person may re-share: anything shared with them (the natural
   rule for a household), or only what the owner marked re-shareable,
   and whether a child may re-share at all.

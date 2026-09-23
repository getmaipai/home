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
| `shared_with` | `[]` (private), a list of person ids, or `"household"`; set only by the owner (see the bounds below) |

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

The owner sets `shared_with`: nobody, named people, or the household. A
shared file appears in the recipients' Library under the owner's name
and counts against the owner's usage only, never the recipient's. Bounds
that already exist apply: a child's sharing is limited by the consent
floors (a child may share with the household and with the household's
adults; sharing with a named sibling is a household share in practice;
sharing outside the household does not exist for anyone today, see
question 2), a package reads a shared file only if its `min_role` and
permissions allow, and the disclosure filter in the turn pipeline treats
a shared file as context with the owner's disclosure. Unsharing is the
owner's one action and takes effect at once.

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

Usage per person is the sum of `size` over the person's records; the
household's is the sum over everyone; a shared file counts once, against
its owner. Never a disk walk: the records are the truth, and a
reconcile that finds bytes with no record or a record with no bytes
reports it as a health item (the one health list), not as usage.

## The page

A Storage page under Settings, the template's data table (no hand-built
UI): each person's usage against their cap, the household total against
its cap, the largest kinds per person, and the cap controls for an
admin. The Admin performance page's storage panel (053b1422) reads the
same numbers from the same function, so there is one source.

## Backups, uninstall, and the robot

Backups treat the store as precious state per BACKUPS.md (the records
and the bytes together, restored together). Uninstall never touches it
(PACKAGES.md). The robot keeps its own people's files in its own store
with the same record, its own caps from its own settings, and pairing
transfers records and bytes to the hub and back as the portability rules
say: a transfer, never a translation.

## Rows

- `STORE-SPEC-01` (commons, S, spec first): the `file` record above,
  the attachment fixture migrated, `MEDIA-RECORD-01` folded in, the tag
  bumped.
- `STORE-CAP-01` (home, M): the three keys, enforcement at the record
  API with the two messages, usage from records, the reconcile health
  item; tests in these exact words: a child at the cap writing a picture
  gets "Your storage is full; delete some pictures or ask a parent for
  more room", an adult gets the version with "or raise the limit under
  Settings", a shared file counts once against its owner, no job ever
  deletes a file.
- `STORE-SHARE-01` (home, M): `shared_with` set and cleared by the owner,
  the recipients' Library view, the consent bounds for a child, the
  disclosure filter reading a shared file with the owner's disclosure.
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
   memorialized: kept under the household, or offered for export first.

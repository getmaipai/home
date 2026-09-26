# Household memory permissions and provenance (2026-09-26)

Design record for issue #57 ("users are in control of their own
memories and admins can set household memories - we need a nice
system for that", Jesse's call on #52). Status: proposed, awaiting
Jesse's read; the write-gate half is a privacy-adjacent behavior
change and should not land without it.

## Why this exists

A household memory is a fact every member's assistant will repeat as
true. Today any signed-in member, including a child, can write one:
`assertCanWrite()`'s household branch (`backend/src/lib/memory.ts:126`)
returns ok unconditionally, and the same gap lets a non-admin archive
(tombstone) a household record an admin wrote. Below this sits a
record with no author: `memory_records` has `source` (what process
produced it) and `person` (who it is about) but no field for which
household member's action wrote it, so even an admin reviewing a
household fact cannot see who said it. The failure this prevents is
quiet authority: one member's claim, or a child's chat, becoming the
household's truth with no name attached and no adult ever having
seen it.

## The design in one paragraph

Person-scope stays exactly as it is: each person controls their own.
Household scope becomes admin-published: only an owner or admin
writes, edits, archives, or supersedes a household record directly.
Everyone else's household-scale facts become proposals: stored
immediately as that person's own person-scope memory (nothing is
lost, their assistant still knows it) and flagged for promotion, so
an admin later publishes it household-wide with one action or leaves
it personal. Every memory record gains an author, and a household
record's provenance (who added it, when, from what) is visible
wherever the record is shown.

## The pieces

**Provenance (spec-first).** `MemoryRecord` in `commons` spec gains
`created_by` (person id of the acting member; system processes like
the judge's consolidation keep using `source` for the producing
process and set `created_by` to the person whose turn fed it, or null
for pure maintenance). Existing rows backfill null; the UI says
"before records were kept" rather than guessing. This is the field
the review surface, the export, and the audit story all read; it is
one definition, never a parallel "author" kept elsewhere.

**The write gate.** `assertCanWrite`'s household branch requires
owner/admin, same shape as the existing privileged-kind gates
(`sanitizedRecordKind`, archive, supersede, forget already do this
for entity/pinned). The same gate closes the known tombstone gap
noted inline at `memory.ts:857`. Non-admin turn-pipeline writes that
the judge scoped household downgrade to person scope with a
`proposed_scope: "household"` marker instead of erroring, mirroring
the silent-downgrade precedent #52 set for entity kind; a direct API
write from a non-admin gets the honest 403, because an API caller can
handle it.

**Promotion.** Promoting a proposal is an ordinary `supersede()` into
a new household-scope record (machinery that exists today,
`memory.ts:1011`): the personal record is retired with `supersededBy`
pointing at the published one, provenance carries both the original
author and the promoting admin. Declining is one action that clears
the marker and leaves the personal record alone; nothing is deleted
either way.

**The review surface.** One section on the existing memory admin
page, not a new app: "Suggested for the household", a short list of
proposals (the fact, who said it, when, promote/leave). A count
badges it; no notification spam, at most the existing digest
mentions it. Settings per docs/SETTINGS.md: one new key,
`memory.household_proposals` (on by default; off means non-admin
household-scale facts simply stay personal with no queue), declared
once, rendered generically.

**What a member sees.** Their own memory page shows their records as
today, with "suggested for household" shown on proposals. A household
record everyone sees now displays "added by <name>" from
`created_by`. Children's view of household records is unchanged by
this design (the audience/disclosure controls already govern that).

## Explicitly out of scope

No approval workflow states on `memory_records.status` (active,
superseded, archived stay the only states; a proposal is a live
personal record plus a marker, so nothing is ever "pending" and
invisible). No per-record ACLs. No change to recall scoring, the
judge's extraction quality, or INCOGNITO's rules (a temporary turn
still writes no memory at all).

## Build order (BACKLOG rows under Memory)

- MEM-PROV-01 (M, spec-first): `created_by` in commons spec +
  migration + write sites + shown in export and record views.
- MEM-HOUSE-01 (M): the household write gate, the downgrade-with-
  marker path, the promotion/decline actions on the API. Closes the
  #57 backend half; regression tests include the tombstone gap.
- MEM-REVIEW-01 (M): the review section on the memory admin page,
  the setting, provenance display. Closes #57.

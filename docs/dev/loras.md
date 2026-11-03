# LoRA records and access (backend)

Built 2026-11-02 for VIDEO-LORA-03. The design is [video-loras-2026-11-02.md](../design/video-loras-2026-11-02.md) sections 4, 6.4 and 7. No Settings screen
uses the new routes yet (VIDEO-LORA-08); the old Settings page keeps working over the same records.

## The pieces

| Piece | File | What it does |
|---|---|---|
| The store | `backend/src/lib/loras/store.ts` | The ONE writer of the `loras` table. `saveLora(record, by)` checks the zod shape and the spec's `validateLora`, refuses a minor (or an unknown person) in `availability.people`, refuses a second live record for one file, and sets `updated_at` and `hlc`. |
| The table | `loras` (migration 0161, schema version 114) | `record` is the whole spec `Lora` JSON; `media`, `kind`, `base_model`, `audience`, `availability_who`, `sha256`, `removed_at`, `trash_until` are copies of its fields for queries, written only by the store. |
| Sync and migration | `backend/src/lib/loras/sync.ts` | Makes a record for every Stack file that has none (at most every 10 s), keeps the file facts current, mirrors adult-only to the Stack's own classification (its second lock), and purges the trash after 30 days. |
| Access | `backend/src/lib/loras/access.ts` | `loraAccess(person, lora, surface)` is the single read path; `readLoras` and `readLora` are what routes and producers call. |
| Admin changes | `backend/src/lib/loras/admin.ts` | `patchLora`, `markAdultOnly`, `markAllAges`, `confirmLora`, `removeLora`, `restoreLora`. Each re-checks the admin. |
| Routes | `backend/src/routes/loras.ts` | `/api/loras` (see below). |
| Video side | `lib/videos/adapters.ts`, `adultStyle.ts`, `loraWire.ts` | `videoAdaptersFor(audience)` over the records; `usesAdultOnlyStyle` reads them; `wireLoras` decides what goes to the Stack. |

## One store

`video_adapter_prefs` is read once by the sync (each row folded into the record of its Stack file, then deleted) and nothing writes it any more. The table
itself stays until a later migration drops it, because a row for a file the Stack cannot list right now must not be lost.

A migrated record is usable by admins only (the owner's 2026-11-02 rule), takes its audience from the Stack's classification (an all-ages one names the
admin who last confirmed it as `audience_set_by`), and keeps a `pending` row as an unacknowledged licence (`needs_confirmation`). A row that was switched
off is admins-only like every migrated record; the record has no separate "off" switch.

## Who sees what (`loraAccess`)

| Person | all-ages | adult-only |
|---|---|---|
| child, teen, guest, a spoken turn, a shared screen | hidden | hidden |
| owner or admin, own written screen | open | locked, open with a valid unlock proof |
| other adult marked in `availability` (`adults`, or named in `people`) | open | locked, open with a proof |
| other adult not marked | hidden | hidden |
| `generation.video.adult_adapters` is "restricted" | open | hidden for everyone |

A removed style is hidden from everyone but an admin's Recently removed. A locked style is one tile (`locked: true`) for the whole list: no name, trigger
words, add-ins, preview, hash, id or count. An id route answers a hidden, locked or missing style the same (404). Because an admin cannot reach an adult-only
style without the proof, patching, marking, removing and restoring one all need `X-Adult-Unlock`.

## Routes

| Route | Who | What |
|---|---|---|
| `GET /api/loras?removed=` | owner, admin | Every style they may read now, or the trash. |
| `GET /api/loras/available` | anyone signed in | The styles this person may use (Create and Edit pickers). A minor gets an empty list. |
| `PATCH /api/loras/{id}` | owner, admin | name, description, kind, availability, strength, trigger words and position, the three add-in lists, base model. |
| `POST /api/loras/{id}/nsfw` | owner, admin | Mark adult-only (always allowed). Locks clips already made with it that were not adult-only. |
| `POST /api/loras/{id}/all-ages` | owner, admin | Mark all-ages; the body must be `{ "confirm": true }`. Only ever an explicit admin click: sync and import can only raise. |
| `POST /api/loras/{id}/confirm` | owner, admin | The admin has read the fingerprint and licence. |
| `POST /api/loras/{id}/remove`, `/restore` | owner, admin | The 30-day trash. After 30 days the sync deletes the file and the record. |

Marking either way writes an `adult_mark_log` row (item id is the LoRA id, `via: admin`, no content). The old `/api/videos/settings` and
`/api/videos/adapters` routes read and write the same records: `enabled` means usable by adults, a locked style is `locked_styles: true` instead of a row,
and removing sends it to the trash.

## Clips made with a style

`startVideoJob` asks `usesAdultOnlyStyle` (records, fail closed on an unknown id) before the Stack is called, so a clip with an adult-only style is a locked
item from the start. The LoRAs go to the Stack through `wireLoras`: Quick and Detailed send `{ id, strength }` as before; LTX-2.5 gets them (with the
file's `sha256`, strength held to the record's range) only when `qualities.ltx25.loras.supported` (`ltx25max` for Max) is true, which VIDEO-LORA-05 adds.
Until then a clip that asks for a style on LTX-2.5 fails at once with a plain line and nothing is queued. `startVideoEditJob` takes `styleIds` for lineage
and the lock; an edit is a local cut and sends no LoRA to the Stack.

## Tests

`backend/tests/loras03.test.ts`: the access table cell by cell, the writer (validation, minors refused, hlc), the migration, the routes, the leak sweep
while locked, the auto-mark and the Stack wiring. Fixtures: `backend/tests/fixtures/lora.ts`.

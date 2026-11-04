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
| `generation.styles.adult_only` is "restricted" | open | hidden for everyone |

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

## Styles in Create and chat (VIDEO-LORA-09 and 10)

The design is [video-loras-2026-11-02.md](../design/video-loras-2026-11-02.md) sections 5, 6 and 15. One function builds the words, one resolver finds the styles.

| Piece | File | What it does |
|---|---|---|
| Prompt plan | `backend/src/lib/videos/promptPlan.ts` | `buildPromptPlan({ words, styles, strength, negativePrompt })`, pure. The person's words stay byte for byte. Start triggers go first, end triggers and add-ins follow, then the say-instead words. A trigger the person already wrote is not added again; a phrase is added once across stacked styles (first style wins, letter case ignored). At most two styles and one `character`; added text is at most 400 characters (add-ins, say-instead and negative text, not trigger words). `negative_addins` become `negative_prompt` only when the engine reports `nag`; otherwise `avoid_as_positive` joins the positive prompt. Strength is Less, Normal or More (0.75, 1, 1.25 of the record's default) held between the record's minimum and `min(maximum, 2)`. A plan that cannot be built returns one plain line (`TWO_AT_A_TIME_LINE`, `TWO_CHARACTERS_LINE`, `TOO_MUCH_ADDED_LINE`). |
| Resolver | `backend/src/lib/videos/styleChoice.ts` | `resolveStyles` turns ids (the Create picker, a stored clip) or names (a chat call) into the records the person may use now, through `videoAdaptersFor` (`loraAccess`). A client id is never trusted: an unknown, hidden or removed id answers `STYLE_GONE_LINE`, the same for all three. An adult-only style without a live unlock proof is `locked`; from chat it is found only by a name that is in the person's own words (`utterance`). `listableStyleNames` is what the tool description may list. |
| Chat tools | `tool.ts`, `editTool.ts`, `styleToolSpec.ts`, `packages/{generate_video,edit_video}/manifest.json` | `styles` (names, at most two) and `strength` on both tools. The description lists only all-ages styles the caller may use (at most 12 names of at most 24 characters); an adult-only or unknown-audience name is never listed, and a person or screen that may use no style is not offered the two arguments at all. `edit_video` `another_take`, `remix` and `continue` keep the first clip's styles (`bodyOfVideoJob`); `styles: []` takes them off. |
| Create picker | `backend/src/lib/videos/createStyles.ts`, `lib/media/videoCreateApp.ts` | Adds the Styles, Characters and Strength chips to the Style popover. Only styles made for LTX-2.5 are drawn (older bases are the chat tool's). One lock tile on the Styles chip while an adult-only style is locked. `enabled_tiers` are the levels the Stack reports LoRA-capable (`qualities.ltx25.loras.supported` for Standard and Boost, `ltx25max` for Max) that this person is offered; elsewhere the chips are disabled with one plain line. The Styles and Characters choices are `private` chips (never in the address). |
| Make route | `lib/videos/make.ts`, `POST /api/videos/make`, `actions/make` | `styles` (ids, at most two) or the picker's `style` and `character`, and `strength`. The same checks run for a typed id as for a picked one. The clip is auto-marked adult-only by `startVideoJob` (`usesAdultOnlyStyle`), as before. |

The Stack's own report decides the level: a style made for LTX-2.5 rides the Max model when `ltx25max` reports LoRA support, Standard and Boost when `ltx25` does; with neither, the clip is refused with `LORAS_UNSUPPORTED_LINE` before anything starts. A style never silently dropped: every failure above is one plain line.

"Try this style" in Settings, Styles opens Create with router state `{ pageState: { style | character: <id> } }` (`tryStyleState` in `StyleEditor.tsx`); the id is never in the address. Known limits: an unlock reloads the page (the host resets every query), so words typed and picks made before the unlock are reset; the cards carry no preview picture yet (the kit's `media` is a package asset path, a hub-served preview needs a kit change); the "Added for" phrases are shown as the card's note, not as a collapsed line with a remove control; Create offers one style and one character at a time (the backend takes two styles).

Tests: `backend/tests/promptPlan.test.ts` (the plan table), `backend/tests/videoStyles0910.test.ts` (route, tool-name resolution, tool-description redaction, adult-only mark, level rules, served picker states), `frontend/src/apps/settings/styles/StylesTab.test.tsx` (Try this style), and in commons `ui/src/schema/promptBarStyles.test.tsx` (disabled state, note, lock tile, private chip).

## Tests

`backend/tests/loras03.test.ts`: the access table cell by cell, the writer (validation, minors refused, hlc), the migration, the routes, the leak sweep
while locked, the auto-mark and the Stack wiring. Fixtures: `backend/tests/fixtures/lora.ts`.

## Verified (2026-11-02, risky-surface pass on 44a0d967c)

Reviewed with `code-review` at medium on the commit's own diff, each finding checked against the code. Fixed, each with a test in `backend/tests/loras03Verify.test.ts`
that fails without the fix:

- The trash purge worked from a list read before its Stack calls, so an admin's Restore in that window was undone. It now re-reads each record, and keeps a style
  while a clip made with it is queued or running (`lib/loras/usage.ts`, matched on the exact quoted id, never LIKE).
- The Stack-facts update in the sync wrote from the same stale list and could revert an admin edit. It now writes from the current record.
- A person listed in `availability.people` who later became a guest (or no longer exists) made every save of that style fail with "Only adults can be chosen",
  Remove and Mark adult-only included. Only people newly added in a save are checked now; readers still gate on each person's own age, so a stale id grants nothing.
- A finished clip or an edit looked a style's audience up in the live list only, so a style in the trash made an all-ages clip adult-only. Both read the record.
- `PATCH /api/loras/{id}` could open an unconfirmed style to other adults. The licence is confirmed first (plain sentence otherwise), as the old pending state kept it off.
- `POST /api/videos/adapters` described a just-added adult-only style (name, words, hash, link) to an admin without a valid unlock proof. It answers "Locked style".
- Marking adult-only found a style's clips with `LIKE`, so an id with `_` or `%` could lock other styles' clips. Same exact match as above.

Checked and held: the access table (the cell-by-cell test), 404 for a locked, hidden or missing style (same body; non-admins get 403 for every id before any lookup),
the unlock proof on every admin route for an adult-only style, `HLC_BEARING_TABLES` (the schema-sync test), parametrised SQL, plain error sentences.
Left as designed or noted: a file the Stack lists with no `video_adapter_prefs` row becomes an all-ages record with the licence acknowledged by the owner when the
Stack says all-ages (the migration rule of the design note, section 6.4; a new file with no row was never "pending" before either); a failed mirror of an
all-ages mark to the Stack leaves the Stack adult-only (the stricter side) and is not retried; the legacy `PATCH /api/videos/adapters/{id}` applies its steps one
by one, so a failing later step leaves the earlier ones saved.

Migration 0161 on a copy of a dev household (pre-0161 copy, schema 113): a migration that fails after `CREATE TABLE` rolls back whole (no table, no index, journal
unchanged); the real migration then applies, and reopening applies nothing. The pref fold-in, run twice and after a simulated crash (record saved, row not yet
deleted): every file got one record, an adult-only file that was switched on stays adult-only, a pending row stays unacknowledged, a file with a malformed hash
and a row for a file the Stack no longer lists keep their rows, and a second sync changes no record. Rows left behind by a crash stay in `video_adapter_prefs`
(read by nothing) until a later migration drops the table.

HTTP proof on a dev hub (8877, `--no-stack`; styles seeded through the store): a child and a teen got `{"items":[],"locked":false}` from `/available` and 403 from
every admin route; an adult not marked saw only the all-ages style and no locked tile; the marked adult saw a locked tile, and the style only with their own proof;
the owner saw one locked tile without a proof and the style with it; PATCH, nsfw, all-ages, remove and restore on the adult-only style answered 404 (the missing
id's body) without a proof and 200 with it; no response without a proof held its name, trigger word, hash or id.

## One table of bases

`backend/src/lib/loras/baseFamilies.ts` is the only place that names a model base, its Civitai labels (`LTXV2` sits on the LTX family row), its text patterns and whether it is supported on this install (`supportedBaseIds()`, fed by `setInstalledBasesProvider`); the browser, install, sync and routes read it.

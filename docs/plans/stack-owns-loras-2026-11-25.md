# Stack owns LoRAs (design note, 2026-11-25)

Status: APPROVED by the architect with five edits (applied below). Item: STACK-LORAS-01.

## Status (2026-11-27)

- Slice 0, spec: done. Shipped as `spec-v0.1.486`.
- Slices 1 and 2, Stack catalog, installs and moves: done, on Stack main.
- Slice 3, kit: done. `StackLorasPage` shipped in `ui-v0.5.755`, plus the Stack Styles screen.
- Slice 4, Home reader: done.
- Design change after Jesse's 2026-11-26 answer: the Stack tags each style nsfw or not, from the site flag or set by an admin; no Stack ticket verifier and no callback; Home keeps its own ticket when lowering through Home; unflagged installs stay untagged (C11, no `RULES.md` change).
- Slice 5, migration: dry run passed on copies; live import done, 3 records, 0 conflicts; second run unchanged; file sha256 identical; backup kept; live on Home `sha-973dd97` pinned to Stack `bcf6d63`.
- Slice 6, Home removal: in preparation in a separate worktree (guarded migration, rollback doc), not landed; it waits for Jesse to confirm all 3 styles show in the live Styles tab.

Note: the live Styles tab was not yet checked by a person.

## Supersedes

- Home's ownership of LoRAs. The `loras` table and `backend/src/lib/loras/` stop being the store. Home keeps no LoRA table, no copy and no cache on disk after migration.
- Home's per-install licence step ("read the licence and confirm"). The one global accept at the Stack replaces it. That global accept is being built in another session and is not landed yet.
- The adult-only mirror in `lib/loras/sync.ts` and the source fetching in `source.ts`: the Stack classifies and fetches directly.
- This note supersedes `docs/design/video-loras-2026-11-02.md` sections 4.2 (where each part lives), 4.4 (the source token kept in Home, never at the Stack; it now lives as a Stack connection), 5.2 (browsing), 5.3 step 1 (Home fetches the hit), and 15.1 and 15.2 (where the Home writer checks the adult lock proof for the classifier). A one-line "Superseded by stack-owns-loras-2026-11-25.md" marker is added to each of those sections in slice 4.
- Adjacent, not duplicated: [stack-owns-model-choices-2026-11-21.md](stack-owns-model-choices-2026-11-21.md) (models), [stack-home-connections-2026-11-25.md](stack-home-connections-2026-11-25.md) (`StackConnection`), the hosted-UI note `stack-hosted-ui-2026-11-25.md`.

Everything else in those notes stands. Nothing here changes `docs/design/RULES.md`, with the exceptions listed under Open for Jesse.

## The rule

Owner rule (Jesse, 2026-11-25): the Stack owns models, features, modes, connections and licences. LoRAs (style and look add-ons used by image and video) move to the Stack the same way models did. The Stack holds the catalog, installs, disks, moves and status. Home reads them, keeps no LoRA table or copy, and shows the Stack's own components. The Stack must work without Home.

## What exists today

### Home

- Table `loras` (`backend/src/db/schema.ts`, migration 0161): one spec `Lora` JSON record per row plus copied columns (media, kind, base_model, audience, availability_who, sha256, removed_at, trash_until). Legacy tables `video_adapter_prefs` and `picture_adapter_prefs` are folded in once by `lib/loras/sync.ts`. Audit table `adult_mark_log` holds who marked a style adult.
- `backend/src/lib/loras/` (about 1700 lines): `store.ts` single writer; `access.ts` per-person read gate; `sync.ts` makes records for Stack files and mirrors adult-only to the Stack; `install.ts` re-fetches a source hit, checks licence, duplicates, base and audience, then asks the Stack for a `video.lora.install` or `image.lora.install` job and reconciles it from the scheduler; `source.ts` all outbound Hugging Face and Civitai traffic; `adultCheck.ts` classifies from source fields; `admin.ts` patch, mark adult, mark all ages, confirm, remove, restore; `promptPlan.ts` pure prompt and strength builder; `suggest.ts`, `readiness.ts`, `usage.ts`, `baseFamilies.ts`.
- Routes `routes/loras.ts` and `routes/lorasSources.ts`; UI `frontend/src/apps/settings/styles/` (StylesTab, StyleBrowser, StyleEditor and others), registered as `home.media_styles`.
- Gates: `access.ts` gives hidden, locked or open. A non-adult, or any surface other than own-written, gets hidden (child, teen, guest, spoken turns, glance screens, TVs). Non-admin adults need to be in availability. Adult-only records are hidden when `generation.styles.adult_only` is restricted, else behind the adult lock (`adultLock.ts`, in-memory proof, `X-Adult-Unlock`). A locked record is one tile with no name, id or count. An id route answers 404 for hidden, locked and missing alike. `adultMarks.ts`: marking raises only, by creator or admin; unmarking is creator only with a fresh ticket. `styleLock.ts`, `pictures/lock.ts`, `videos/policy.ts` (minor lane gets all-ages only), `videos/adultStyle.ts` (unresolved id counts as adult-only, fails closed), `adultLockCleanup.ts`. `store.ts` refuses a minor in `availability.people`.
- Use: video sends `loras: [{id, strength, sha256?}]` (`videos/loraWire.ts`, `videos/stack.ts`), pictures send `loras: [{id, scale}]` (`pictures/stack.ts`). Home's `lora-...` ids are already the Stack's file ids.
- Home-only data today (not derivable from the Stack): preview images, description, audience and who set it, the three-state adult check, availability (who, people), trigger words and position, add-ins, strength range, allow_suggesting, licence text and who acknowledged it, source details, trash state, added_by.

### Stack (getmaipai/stack)

- Two libraries, each a directory of `<id>.safetensors` plus a `manifest.json`: pictures `dataDir/images/loras` (`backend/src/images/loras.ts`), video `dataDir/video/loras` (`backend/src/video/loras.ts`), both built on `lib/media/loraLibrary.ts` and `lib/media/loraInstallCore.ts`. Record holds id, sha256, bytes, base_model, licence, licence_class, classification (all-ages or adult-only), strength_default, trigger_words, added_by, source_url.
- Routes on both image and video: GET /loras, POST /loras (file import), POST /loras/install, PATCH /loras/{id}, DELETE /loras/{id}. Job kinds `video.lora.install` and `image.lora.install`. LoRAs already list in `GET /stack/v1/components` as kind lora, id `lora.<media>.<id>`, and DELETE /components/{id} removes them. No enable/disable endpoint (Home passes `lora_ids`). No LoRA page in admin-ui. No `disk_id`: LoRAs always live under dataDir, while models have disk_id (`lib/disks.ts`, `lib/moveModels.ts`, `featureMoves.ts`).
- Licence: per-LoRA licence on install. The one global accept (terms_version, accepted_at, by, in `licence-acceptances.json`, GET and POST /stack/v1/licences) is being built in another session and is not landed yet.

## Design

1. One Stack LoRA catalog part: a single library for image and video with a `media` field, and the spec `Lora` record as the one shape (commons/spec; add `disk_id` and a `status` of ready, drive_missing, installing, failed). The two manifests merge into one on first boot of the new Stack: idempotent, files not copied unless moved. The Stack owns file facts, base model, trigger words, strength, add-ins, description, preview, audience, adult check, licence record, trash (30 days), availability and source.
2. Installs: an install record per file with `disk_id`, like models. Files live under `<disk>/loras/`. Moves between drives reuse `moveModels.ts` and `featureMoves.ts`. A missing drive shows status drive_missing and Home treats the style as unavailable. Install and move progress show on the Stack's jobs and in the Stack admin page.
3. Sources and connections: Hugging Face and Civitai browsing, hit fetching, rate limits, and the adult classification from source fields (`source.ts`, `adultCheck.ts`) move to the Stack. The Civitai key and Hugging Face token are held as Stack connections (the `StackConnection` record in `stack-home-connections-2026-11-25.md`). Home sends no outbound traffic for styles.
4. Licence: the one global accept at the Stack replaces Home's per-install "read the licence and confirm" step. The per-LoRA licence text and id stay on the record for display only. If the global accept is missing, the install refuses with one plain line saying to accept the licence in the Stack admin.
5. API: `GET/PATCH/DELETE /stack/v1/loras`, `POST /stack/v1/loras/{id}/restore`, `/move`, `POST /stack/v1/loras/install`, `GET /stack/v1/loras/sources/...` (browse), `POST /stack/v1/loras/import` (idempotent by id, used by migration and file import). Home reads over the paired token, like models.
6. UI: a kit page `StackLorasPage` in `commons/ui` `src/stack/` (beside `StackModelsPage`, `StackDrives`), taking a `StackClient`. It is bundled in the Stack admin-ui and shown in Home's Settings Styles tab through the hosted-screen path in `stack-hosted-ui-2026-11-25.md` (fallback until that lands: the same component over Home's backend proxy like `stackModelsClient.ts`). Admin work (browse, install, edit, move, remove, status) is this page. What stays Home UI: the per-person style picker in Create and chat, the locked tile, and the adult-lock prompts, because they depend on person, age and surface.
7. Home keeps no `loras` table, no copy and no cache on disk. It reads the Stack per request, with a short in-memory read only (seconds, never persisted). `lib/loras/store.ts`, `sync.ts`, `install.ts`, `source.ts`, `adultCheck.ts` and the legacy prefs tables are deleted after migration. `access.ts`, `promptPlan.ts`, `suggest.ts`, `readiness.ts`, `usage.ts` become pure functions over the Stack's answer. `adult_mark_log` stays in Home (it is an audit of people's actions), keyed by the lora id.

## Safety gates

One decision point stays in Home. Home knows the person, age band, surface and passcode proof; the Stack stores no people (hosted-UI note). So the decision point stays where it is: `access.ts` plus `adultLock.ts`, now fed by the Stack record. No better single place exists, for that reason.

Add a second fence in the Stack. It already receives the audience on each request, and now refuses any request that names an nsfw-tagged (`adult-only`) LoRA when the audience is not adult, with the same fail-closed rule: an unknown id counts as adult-only. Fail closed when the Stack cannot be read: no adult-only style is shown or used, and generation is unavailable anyway.

Unchanged, with their tests: marking and unmarking rules, Home's own ticket for lowering, the 404-for-hidden rule, minors never in availability, and the minor lane getting all-ages only. Child and teen filtering is unchanged. Nothing here changes `docs/design/RULES.md`, with the exceptions listed under Open for Jesse.

Rule C11 (`docs/design/RULES.md`): only a person or an automated check locks something, and not having been checked is never by itself a reason to mark or lock. The classifier moves to the Stack unchanged. A style the Stack could not check at install (no flag from the site, or the lookup failed) is untagged: all-ages with no `classification_origin`, the same as any record whose adult check state is `unknown`. It is not marked or locked because of that, and C11 needs no exception (Jesse, 2026-11-26; `RULES.md` unchanged). Home's own rules still apply to it: the word scan in the Stack library still tags a style whose metadata names adult content, installing as All ages needs the open Adult lock, and a person or a later check can mark it. Failing closed on an id the Stack cannot resolve is a different case and stays: it is E6 and the existing `adultStyle.ts` behavior.

The Stack does not know users (owner decision, Jesse, 2026-11-26). It tags each LoRA nsfw or not: the record's `classification`, where `adult-only` means nsfw, with `classification_origin` (`site` or `admin`). The tag comes from the download site's own check at install (Civitai's flag and level, Hugging Face's `not-for-all-audiences` tag; only a flag that says nsfw tags it, and a missing flag or failed check leaves it untagged), or from a Stack admin, or from a Home admin through Home calling the Stack with its token. Home reads the tag and applies its own rules (age, surface, lock).

Lowering keeps Home's ticket, and Home alone enforces it. A Home admin who lowers a style the source called adult needs the fresh single-use passcode ticket (`/api/adult-lock/confirm`) for this person, session and style; Home checks it (it is also required when `classification_origin` is `site`, because a tag the download site set counts as the source calling the style adult), calls the Stack PATCH with its token, and uses the ticket up once the Stack accepts. A Stack admin lowers the tag directly on the Stack's own page with no ticket, because that admin is on the Stack. The Stack ticket verifier, the `STACK_HOME_CALLBACK_URL` setting and Home's `POST /api/stack/adult-ticket/consume` route were removed 2026-11-26 by owner decision. Marking (raising to adult-only) needs no ticket anywhere.

Redaction of the kit page depends on who is looking. The kit page shown in Home's Styles tab receives its data from Home's pass-through, with adult-only records already redacted to the one locked tile (no name, id or count) unless the person has the adult lock open. The Stack's own admin page shows everything to a Stack admin session, as it does for models, because the admin is on the Stack. See slice 4 for the matching test.

## Reuse check

| Model design piece | Reused for LoRAs |
| --- | --- |
| Choices and records (`stack-owns-model-choices`) | Same pattern: the Stack holds the record, Home reads it. The catalog shape follows the model parts. |
| Install record with `disk_id` and drive status (`lib/disks.ts`, `modelStore.ts`) | Install record per LoRA file with `disk_id`; drive_missing status. |
| Moves (`moveModels.ts`, `featureMoves.ts`) | LoRA moves between drives reuse them. |
| One global licence accept | Replaces Home's per-install confirmation. |
| `StackConnection` | Holds the Civitai key and Hugging Face token. |
| Shared kit page plus `StackClient` | `StackLorasPage` beside `StackModelsPage` and `StackDrives`. |
| Hosted-screen pass-through | Shows the kit page in Home's Styles tab. |
| `GET /components` listing | LoRAs already list there as kind lora; it stays the inventory view. |
| Paired token read | Home reads LoRAs the way it reads models. |

Note: the multi-disk plan has no note file yet, only code, so this table names the code (`lib/disks.ts`, `lib/moveModels.ts`, `featureMoves.ts`).

## Build slices

In order. Each slice carries its test and verify. Slices 1 and 2 are Stack work (own worktree in the stack repo), 3 is commons, 4 to 6 are Home. Shipping stays Jesse's word.

0. Spec (commons): `disk_id` and `status` on `Lora`; tag it. Test: spec validate tests. Verify: Stack and Home typecheck against the tag.
1. Stack backend A, catalog: unified library, manifest merge, `/stack/v1/loras` read, patch, delete, restore, import; the audience fence on generation requests; the PATCH route taking the nsfw tag from an admin with no ticket (the ticket verifier was removed 2026-11-26). Test: Stack unit tests including fail-closed unknown id, adult request refusal, manifest merge idempotence on a copy, and the site check tagging installs. Verify: curl the routes against a Stack started on a scratch data dir with copied manifests.
2. Stack backend B, installs and moves: `disk_id` on installs, move job, drive_missing status, browse and install from Hugging Face and Civitai using connections, global licence check. This slice waits on the open rule change in the connections note (`stack-home-connections-2026-11-25.md`), because the source keys live in `StackConnection`. Test: tests with a fake source and a fake second drive. Verify: install one small file and move it on the scratch Stack.
3. Kit: `StackLorasPage` in commons/ui, tag, pin in Stack admin-ui. Test: component tests. Verify: `preview` skill at desktop and phone width, light and dark, Stack stopped.
4. Home reader: `access.ts` and callers read the Stack; picture and video wire unchanged; Styles tab shows the kit page; adult-lock UI kept; Home adds the small per-person availability table keyed by lora id and fills it from `availability.people` (see Open for Jesse 1); the one-line "Superseded by stack-owns-loras-2026-11-25.md" markers go into `docs/design/video-loras-2026-11-02.md` sections 4.2, 4.4, 5.2, 5.3 step 1, 15.1 and 15.2. Test: all existing access, adultLock, video policy and picture lock tests pass unchanged against a fake Stack; add a Stack-down fail-closed test; add a test that a teen and an adult with the adult lock closed see no adult-only name through the Styles tab. Verify: dev workbench as an adult, a teen and a child; screenshots opened.
5. Migration (dry run on a copy, then real on Jesse's word): Home posts its records to the Stack import route, then compares counts and sha256 for every record. Home refuses to continue while one is missing. Verify: counts match, one image and one video job still resolve a style.
6. Home removal: migration that drops the `loras` and legacy prefs tables only after step 5 reports full match (keep a backup file of the table dump), delete the files named above, lint guard that fails on a `loras` table or `lib/loras/store.ts`. Test: lander gate plus the new guard. Verify: grep shows no reader of the table.

## Migration

Port before delete. The `lora-...` ids already match the Stack's file ids, so import is keyed by id and idempotent. Order: the Stack with import ships first; Home exports its records and previews; the Stack confirms; Home verifies; only then Home drops the table. Previews move into the Stack record. The `adult_mark_log` stays. The `availability.people` list does not move to the Stack: it is copied out of the `loras` rows into the small Home table keyed by lora id before the drop, alongside `adult_mark_log`. Rollback: the table dump file. No data loss path: the import never deletes, and Home deletes only after a full match.

## Not sure about

- Whether the hosted-screen pass-through (status NEEDS-RULE-CHANGE) lands before slice 4; the fallback is the proxy.
- The picture Stack's base-model family naming versus the video base ids in `baseFamilies.ts`; the merge may need a mapping table in the spec.
- The `source.ts` header says 2 s and 60 requests an hour while the sources doc says 0.4 s and 300; pick one when it moves.

## Open for Jesse

0. Decided 2026-11-26 (Jesse): the nsfw tag lives on the Stack record, set by the site check or an admin; Home applies its own rules. Still open: who sets the tag on a file whose own metadata names adult content when an admin wants it lowered (the Stack keeps `classification_locked` for those).

1. Named-people availability (`availability.people`): decided by the architect. `availability.who` stays on the Stack record; the named `availability.people` list lives in Home in a small table keyed by lora id, like `adult_mark_log`, because E5 keeps who may use something in Home. Home keeps no LoRA catalog copy, only this per-person access list. Alternative (the earlier option): the Stack record holds opaque person ids it never resolves and Home enforces them.
2. Drop the per-install licence confirmation in favour of the one global accept? Recommended: yes.
3. Merge the image and video libraries into one? Recommended: yes, one library with a `media` field, rather than keeping two.
4. The Stack's second fence on adult-only styles is a safety-gate change, so it needs Owner-approved on the commit if the architect says it touches a gate. Recommendation: yes. Do you approve? The architect's note: the fence needs no separate Owner-approved line (E6 already requires it), but it is a risky surface, so it takes the full `check.sh` and code-review at medium.
5. Any `RULES.md` change: none proposed. The hosted-screen rule change is already open in the hosted-UI note. Correct?

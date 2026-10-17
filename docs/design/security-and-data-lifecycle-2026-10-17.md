# Security, export, erase and migration: the household's data lifecycle (2026-10-17)

This note decides what happens to a household's data at every point where it can leave the hub, be read by someone it does
not belong to, or stop existing: encryption at rest and the threat model (SEC-PRIVACY-01), the one `redact_pii` function
(CAP-06), the audit record for a protection change (SETTINGS-AUDIT-01), the diagnostics report (DIAG-REPORT-01), the slow-reply
alert (PERF-ALERT-01), erasing the hub (ERASE-HUB-01), a person's export (EXPORT-01, MEM-EXPORT-01), importing one
(CAP-08), moving the hub to a new machine (the "Hub migration, two hubs" row), the self-update rules as tests (the "Windows
self-update rules as tests" row) and Home as a Linux image (HOME-IMAGE-01). Design note only; no code. The architect gate
applies: SEC-PRIVACY-01 touches credentials, privacy and safety paths.

## 1. What exists today (from code, 2026-10-17)

| Piece | Code | State |
|---|---|---|
| Keystore | `backend/src/lib/keystore.ts` over `@maipai/core/src/keystore.ts`; keys under `data/keys`, namespaced `maipai-home` | macOS: the login Keychain, file fallback; Windows: DPAPI file; Linux: a 0600 hex file on the same disk as the database |
| Reversible secrets | `backend/src/lib/secrets.ts` (`secrets_key`, AES-256-GCM, `MAIPAI_SECRETS_KEY` override) | OAuth tokens, API keys and biometric prints are ciphertext in `hub.db` |
| Sign-in secrets | `backend/src/lib/secret.ts` (`secret_pepper`, argon2id) | PINs and passwords hashed, never reversible |
| The database | `records` class, `hub.db`, plain SQLite | Conversations, memories, people, settings in plaintext on disk |
| Backups | `backend/src/lib/backup.ts`, `backupCrypto.ts` (`backup` key, streaming AES-256-GCM), `backupTargets.ts` (`local`, `smb`), `receivedBackups.ts` (`hub` target, foreign keys) | Encrypted before leaving the machine; a tampered archive fails the GCM tag; 7/4/3 retention; `backup.max_total_gb` |
| Emergency kit | `backend/src/lib/emergencyKit.ts`, `GET /api/backups/emergency-kit` (owner only) | Carries the backup key and the instance id only; not `secrets_key`, not `secret_pepper` |
| Restore | `routes/backups.ts`: full restore owner only, per-person restore owner or admin | A full restore on a new machine loses every stored credential and every PIN (section 3, Migration) |
| Factory reset | `lib/factoryReset.ts`, `routes/storage.ts:182` | Owner only, typed phrase, fresh backup first, applied at next boot |
| Hub identity and TLS | `lib/hubIdentity.ts` (instance id minted once, never rotated), `lib/householdCa.ts`, `index.ts:332` | TLS on the LAN once the household CA exists |
| Session lock | `settings/securityKeys.ts` (`security.session_lock_required`, `_timeout_minutes`) | Built (INCOGNITO-07) |
| Incognito | [privacy-mode-2026-09-24](../plans/privacy-mode-2026-09-24.md) | Per-person zero persistence, server-enforced boundary |
| Diagnostics | `lib/diagnostics.ts` `generateDiagnostics()`, `@maipai/spec/diagnostics/to-redact.json` | A JSON report built structurally (fields never included), household settings only, secrets `[redacted]`; no zip, no page, no log lines |
| Export | `conversationHistory.ts:2994` `exportPerson()`, `GET /api/conversations/export`, `GET /api/memory/export` | Raw `ConversationTurnRow[]`; outcomes and stats scrubbed for a non-admin; nothing else exported; a parent may export a child (`access.ts:62`) |
| Import | `lib/legacyImport.ts` | Legacy `app.db` only, idempotent by legacy id |
| Updates | `lib/updates.ts` (`checkRelease`, GitHub `releases/latest`, `updates.available`), `routes/updates.ts` | Check and notify only; `lib/selfUpdate.ts` does not exist (`updates.ts:22`) |
| Settings writes | `lib/settings.ts:420` `writeValue()` | `updated_at`, `hlc`, `set_by` on user overrides; no change event |
| Turn stats | `lib/turnStats.ts` (`time_to_first_token_ms`, `prompt_ms`, `first_delta_ms`), `lib/performance.ts`, `/performance` | Recorded per turn; nothing watches them |
| Host tuning | `scripts/studio/host-tune.sh:162` | Advice item "Sign in automatically, FileVault off" (owner's decision 2026-10-16) |
| Packaging | SERVICES.md "The three pieces" | A daemon, never a container; "a Linux server image may be offered later as packaging" |

Already decided and kept: BACKUPS.md (AES-256-GCM keyed from the keystore, never inside the archive; the kit; the restore
drill); CREDENTIALS.md (a copied database must be useless without the key; full-disk encryption on the host is expected, not a
substitute); the `keys` data class is backup mode `kit` ("only in the emergency kit, never in the archive",
`data-class.schema.json`); `problem-report.schema.json` (a child's or teen's report carries codes and timings only);
`log-events.schema.json` (no free text, no person id in any log event); the storage and sharing records
([household-storage](../plans/household-storage-2026-09-23.md), [external-sharing](../plans/external-sharing-2026-09-23.md)).

## 2. Purpose and audience

The job: a family can say exactly who can read what is on this disk, take their own data out, bring it back, move the hub, or
wipe it, and each of those is one honest screen.

| Viewer | Sees and does | Never sees |
|---|---|---|
| Admin (after NO-OWNER-ROLE-01, owner and admin are one rung) | The "What is on this disk" table, the disk-encryption item, the diagnostics report, the slow-reply item, export of their own data; after re-entering their own PIN: the protection-change list, Erase this hub, the full emergency kit, migration | Another adult's text through any of these, another person's export, a child's included |
| Adult member | Their own export (zip and Markdown memories), their own Incognito | Any other person's data, any admin page |
| Teen | Their own export, shaped by their read path (no reasoning, no stats) | The same |
| Child | Their own export through their own sign-in, shaped by their read path; a parent who wants to see it asks the child (NO-CROSS-USER-VISIBILITY-01) | Any other person's export |
| Guest | Nothing | Everything here |
| Robot, TV | Nothing on these surfaces; the robot pushes its own encrypted archive to the `hub` target as today | A kit, an export, an erase control |

Rule 0 holds: no item below loosens a child or teen protection. A child's or teen's export carries only what their own read
path shows them (reasoning and stats are dropped exactly as `list()` drops them); SETTINGS-AUDIT-01 only adds accountability to
widening a protection; `redact_pii` adds a floor and removes none.

## 3. Flow

**Where it lives (S1 to S5).** The Privacy settings area gains two items declared in `areas.json`, "What is on this disk" and
"Erase this hub", each opening its own page; the shell draws the items, and the disk table and the protection-change list live
on those pages. Home settings > Storage and backups keeps Backups and gains "Export" and "Import" links and the
emergency kit. The diagnostics button sits on `/status`; the slow-reply item is one row on the one health list. Settings >
Data (account area) gains "Export my data" for an adult and a teen. Nothing new on the rail.

**The threat model, stated honestly.** Six attackers, what each gets today, and what this note changes.

| Attacker | Gets today | After this note |
|---|---|---|
| Seized or stolen machine, powered off, disk encryption off (the Studio's own setting) | Everything: `hub.db` is plaintext, and the login Keychain opens with the auto-login password macOS keeps on the same disk | The same, said plainly on the disk table; the fix is disk encryption, which is the owner's call (decision 1) |
| Seized machine with disk encryption on and a real login password | Nothing until the password is typed; the hub does not restart unattended after a power cut | Unchanged; named as the trade |
| A copy of `hub.db` alone (a remote attacker, a leaked drive image of the data folder) | Conversations, memories and people in plaintext; secrets, prints and PINs useless without `data/keys` | Unchanged for text; see decision 2 for a records key |
| A leaked backup archive | Nothing (AES-256-GCM, key in the keystore and the kit) | Unchanged |
| An intruder on the LAN or the Tailscale network | Traffic in the clear until the household CA exists; sessions are cookies with a session lock available | Unchanged here; the CA item is on the setup checklist already |
| A household admin at the keyboard | Any file the service account can read, so the whole database | Honest limit, written on the disk table; inside the app the admin sees what rule 6a allows and nothing more |
| A compelled disclosure | Whatever the disk gives the first row; nothing from MaiPai, which holds nothing | Unchanged: the owner holds the only keys |

What comparable products do, in one line each, so the row's research is on the record: Signal and Element keep the device
database encrypted with a key in the OS keystore (our tier, same limit); Standard Notes and Proton derive keys from the
person's password and never need plaintext on a server, which works because their server runs no model over the data;
Nextcloud end-to-end encryption and Cryptomator encrypt per folder behind a password, with no server-side search; Apple
Advanced Data Protection keeps keys on devices with a recovery contact or key; Home Assistant and Immich store plaintext and
rely on the host's disk encryption; SQLCipher encrypts the whole file but still needs the key from somewhere; passkeys are
sign-in, not storage.

**The smallest honest design.** The hub is a server that reads every person's memory with nobody at the keyboard: the robot
answers at night, the memory judge runs in the background, the parent notifier reads a child's crisis turn, the model's prompt
and the engine's KV cache hold plaintext for the length of a turn and until the engine restarts. A key that only a person's
passcode can unlock would make all of that stop at every reboot until each person signs in; a four-digit PIN gives about 13 bits
and an offline attacker opens it instantly; and a parent could no longer recover a child's data, or an owner a dead relative's,
without a back door the row forbids. So per-person keys are not built. What is built:

1. **Disk encryption is the seizure defence, stated and checked.** The probe is BRANCH-SEC1-01's `lib/protectionStatus.ts`
   (`diskEncryptionState`), landed first; this note only adds its result to the one health list as `security.disk_unencrypted`
   (severity `warning`, never auto-notifies). The copy: "This computer's disk is not encrypted. Anyone who takes the computer can read everything Home keeps.
   Turning encryption on means someone has to type the password after a power cut." The host-tune advice item keeps the owner's
   2026-10-16 choice; the probe just tells the truth about it.
2. **"What is on this disk" table** on the Privacy area, one row per data class from `lib/dataClasses.ts`: what it holds,
   encrypted or plain, who can read it (the service account, an admin at the keyboard, anyone with the disk), and whether a backup
   carries it. Copy comes from the class declaration (principle 4), never hand-written per row.
3. **The emergency kit carries every key**, not one: `backup`, `secrets_key`, `secret_pepper` and the instance id, as one page
   and one file. Today a restore on a new machine silently loses every credential and every PIN; this is the migration fix as well.
4. **The keys folder is never in an archive and never on the disk table as "plain"**: unchanged, now tested by SEC-PRIVACY-01a.

**`redact_pii` (CAP-06).** One function, `redactPii(text, household)` in `backend/src/lib/redactPii.ts`, built on
`memoryContentPolicy.ts`'s `redactCredentials()` and the minor-query check PRIVACY.md already names (`lib/retrieval/minorQueryCheck.ts`) (home address from the
`household.home` place, phone numbers, email addresses, household display names and nicknames). Applied, in this order of
landing, at: the hosted-search query (adults; a child's or teen's query never reaches a hosted provider, rule 7), a problem
report's `description` and `excerpt` parts, the diagnostics report's free-text fields (none today; the function is the guard
against a future one), and a file an adult shares by external link when it is text. Never applied to a person's own export:
that is their data. The per-turn exact-search switch in the same row is the composer's search control under rule 1 and is
already decided there; this note adds nothing to it.

**A protection change leaves a record (SETTINGS-AUDIT-01).** `writeValue()` writes one `setting-change` record when the
key's declaration carries `audited: true` (the age-gate keys the row lists, plus `search.web_sources` and the blocked-site
lists). Shown to admins, after re-entering their own PIN (NO-OWNER-ROLE-01), on Home settings > People as "Changes to kids' protections": when, which setting, from what to what,
and the actor's role ("an admin"), never a name or a person id (rule 6a). `scope` is `household` or `person`, never a
person id; a per-person override is recorded and listed as "one child's setting" with no id. A refused write
records nothing. A teen or child can never write an audited key, so the actor role is only ever admin (or owner until NO-OWNER-ROLE-01 lands).

**The diagnostics report (DIAG-REPORT-01).** A Button "Save a diagnostics report" on `/status` (admin). It opens a
kit `Dialog` listing every file before anything is written: `health.json` (the health list by source, key, severity),
`versions.json`, `hardware.json` (the probe), `settings.json` (household scope, secrets redacted), `events.jsonl` (the last 500
typed registry events: names, codes, durations, versions, traces; nothing else exists in that log by schema). Built by
`generateDiagnostics()` extended, zipped by `@maipai/core/src/zip.ts`, served by `GET /api/diagnostics/report` as a download.
Never sent anywhere; the privacy page needs no row. A child or member gets 403.

**Slow replies (PERF-ALERT-01).** The stored `stats` gains the stage split `TurnTimings` already logs (routing, recall,
prompt build) beside the engine's `prompt_ms` and `predicted_ms` and the retry count. A core job `perf.watch` every 5 minutes
reads the last 20 model turns: slow when the median first-token time passes `perf.first_token_budget_ms` or twice the same
model's 7-day median at a similar prompt size, for 10 minutes; recovered under 1.3 times the baseline and under budget for 10
minutes. One health item `perf.replies_slow` ("Replies are slow since 2:14 PM: 3.9 s to first word, usually 0.8 s; most of it
is the engine reading the prompt"), `started_at` fixed at the first slow turn, updated in place, resolved on recovery; one
notification `hub.replies_slow` (`time_sensitive`, audience admins, once per episode, action "Show me" to `/performance`) and a
`passive` `hub.replies_normal`. The performance page shades each episode. No person, no text, only timings and counts.

**Erase this hub (ERASE-HUB-01).** Privacy > "Erase this hub", an admin, after re-entering their own PIN (NO-OWNER-ROLE-01). A kit `AlertDialog` lists what
goes (every personal class: `records`, `keys`, `people-files`, `cloned-voices`, `projects`, `packages` state, `logs`,
`cache`, `labels`, the local `backups` and `received-backups` folders) with sizes, what stays (models, engines, sidecars,
reference archives, block lists; a checkbox "Also remove downloaded models (41 GB)"), and what it cannot touch ("Backups on
your NAS are not touched. The emergency kit you printed still opens them."). The person types the hub's name as shown. Erase is the
existing factory reset (`lib/factoryReset.ts`, `POST /api/storage/factory-reset`), extended: the staged boot-time apply deletes
the listed classes with `keys` last, the "Also remove downloaded models" choice travels in the staged marker, and the hub
restarts into the first-run wizard. The pre-reset backup factoryReset takes is written to the off-machine target only; with no
off-machine target, the dialog says nothing will be kept. The response and the wizard's first screen say what was removed, by class and size. A
member who is not an admin gets 403 with "Only an admin can erase this hub. Ask an admin in your home."

**A person's export (EXPORT-01, MEM-EXPORT-01).** Decision on the row's open question: an export is shaped by the person's
read path, never a fuller archive. Reason: the read path already encodes the age rules (REASONING-02, STATS-01), and a second
projection would be a second definition of what a teen may see (principle 1). `GET /api/export` (the signed-in person only, no
`person` parameter) is the person-facing zip; the two raw routes stay and return the same projection (additive on the wire: no field a non-admin sees today disappears except
`reasoning` for a minor, which was the gap). The zip from `@maipai/core/src/zip.ts`: `README.txt` ("This is everything Home
kept for Juniper, as Juniper could see it on 2026-10-17"), `person.json`, `conversations.json`, `memories.json`,
`memories/*.md` (one file per record, readable name, a six-character code on a clash, provenance in front matter, links
between related records), `files/` (the person's own `file` records and bytes), `settings.json` (their person scope). Excluded:
forgotten (tombstoned), archived and `needs_review` memory records, embeddings, credentials, sessions, passkeys, prints, grants, role. Who:
only the person for themselves; the route takes no person id, so no one can ask for another person's export. A second export never
overwrites a file it did not write. The page says in one line that an export leaves Home's protection once saved.

**Import (CAP-08).** "Import a person" on Storage and backups (admin) takes an EXPORT-01 zip and a target person:
records keep their ids and `hlc` (principle 3: a transfer, never a translation); a record already present keeps the newer
clock; a record for a different person id is re-owned to the target with the original in `provenance`; memory text and files
pass the target's output floor and cap at write time like any record-API write. A parent imports into a child's account only
with a zip from the child's own export (the manifest's `person_id` and `hub_instance_id` must match a child of this household); a
teen or child cannot import. The legacy `app.db` path stays as `legacyImport.ts` until no legacy household remains.

**Migration to a new machine.** Install Home on the new machine, choose Restore on the wizard's second screen, give it the
newest archive and the emergency kit file (or type the keys from the page). Restore puts the three keys into the new keystore
before the database, so credentials, PINs and prints work; the instance id and the household CA come back inside `hub.db`,
so every pinned client and paired robot still trusts the hub. Two hubs are two instance ids; a client that has seen both asks
once which to use and remembers. Nothing here needs a new record; the kit's three fields are the only change.

**Self-update rules as tests.** `lib/selfUpdate.ts` does not exist, so the three Windows rules (Defender holds `dist/`
handles past 3 s; untracked files are not dirty; an unresolvable upstream never reads "up to date") land as the acceptance
tests of the self-update slice itself, the first time it is built, not before. The third already has a home: `updates.ts`'s
`checkRelease()` keeps the last state on a failed fetch; its test is the one that lands now.

**Home as a Linux image (HOME-IMAGE-01).** One OCI image from the same release binary, Linux only, labelled "for people who
already run containers"; native stays the path. The data directory is a mounted volume, the keystore is the Linux file
backend on that volume, no engine inside (the Stack runs on the host or a paired engine computer), health answered on the
daemon's port. Backups, export, erase and migration are identical because every path resolves through `classDir()`. The disk
table's "who can read it" row says the host's volume encryption is the only disk defence. Used first for the clean-machine
install test; publishing it is decision 4.

**States and copy.** Empty: "No changes to kids' protections yet." Loading: kit `Skeleton` rows. Failed: kit `Alert`,
destructive, "Home could not build the report: the log folder is missing. Check Storage, then try again." Offline: every
screen here works with no network. Incognito on: the export, import and erase controls are hidden (the person is a guest to
the household's shared systems while it is on; the privacy-mode record's shared guard covers them).

## 4. Records and settings (spec first)

| Name | Type | Default | Scope | Meaning |
|---|---|---|---|---|
| `settings-key.audited` | boolean, additive field on `settings-key.schema.json` | false | declaration | A write of this key by an owner or admin writes a `setting-change` record |
| `setting-change` record, `spec/schemas/setting-change.schema.json` | `id`, `hlc`, `created_at`, `provenance` (`component: hub`), `key`, `scope`, `old_value`, `new_value`, `actor_role` (`owner`, `admin`); `scope` is `household` or `person`, never a person id | | household | The audit row; Home table `setting_changes`; robot later for parity |
| `emergency-kit` shape, `spec/schemas/emergency-kit.schema.json` | `hub_name`, `hub_instance_id`, `generated_at`, `keys: {backup, secrets, pepper}` (hex) | | file and page | Extends today's `EmergencyKit`; the wire adds `keys`, keeps `backupKeyHex` one release for the printed kits that exist |
| `export-manifest`, `spec/schemas/export-manifest.schema.json` | `person_id`, `exported_at`, `hub_instance_id`, `shaped_for` (`child`, `teen`, `adult`), `files[]` | | the zip's `manifest.json` | What CAP-08 reads first; a zip without it is refused with "This is not a Home export" |
| `perf.first_token_budget_ms` | number, 300 to 10000 | 1500 | household, advanced, `household.ai` | The slow-reply budget for typed chat; the standard gets the number once measured on the Studio |
| `perf.replies_slow` health item | `health-item.schema.json`, source `perf` | | the one health list | Raised and resolved by `perf.watch` |
| `security.disk_unencrypted` health item | source `security`, severity `warning` | | the one health list | From the disk probe; never auto-notifies |
| `hub.replies_slow`, `hub.replies_normal` | `notificationTypes.ts` entries | in-app | admins | Once per episode; `passive` on recovery |
| `data-class.sensitivity_copy` | string, additive on `data-class.schema.json` | | declaration | The "who can read it" sentence the disk table shows; one definition per class |
| `redactPii` | function in `backend/src/lib/redactPii.ts` | | | Not a record; listed so the three call sites name one definition |

Nothing changes on `file`, `share`, `memory-record` or `conversation-turn`. All additive; `commons` first, a new `spec-v*` tag,
then Home.

## 5. Privacy and offline

Nothing here adds an outbound connection. The diagnostics report, the export and the kit are downloads to the person's own
device; the privacy page gains no row and says so in the report dialog ("Saved to your device. Home does not send it
anywhere."). `redact_pii` runs before the two paths that already leave the house (a hosted-search query, a problem report)
and before an external link serves text. With no network every screen in this note works. An admin sees component health,
codes, timings and counts; the protection-change list shows a role, a key and two values, and no person's name, text, title or id
(rule 6a). A backup carries `hub.db`, which now holds `setting_changes`, and never `keys`; the kit alone
carries the keys, and the disk table says which classes a backup holds.

## 6. Kit Elements and parts

Non-chat surfaces, so `@maipai/ui/src/ui/*` and the dashboard blocks only: the area items `SettingsShell` already draws, and on each page the kit `Table` (the vendored `DataTable`) for the disk table, the protection-change list and the export contents, `Dialog` for the
report's file list, `AlertDialog` with `Input` for the typed erase confirmation, `Checkbox` for "also remove models",
`Button`, `Alert` (destructive) for failures, `Badge` for encrypted or plain, `Progress` for export and import, `Skeleton`
while loading, `relative-time` for "since 2:14 PM". The emergency kit page is the existing kit page extended by three rows.
No className on a kit part, no wrapper; grid placement sits on Home's own container `div`s. Settings rows are registry keys
drawn by `SettingsShell` with spec copy (S4, S5).

**Reuse check.** Looked at first: `@maipai/core/src/zip.ts` and `archive.ts` (the writer for the report, the export and the
import), `@maipai/core/src/secrets.ts` and `keystore.ts` (no new crypto; the kit reads the same keystore), `to-redact.json`
(the diagnostics allowlist stays the one source), `raiseIssue()` and `notificationTypes.ts` (the slow-reply item and notices),
`ensureCoreJob()` (the watcher is a core job like `tailscale.renew_certificate`), `legacyImport.ts` (its idempotent-by-source
pattern for CAP-08), `lib/factoryReset.ts` (the staged reset this erase extends) and `erasePersonData()` (its per-class order),
`redactCredentials()` and `minorQueryCheck.ts` (the base of `redactPii`), BRANCH-SEC1-01's `lib/protectionStatus.ts` (the disk
probe, on the BRANCH-SEC1-01 branch, landed first: `fdesetup`, LUKS and `Get-BitLockerVolume`). Considered and rejected: SQLCipher (no `bun:sqlite` support, and a key beside the file defends nothing the keystore
does not already); per-person password-derived keys (section 3); a hand-rolled log tailer (the registry events are the log).
Hand-built code is limited to `redactPii()`, `perf.watch` and the erase ordering, because no shipped part
knows Home's classes or household words.

## 7. Rule check

- **Rule 0**: a child's and teen's export is their read path; `redact_pii` never reaches a child's query because none leaves
  the house; audited keys only widen under an admin's hand. No conflict.
- **Rule 1**: `redactPii` decides nothing about searching; it strips before a query the model already chose leaves the house,
  the same deterministic class as the household-name gate rule 1 keeps. No conflict.
- **Rule 6**: the slow-reply item never changes a reply; a missing report never fails anything a person asked. No conflict.
- **Rule 6a**: the diagnostics report holds registry events, codes, timings and counts; the slow-reply item names no person.
  The `setting-change` record holds the key, the old and new values and the actor's role, never a person id or name, so
  it carries no person next to an activity. No conflict.
- **Rule 7**: a hosted provider never gets a minor's query; `redactPii` only tightens an adult's. No conflict.
- **Rule 9, 9b**: every part is a kit primitive; nothing hand-drawn. No conflict.
- **S1, S2, S4, S5**: nothing on the rail; cards in the settings shell; copy from the spec. No conflict.
- **Principle 1 and 4**: one export projection, one redaction function, one kit, one disk table from the class list.
- **CREDENTIALS.md**: "never logged, never returned" holds; the kit route stays admin-after-PIN-only (NO-OWNER-ROLE-01) and is the one place a key is
  returned, as today.

No rule change is needed.

## 8. Slices

| Id | Size | Order | Depends on | Exit check |
|---|---|---|---|---|
| SEC-PRIVACY-01a: the disk probe, `security.disk_unencrypted`, the disk table from the class list, `sensitivity_copy` in spec | M | 1 | spec tag; BRANCH-SEC1-01 | A test fakes each probe answer; a seeded household's table lists every class; `keys` never in an archive (`backup.test.ts`) |
| SEC-PRIVACY-01b: the kit carries three keys; restore reads them first | S | 2 | none | Restore drill on a fresh data dir with the kit: a stored OAuth token decrypts and a PIN verifies; the org BACKUPS.md kit sentence changes in the same commit |
| CAP-06: `redactPii` at the hosted query, problem-report parts, diagnostics, external text links | M | 3 | SEC-PRIVACY-01a | A fixture with a household name, the home address, a phone and an email survives none of the four paths |
| SETTINGS-AUDIT-01: `audited` flag, `setting-change` record, the admins' list | S | 4 | spec tag | Each listed key writes one record with a role and no person id; a refused write none; a teen cannot write one |
| DIAG-REPORT-01: the zip, the dialog, the route | M | 5 | CAP-06 | The redaction test seeds a secret, a name and a chat line and proves none is in the zip; member gets 403 |
| PERF-ALERT-01: stage split, `perf.watch`, the item, the notices, the shaded chart | M | 6 | none | A seeded slow run raises one item with the first slow turn's time and one notice; recovery clears it; one slow turn raises nothing |
| EXPORT-01: the projection, `GET /api/export`, the zip, the page | S | 7 | spec `export-manifest` | A teen's export holds no `reasoning`; forgotten records absent; the route accepts no person id; a request with a person query parameter is ignored and returns the caller's own export |
| MEM-EXPORT-01: `memories/*.md` in the same zip | S | 8 | EXPORT-01 | Front matter carries provenance; a clash gets a code; a second export moves replaced files aside |
| CAP-08: import a person's export | S | 9 | EXPORT-01 | Importing the same zip twice adds nothing; a foreign zip is refused with the sentence; a child cannot import |
| ERASE-HUB-01: the dialog, the extended factory reset, the ordered delete, the wizard's "what was removed" | S | 10 | SEC-PRIVACY-01a (the class list) | After erase a fresh start shows the wizard and the data dir holds no personal class; a member who is not an admin gets 403; the NAS mirror is untouched |
| Hub migration | S | 11 | SEC-PRIVACY-01b | The restore drill on a second machine signs in with an old PIN and reaches a paired device without re-pairing |
| Windows self-update rules as tests | S | with self-update | `lib/selfUpdate.ts` | The `checkRelease()` "never reads up to date" test lands now; the two Defender and dirty-tree tests land with the slice |
| HOME-IMAGE-01 | M | last | the native installer proven on three systems | The image boots, answers health, keeps data on the mounted volume across a restart, and the restore drill passes inside it |

## 9. Legacy verdicts

The legacy mirror was not readable from this worktree, so these come from what the rebuilt code itself records about its
origins. `lib/pin.ts` hashing: rebuilt as designed (`secret.ts`, "adapted from the legacy hub's lib/pin.ts"). Hub identity
and the multi-address check: rebuilt as designed (`hubIdentity.ts`, "ported from the archived legacy hub"). The plaintext OAuth
refresh token found in legacy `app.db` on 2026-08-29: dropped, the reason CREDENTIALS.md exists. Legacy export, erase,
diagnostics and self-update: nothing borrowed; each is redesigned here from the org docs.

## 10. Supersedes

- SEC-PRIVACY-01's wording "per-person keys derived from the person's passcode" and "backups and exports encrypted with the
  person's key": replaced by section 3's design (one keystore, disk encryption as the seizure defence, Incognito as the
  per-person zero-persistence tool), pending decision 2.
- EXPORT-01's open question: decided, read-path shape.
- EXPORT-01's "a parent exports a child record" (NO-CROSS-USER-VISIBILITY-01, rule 6a): an export is the account holder's own.
- SETTINGS-AUDIT-01's "who changed it" and "with the actor": the record carries the actor's role only (rule 6a).
- `emergencyKit.ts`'s one-key kit and BACKUPS.md's "the backup key and hub identity": the kit now carries three keys.
- The "Windows self-update rules as tests" row as a standalone item: folded into the self-update slice's acceptance.
- `GET /api/conversations/export` and `GET /api/memory/export` as the export: they stay as the same projection; the zip route
  is the person-facing export.
- Nothing in NO-OWNER-ROLE-01 ([people note](people-roles-and-account-2026-10-17.md)); this note's owner gates follow it.
- Factory reset's typed "DELETE EVERYTHING" phrase: the confirmation becomes typing the hub's name as shown.
- `lib/factoryReset.ts`'s reset as a separate feature: Erase this hub is that reset, extended (one implementation).
- BRANCH-SEC1-01's protection checks: reused as the disk probe, not rebuilt.
- Nothing in RULES.md.

## 11. Decisions for Jesse

1. Disk encryption on the Studio: recommended to leave your 2026-10-16 choice (auto-login, FileVault off) and let the health
   item state the trade; the alternative is FileVault on and typing the password after every power cut.
2. A "records key" that encrypts conversation and memory text inside `hub.db` with a key in the same keystore: recommended
   not to build it (it defends a copied `hub.db` only when `data/keys` was not copied too, costs search and recall, and defends
   nothing against a seized machine); the alternative is to file it as SEC-PRIVACY-01c for the copied-database case alone.
3. Per-person passcode-derived keys: recommended dropped for the reasons in section 3 (unattended reads, PIN entropy, no
   parent recovery without a back door); the alternative is an adult-only "sealed" tier that needs that adult's sign-in before
   their memory is readable, with their data unavailable to the robot and the night-time pipeline.
4. Publishing the Linux image: recommended only after the native installer is proven on macOS, Linux and Windows, as the row
   says; the alternative is to publish it labelled "for our own tests" sooner.
5. The slow-reply budget of 1500 ms for typed chat: recommended as the default until the Studio measurement replaces it.

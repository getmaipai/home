# Modes, not ages: the mode model and the child and teen protections (2026-10-17)

Jesse's correction of 2026-10-07: "admins will set child, teen or adult mode on each account; that has nothing to do with age,
it has to do with controls; an admin could put their mature teen as an adult, put their grandmother on child." This note decides
the concept, its names, the record it lives on, the migration away from `age_band`, and the four protections that hang off it
whose rows are still open. It covers MODE-NAMING-01, MODE-BIRTHDATE-01, MODE-GUEST-01, AGE-01 (its remaining half), AGE-02,
DOCS-GAP-02, CHILD-PROFANITY-01 and TEEN-RESEARCH-01 (the owner-decided remainder). Design note only; no code. The rename and the
migration loosen nothing; the one new loosening path, an admin choosing looser controls for a person whose birthdate holds them
today, waits on Jesse's edit of rules 0, 2 and 8 and `SAFETY.md` (section 11, item 2). The architect gate
applies (safety path declarations).

## 1. What exists today

| Thing | Where | What it does today |
|---|---|---|
| The band | `backend/src/lib/ageBand.ts` `speakerAgeBand(actor, now)`, type `AgeBand = child, teen, adult` | Role gives a floor (`child`, `teen`, everything else `adult`, guest included at line 39); a birthdate on file can only tighten it (lines 64 to 75). 154 files in `backend/src` and `frontend/src` read `age_band`, `ageBand` or `AgeBand`. |
| The person record | `@maipai/spec` `schemas/person.schema.json`: `role` enum `owner, admin, adult, teen, child, guest`, `birthdate` (core only) | The role enum doubles as the protection level. `age_range` for packages is described in the schema text but nothing derives or exposes it. |
| On the wire | `backend/src/wire.ts:44` `Roster.age_band`; `routes/people.ts:30` `RosterSchema`; `lib/robotPeople.ts` `age_band` to the robot | Every client reads the band by that name. |
| On a turn | spec `turn-signal.schema.json` `age_band`, `age_band_basis` (`identified_profile`, `unknown_speaker_default`); `reply-plan.schema.json` `age_band`; `content-ceiling.schema.json` `band` | One enum, every reader (ceiling, plan, judge, robot). The unknown speaker on a shared surface gets the child result. |
| Settings layers | spec `settings-key.schema.json` `layers: [band, household, person]`, `band_default`, `user_defaults_keys`; `backend/src/lib/settingsLayers.ts` | User defaults (Kids, Teens, Adults) under global defaults under user overrides. The keys that carry the word `band` are the layer name and the default map. |
| The ceiling and the gate | `backend/src/lib/contentCeiling.ts` (`profanity: off` for child, `mild` for teen); `backend/src/lib/safety.ts` `evaluateReply(reply, band)` | The gate checks the floor categories per sentence for a child. The profanity dial is register instruction only: no code softens a word that slips through. |
| Self-edit | `routes/people.ts:294` | A person cannot change their own birthdate; only an owner or admin can. Role changes go through `checkRoleChange` and `MANAGEABLE_BY` (`lib/personLifecycle.ts:70`). |
| Guests | `NewPersonForm.tsx:32`, `personShape.ts` `guestExpiryProblem` | A guest is created with an expiry and no protection choice; they read as adult. |
| Daily minutes | `backend/src/settings/allowanceKeys.ts` (nine `allowance.<category>.daily_minutes` person keys), `lib/allowance.ts` `dailyMinutesAllowed()` | Saved on a child's Family page Limits tab (`PersonProfilePage.tsx:90`, group `person.allowance`); no caller anywhere. |
| AGE-01 | spec `memory-record.schema.json` `child_disclosure`, `vocab/life-events.json`; `memory.ts:62` `canRead()` by band; `memory.ts` `setChildDisclosure()`; `memoryJudge.ts:1458` write-time default | Parts a, b and c are built. Nothing sets `deferred: true` for `register.ts`'s `defer` move, and `guards.ts` has no `false_comfort` row. |
| AGE-02 | `notificationTypes.ts:108` `child.worrying_conversation` (adults, non-configurable); `notifications.ts:297` fires `safety.flagged_turn` from `notify_parent` | The worrying type is declared and never fired. The flagged type fires on the deterministic classifier's categories. |
| Teen research | TEEN-RESEARCH-01 STATUS: fourteen proposals, owner decisions in `OWNER-ANSWERS.md` | Neither `data-scratch/design/TEEN-CAPABILITIES-DESIGN.md` nor `OWNER-ANSWERS.md` is present in this checkout's `data-scratch/design/` (only `APP-SETTINGS-DESIGN.md` is). The decisions survive only as the backlog STATUS line. |

The word "mode" is already taken in Home for other things: Incognito and temporary mode ([privacy mode](../plans/privacy-mode-2026-09-24.md)),
`ease.simple_mode`, `search.source_mode` ([KS-MODE-01](../plans/ks-mode-01-2026-10-10.md)), `robot.greetings.mode`, and the household
switches `search.web.child_mode` and `search.web.teen_mode`, whose labels already say "Web search with child controls". The org
`SAFETY.md` and the backlog rows of 2026-10-07 also say "controls" ("Teen controls preselected", "Adult controls").

## 2. Purpose and audience

The job in one sentence: an admin picks, per account, which set of protections Home applies to that person, and nothing else
(not a birthday, not the person themself) can change it.

| Viewer | Sees | Does not see or do |
|---|---|---|
| Owner or admin | Each person's controls on Users and on the person's page; a Controls choice when adding or editing anyone they may manage; one confirmation when loosening; the Limits and Topics tabs of a person on child controls | Their own controls as editable (an admin's controls are set by another admin or the owner); any person's chats, memories or activity (NO-CROSS-USER-VISIBILITY-01, rule 6a) |
| Adult member | Their own controls as a read-only line in Account ("Adult controls") | A way to change it |
| Teen (teen controls) | "Teen controls" on their Account page, with the one line that an admin set it | Any loosening; their own settings stay private from admins (ruling 2026-09-30) |
| Child (child controls) | Nothing about controls at all | The word "controls", the Limits tab, anyone else's settings |
| Guest | Nothing | Anything but the guest surfaces their controls allow |
| Robot and TV | The controls value on the roster they already read (renamed field, same three values) | Any text; an unknown speaker on a shared surface still gets the child result (amended 2026-10-21: a robot with a companion assigned takes the robot's own controls level, never the companion's type, see [dynamic-companions-2026-10-21.md](dynamic-companions-2026-10-21.md)) |

Rule 0 holds for every slice except MODE-BIRTHDATE-01, which waits on the owner's edit (section 7): every reader keeps the same
three values and the same branches, the migration keeps each person's current result, and only an admin's confirmed choice can
loosen one. MODE-GUEST-01 only tightens (new guests start on teen controls).
The child's gate, topics, hard lines and crisis overlay stay absolute (org `SAFETY.md`).

## 3. Flow and screens

Settings, Users (S4, the kit `SettingsShell` view `home.users`) and the person's page in Family are the only places controls appear.

1. **Add someone** (`NewPersonForm.tsx`). After Role, a second kit `Select` labelled "Controls" with three options, each with one
   line: "Child controls: the full set of protections, every subject gentle, replies checked sentence by sentence";
   "Teen controls: frank answers on most subjects, still no adult content, checked replies"; "Adult controls: frank answers on every
   subject, replies still checked as they arrive, crisis resources always offered". Preselected from the role: child role to Child, teen to Teen, adult, admin and owner to Adult,
   guest to Teen. The form refuses to save a guest with no choice: "Choose child, teen or adult controls for this guest."
2. **Edit someone** (the admin's edit dialog on the person page, `PEOPLE-PROFILE-02`). The same Select. Choosing a looser value
   opens the kit `AlertDialog` once: title "Give Rover adult controls?"; body "Rover will get fewer protections: more subjects
   answered plainly, replies checked as they arrive instead of sentence by sentence, web results less filtered. You can put
   child controls back any time."; buttons "Give adult controls" and "Keep child controls". Tightening needs no dialog. The
   change is one `PATCH /api/people/:id` with `controls`, refused for a self-edit (403 "You cannot change your own controls.
   Ask an owner or admin.") and for a role that may not manage the target (403 "Only an owner or admin can change someone's
   controls.").
3. **The person's page.** A kit `Badge` beside the role label reads "Child controls", "Teen controls" or "Adult controls". The
   Limits and Topics tabs show for a person on child controls (today `age_band === "child"`, `PersonProfilePage.tsx:90`). The
   Limits tab loses the nine daily-minutes rows (section 4, DOCS-GAP-02) and keeps storage.
4. **Existing guests after the migration.** One in-app notification to admins, count only: "2 guests are on adult controls and 1
   person kept stricter controls from their birthdate. Check their controls in Settings, Users." (each part shown only when its
   count is above zero) It names no guest and links to Users with the guest filter. Dismissing it is the end of it.
5. **States.** Empty (no people but the owner): the Users page as today. Loading: the kit `Skeleton` the page already uses.
   Failed save: the kit destructive `Alert` with the server's own sentence, each of which says what to do. Offline: nothing here
   needs the network. Incognito on: no change; controls are not a conversation setting, and a minor's temporary chat keeps the
   privacy note's rules.
6. **Copy rule.** Person-facing copy never says "age band", "age-appropriate", "at this age" or "your age" for this (the
   COPY-RULE-01 lint gains the four phrases). "Age" survives only beside the real birthdate on the admin's edit dialog.

## 4. Records and settings (spec first)

Shared shapes change in `commons/spec` first, then hub, then robot. Every change is additive during the alias period.

| Name | Type | Default | Scope | Meaning |
|---|---|---|---|---|
| `Person.controls` | enum `child, teen, adult` | at migration, each person's current effective result of `speakerAgeBand(person, now)` (role tightened by any birthdate on file), so no one's protections change at migration; a looser value is reached only by an admin through the section 3 confirmation | person record, admin-set | The one input to every protection. Required after the alias period. `provenance` and `hlc` are the record's own (principle 3). |
| `Person.controls_set_by`, `Person.controls_set_at` | person id or `migration`; timestamp. A migrated value that a birthdate tightened is listed to admins in the count-only review notice beside guests, never loosened automatically. | `migration` | person record | Who last set it. Shown on the admin's edit dialog, never to the person. |
| `Person.birthdate` | unchanged | | core only | Kept for the household (birthdays); no reader in the safety, settings or turn path after MODE-BIRTHDATE-01. The schema's `age_range` sentence is removed; packages get `controls`. |
| `TurnSignal.controls`, `TurnSignal.controls_basis` | same enums as `age_band`, `age_band_basis` | | turn record | Replace `age_band` and `age_band_basis`; values unchanged. |
| `ReplyPlan.controls` | enum | | turn record | Replaces `age_band`. |
| `ContentCeiling.controls` | enum | | spec record | Replaces `band`. |
| settings-key `layers` value `controls`; `controls_default`; `user_defaults_keys` | as today | | spec settings schema | Replace the `band` layer name and `band_default`. Layer rows move from `band:<x>` to `controls:<x>` in `settings.ts`. Key names such as `search.web.child_mode` and the band-named household keys stay (renaming a stored key is a migration for no gain; their labels already say controls). |
| `Roster.controls` (wire), robot roster `controls` | enum | | wire | Replace `age_band`. The hub writes both names for the alias period and reads `controls` first, then `age_band`. |
| `allowance.<category>.daily_minutes` (nine keys) | removed | | person | DOCS-GAP-02 (section 8). The migration deletes stored rows; `allowanceKeys.ts` and `allowance.ts` go. |
| Log event `safety.profanity_softened` | fields `controls` (enum), `surface` (`written`, `spoken`, `package`), `count` (integer) | | typed log registry (`spec/log/events.json`) | One event per turn or package reply where the softener replaced at least one word; no text, no id (rule 6a). |
| Notification `people.guest_controls_review` | audience `admins`, level `normal`, `configurable: true`, in-app only | | `notificationTypes.ts` | Fired once by the migration when at least one guest or one birthdate-tightened person exists; template carries counts only. |

Alias period, three spec tags: tag A adds every `controls` field beside its old name (generated types mark the old one deprecated,
fixtures carry both); the hub lands reading new-then-old and writing both; the bot pins tag A or later (BOT-PIN-01) and reads
both; tag B makes `controls` required; tag C removes the old names and the hub and bot follow. No tag changes a value.

## 5. Privacy and offline

Nothing here leaves the home. No outbound connection is added; `obscenity` ships its word data in the package, so the softener
runs with no network. With no network every flow in section 3 works unchanged. An admin sees each person's controls value and who
set it (configuration, not activity) and the softener's daily counts per controls value on the status page, never a word, a
turn or a person next to a count (rule 6a). The guest review notice carries a count. A backup carries `Person.controls` and its
provenance like any person field; nothing else new is stored. A problem report a person previews may include the count of
softened words in their own reply, never the words.

## 6. Kit Elements and parts

Non-chat surfaces, so the kit's shadcn/ui set (rule 9b) as it ships, no `className` that changes shape, no wrappers (rule 9):
`Select` (the Controls choice), `AlertDialog` (the loosening confirmation), `Alert` destructive (save errors, as Setup already
does), `Badge` (the controls label on the person page), `Tabs` (Limits and Topics, already there), `Skeleton`. The chat screen is
untouched; a softened word reaches the kit Thread as ordinary released text.

**Reuse check.** Looked at first: the role `Select` and the person edit dialog that already exist (extended, not rebuilt);
`AlertDialog` for the one confirmation; the existing migration runner and typed log registry; the existing notification
registry for the guest notice. For the softener: `obscenity` 0.4.6 (MIT, deterministic pattern matcher with an English dataset,
the obfuscation transformers for leetspeak, repeated letters and inserted spaces, a built-in whitelist for Scunthorpe-class
false positives, and a `TextCensor` with a replaceable strategy), chosen over `bad-words` (a plain regex list with no
obfuscation handling or whitelist) and `leo-profanity` (list only). Hand-built, with the reason: `controlsFor(person)` in place of
`speakerAgeBand()` (a one-line read of the record; no library does it), the softener adapter that runs `obscenity` inside the
existing sentence gate (the gate is Home's own named gap in rule 9), and the migration.

## 7. Rule check

- **Rule 0** (age and surface gates outrank every rule). NEEDS-RULE-CHANGE, held for Jesse. Substance: MODE-BIRTHDATE-01 lets
  an admin loosen a person whose birthdate the birthdate check holds today, which needs the owner's edit; every gate still reads
  the same three values from one admin-set input, and the unknown speaker still gets the child result. Wording: the rule says
  "Age and surface gates" and "the kid or teen"; after the rename no gate reads an age, so the words are stale. The design does
  not edit RULES.md; the change is a decision for Jesse (section 11, item 2) and no slice that drops the birthdate read is
  dispatched before it lands.
- **Rule 1** (the model decides, not a word rule). The softener is on the output floor, which rule 1 names as what stays
  deterministic ("the safety floor on input and output"); it decides no search or tool. No conflict. `RULES-AND-LEARNED-COMPONENTS.md`:
  a fixed word list on the floor, no learned part. No conflict.
- **Rule 2** (a minor's request sets thinking off). NEEDS-RULE-CHANGE, held for Jesse. Substance: MODE-BIRTHDATE-01 lets an
  admin loosen a person whose birthdate the birthdate check holds today, which needs the owner's edit; the branch itself is
  unchanged and keyed on `controls` after the rename. Wording: "a minor" reads as an age.
- **Rule 5** (a child's or teen's chat keeps its own limits). Unchanged, keyed on `controls`. No conflict.
- **Rule 6a** (logs and admin pages name no person's activity). The softener event is counts by controls value and surface; the
  guest notice is a count. No conflict.
- **Rule 8** ("Age gates still win: a minor never gets model choice or thinking"). NEEDS-RULE-CHANGE, held for Jesse. Substance:
  MODE-BIRTHDATE-01 lets an admin loosen a person whose birthdate the birthdate check holds today, which needs the owner's edit.
  Wording: same as rule 0 ("Age gates", "a minor"). Quoted for the owner's edit, not designed around.
- **Rule 9, 9b, S4, S5**: kit parts as they ship on the one settings shell; the three option lines are form copy, not setting
  copy, and the Limits tab's remaining keys keep `describeSetting`. No conflict.
- **Rule 10** (the gate's strictness follows the person). The softener runs inside the child's per-sentence check and inside a
  spoken turn's for a speaker on child controls; it never releases text the gate would have stopped, and the teen's `mild` dial is
  untouched (adding the softener to teens or to adult spoken turns would be a tightening an admin never asked for; both stay open
  as a later owner choice). No conflict.
- **Rule 13** (measured). CHAT-AB-01 gains one child row with a word the softener must catch and one with a false-positive-shaped
  word it must leave alone. No conflict.
- **Org `SAFETY.md`**: "Child-safety protections ... are non-removable." `Person.controls` is admin-set, so an admin can move a
  child to adult controls, exactly as an admin can set the role to adult today (rule 0 loosening is the owner's own ruling of
  2026-10-07). This is a new loosening path for a person with a birthdate on file, whom the birthdate check holds today. It needs
  the owner's edit of SAFETY.md ('including for the household's own admin') through the org process, listed in section 11, item 2.

## 8. Slices

| Id | Size | Order | Depends on | Exit check |
|---|---|---|---|---|
| MODE-NAMING-01a (commons) | S | 1 | nothing | Spec tag A: `Person.controls` and `_set_by`, `_set_at`; the `controls` twins on TurnSignal, ReplyPlan, ContentCeiling; `layers` value `controls`, `controls_default`; log event and fixtures carrying both names; commons `check.sh` green. |
| MODE-NAMING-01e (Jesse's edit of RULES.md rules 0, 2 and 8, plus the org SAFETY.md sentence "including for the household's own admin" and CLAUDE.md through the org process) | S | 2 | Jesse's edit (section 11, item 2) | The owner's commit carries `Owner-approved: <date>`. No slice that drops the birthdate read is dispatched before this lands; the rename row closes only then. |
| MODE-BIRTHDATE-01 | S to M | 3 | 01a and MODE-NAMING-01e | `controlsFor(person)` reads `Person.controls` only; `ageBand.ts` lines 64 to 75 and `ageInYears` deleted; the migration fills `controls` from today's `speakerAgeBand()` result before `ageBand.ts` lines 64 to 75 are deleted; a test that a person with role adult and an under-18 birthdate migrates to teen controls, not adult; tests: a person with a birthdate under 18 on adult controls is adult, a self-edit of `controls` is 403, an admin loosening returns the confirmation requirement to the client. Architect verdict (safety path), review medium. |
| MODE-GUEST-01 | S | 4 | MODE-BIRTHDATE-01 | New guest form refuses a missing choice, preselects Teen; existing guests keep adult and the admins get one count-only notice; test that a guest on child controls gets the child gate and no ddgs source. Architect verdict (safety declaration). |
| MODE-NAMING-01b (hub rename) | M | 5 | MODE-BIRTHDATE-01 | Every `age_band`, `ageBand`, `AgeBand`, `band` read in `backend/src` renamed; wire writes both names; `bun test` in `backend/`; a grep test that `age_band` survives only in the alias writer and the deprecated reader. |
| MODE-NAMING-01c (frontend and docs) | S to M | 6 | 01b | Frontend names and copy; the four banned phrases in the COPY-RULE-01 lint; `docs/user/people.md` and the other 29 files say controls; `scripts/check.sh --pre`. |
| MODE-NAMING-01d (robot and tag C) | S | 7 | BOT-PIN-01 | Bot reads both names at tag A or later; tag C drops the old names; hub and bot pinned past it. |
| DOCS-GAP-02 | S | any time after MODE-BIRTHDATE-01 | nothing | The nine keys, `allowanceKeys.ts` and `allowance.ts` removed; the migration deletes stored rows; the Limits tab shows storage only; the registry test counts no `allowance.` key. |
| CHILD-PROFANITY-01 | S | any time | nothing | `obscenity` 0.4.6 pinned; the softener runs in `evaluateReply()` for child controls (an unknown speaker on a shared surface reads as child controls), and in `refusePackageReplyIfUnsafe` for a child viewer; replacement is the single spoken-safe word "bleep" (a spoken turn reads it aloud as a word, where asterisks would be read as "asterisk"); whole-word match with the shipped transformers and whitelist; the log event with counts; tests for a caught word, an obfuscated word, "Scunthorpe", and that a teen's reply is unchanged. Architect verdict. |
| AGE-01d (the remainder) | S to M | after ASK-01 | ASK-01 | `deferred: true` set when a child's question resolves to a subject only `adult_only` records could answer; the fixed deferral line through the guard replacement path (care first, "a question for mom or dad", the offer to relay as an `OpenQuestion` of kind `relay`); the `false_comfort` guard row; the `child-grandma` conversation, three seeded runs. |
| AGE-02 (redesigned) | S | after AGE-01d | nothing new | `child.worrying_conversation` is deleted, not fired: the owner's decision of 2026-10-07 is parent alerts only for real danger, which `safety.flagged_turn` already carries from the deterministic classifier (`notify_parent`). The redesign keeps that type, makes its body carry the child's name and the coarse category family only (no `{categories}` list), adds the child's "I might mention this to a grown-up" clause to the plan when it fires, dedupes per turn, and adds the test that no settings key can stop it. |
| TEEN-RESEARCH-01a | S | first | nothing | Recover `TEEN-CAPABILITIES-DESIGN.md` and `OWNER-ANSWERS.md` into `data-scratch/design/` of the main checkout (section 11, item 5); the architect rules on the three decided proposals only. |
| TEEN-RESEARCH-01b (the bedtime window) | M | after 01a and MODE-BIRTHDATE-01 | `person.quiet_hours.from` and `.to` | A parent-set chat window for a person on teen controls, read from the existing quiet-hours keys as a user override an admin sets; outside it the composer shows the kit empty state with the extension request card (an `OpenQuestion` of kind `relay` to the adults); no parent view of anything else. Architect verdict. |
| TEEN-RESEARCH-01c (no feelings for minors) | S | after MODE-BIRTHDATE-01 | nothing | The register forbids first-person feeling claims for child and teen controls on the hub and the robot; a guard row; tests on three seeded runs. |

The remaining eleven proposals of the teen note stay proposals until Jesse rules on them; this note adds nothing beyond the three
he decided.

## 9. Legacy verdicts

Nothing borrowed from legacy; the mirror `legacy-backups/home-legacy.git` is not present on this checkout, and none of these rows
cites it. Rebuild-era features this note retires, for the record: the birthdate-derived band of session C (`ageBand.ts`),
dropped by owner ruling; the nine daily-minutes keys of session F, dropped (never enforced, no honest way to meter minutes in
a turn-based hub); the worrying-conversation notice of section 13, merged into `safety.flagged_turn` (real danger only).

## 10. Supersedes

- The DESIGN FIRST clause of MODE-NAMING-01 (`data-scratch/design/MODE-MODEL-DESIGN.md`): this note is that design. The noun is
  "controls" and the three values stay (section 11, item 1).
- `ageBand.ts`'s own header and the SEC-8 note of 2026-09-06 (birthdate as a tightening cross-check): the admin's choice is the
  only input.
- AGE-02's trigger list (sadness, fear or anger at moderate intensity, a fixed subject list) and its `child.worrying_conversation`
  type: replaced by real danger only, per the owner's 2026-10-07 answers.
- `docs/user/people.md` lines 41 to 47 ("Owners and admins can read a child's chats and memories"): already overridden by
  NO-CROSS-USER-VISIBILITY-01; MODE-NAMING-01c rewrites the page.
- `person.schema.json`'s `age_range` sentence and `age_band_basis`'s "role and birthday" wording.
- ROLE-RENAME-01's premise that the role enum carries the protection level: after `Person.controls` the role is privilege only
  (section 11, item 4).
- Nothing in RULES.md is changed by this note; three edits (rules 0, 2 and 8) are requested in section 7. The org `SAFETY.md`
  sentence "No admin setting ... may disable or weaken them, including for the household's own admin" is superseded only by the
  owner's own edit through the org process (section 11, item 2); until then it stands and MODE-BIRTHDATE-01 waits.

## 11. Decisions for Jesse

1. The noun. Recommended: "controls" ("Child controls", "Teen controls", "Adult controls"; code and spec `controls`), because
   "mode" already means Incognito, simple mode, source mode and the greeting mode, and the copy and `SAFETY.md` already say
   controls. Alternative: "mode" as you said it, with the same three values.
2. Three edits only you can make, together under one `Owner-approved`: RULES.md rule 0 ("Age and surface gates" to "Controls and
   surface gates"), rule 2 ("A minor's request" to "A request on child or teen controls"), rule 8 ("Age gates still win" to
   "Controls still win"), and the org `SAFETY.md` line "including for the household's own admin" amended through the org process
   so that an admin's assignment of controls is the one allowed loosening, with the confirmation dialog. Recommended: make all
   three, because MODE-BIRTHDATE-01 removes the birthdate check that holds a person today and no slice that drops it is dispatched
   before this lands; CLAUDE.md follows. Until then MODE-NAMING-01e and MODE-BIRTHDATE-01 wait.
3. DOCS-GAP-02. Recommended: remove the nine daily-minutes keys (they never worked, and minutes cannot be metered honestly in a
   turn-based hub); time limits become the teen bedtime window you already decided. Alternative: build a per-person usage meter,
   which would also be a per-person usage count NO-CROSS-USER-VISIBILITY-01 removes.
4. Roles after controls. Recommended: fold `adult`, `teen` and `child` roles into one `member` role in ROLE-RENAME-01 (roles
   become admin, member, guest after NO-OWNER-ROLE-01; controls carry the protections), one definition for one thing. Alternative: keep the six
   roles with controls beside them.
5. `TEEN-CAPABILITIES-DESIGN.md` and `OWNER-ANSWERS.md` are not in `data-scratch/design/` on this checkout. Recommended: tell the
   session where they live so TEEN-RESEARCH-01a can copy them in; otherwise the three decisions stand on the backlog STATUS line
   alone and the other eleven proposals are lost.

# People, roles, grants and the account: the permission model after the rebuild (2026-10-17)

This note decides how a household's people are gated after the rebuild: the role ladder once the owner role goes, how a
package's `min_role` meets the grant model, what one person may see of another (nothing), the account's own controls (change
a PIN, switch profile, connect a phone), and the sign-in slowdown held on a branch. It covers the backlog rows NO-OWNER-ROLE-01,
GRANTS-01 (`min_role` on every package manifest becomes a grant check too), RELATION-INFER-01 (relationship inference),
PARENT-CONTROLS-UI-01 (the admin and parental-controls surface), DOCS-GAP-03b, ACCOUNT-PIN-CHANGE-01,
RAIL-SWITCH-PROFILE-01, DEVICE-PHONE-01, BRANCH-SEC1-01, NO-CROSS-USER-VISIBILITY-01 and LOG-PRIVACY-01. Design note only; no
code. The architect gate applies.

## 1. What exists today (from code, 2026-10-17)

| Piece | Where | State |
|---|---|---|
| The role ladder | `Person.role` enum `owner, admin, adult, teen, child, guest` (`@maipai/spec` `person.schema.json`); `backend/src/middleware/auth.ts:184` `ROLE_LADDER`; hand-copies in `lib/settingsAreas.ts:21`, `lib/gate/decide.ts:76`, `frontend/src/apps/people/roles.ts:21` | Four copies of one ladder |
| Role gates | 84 routes on `requireRole("owner", "admin")`, 2 on `("owner", "admin", "adult")`, 5 on `requireRole("owner")` (`storage.ts` factory reset x3, `memory.ts:411` legacy import, `backups.ts:300` emergency kit), 38 on `requireRoleOrGrant`; 188 `"owner"` string sites in `backend/src`, 42 in `frontend/src` (tests excluded) | The owner role is load-bearing in about 20 places (section 3) |
| Grants | `lib/grants.ts` (`createGrant`, `personIsGranted`, `OWNER_ONLY_GRANT_ACTIONS`, `ADMIN_HELD_GRANT_ACTIONS`), `lib/permissions.ts`, `GET /api/people/:id/permissions`, vocab `spec/vocab/grant-actions.json` (24 actions) | Real; consulted only by `requireRoleOrGrant` and `relationships.ts:110`. No `use:<package>` grant is read anywhere |
| `min_role` | Every bundled manifest (34 at `child`, 5 at `teen`); `meetsMinRole()` in `lib/plugins.ts:469`, called from `plugins.ts:570`, `widgets.ts:69,92`, `apps.ts:162,177`, `commands.ts:138,215` | Role only; a grant cannot widen or narrow it |
| Cross-person access | `lib/access.ts` `canAccessPerson`: self, or owner/admin reading a child; used by memory, conversations, attachments, artifacts, chat folders, settings and `dashboard.ts:48` `visibleTargetIds`; `entities.ts:108`, `relationships.ts:168,204`, `lists.ts:75` give an admin `canSeeAll` | Admins still read a child's chats, memories and files; breaks the 2026-10-07 ruling |
| Profile pages | `PersonProfilePage.tsx`: Overview; Memories when `canAccessPerson`; Limits and Topics for a child the viewer manages; `isProfileClosedTo` blocks a teen's page for an admin; adults' cards still link (DOCS-GAP-03b) | Memories keys on role, Limits on band |
| Parental controls | `areas.json` section `parental-controls` (adult band, `needs: household.has_child`) links to `/people`; a child's Limits and Topics tabs draw `person.allowance` and `person.topics` through the kit settings shell (`personLimits.ts`); `SiteBlocksSection.tsx` on the Users page | Built per child; no teen person-level keys by design; allowances saved but not applied (DOCS-GAP-02) |
| PIN | `POST /api/auth/change-secret` (self only, `currentSecret` plus `newSecret`, argon2id, per-profile lockout and per-address throttle) | Route real; no screen calls it since `ChangeSecretSection` was deleted |
| Rail profile | `frontend/src/shell/RailProfile.tsx` fills the kit `RailProfileMenu` (notifications, status, Incognito, Settings, Home settings, Help, Log out) | No switch-profile row; the kit has no prop for one |
| Devices | `DevicesSection.tsx` (own devices, revoke); device tokens hashed, one-year TTL (`lib/deviceTokens.ts`); Quick Connect for a TV (`lib/quickConnect.ts`, 6-char code, 5 minutes, in memory, single use); `Device.kind` already has `phone` | No way to connect a phone from the hub side; kit `QrCode` exists and `AwayFromHome.tsx` uses it |
| Sign-in slowdown | `origin/backup/home-codex-a-sec1-rate` 9137951e: per-address exponential delay 1 s to 30 s, 15-minute window, never permanent; `backup/home-codex-a-sec1` ce58f59a: FileVault, swap, data-folder permission and key-location checks on the status page; 19f12bab: a flakes ledger | Unreviewed, not on `main` |
| Logs | Spec `log/events.json` and `log-events.schema.json` (typed events, no free text, no ids), `problem-report.schema.json` (LOG-PRIV-01a); hub `lib/log.ts` | Registry landed; hub adoption, canary test and the report flow not built |

## 2. Purpose and audience

The job: every person reaches exactly their own things plus what the household gave them, an admin runs the house without
seeing anyone's activity, and the account's own controls (PIN, profile, phone) are a person's to use.

| Viewer | Sees and does | Does not see |
|---|---|---|
| Admin (owner today) | The roster, Users, Home settings, every grant, each child's Limits, Topics and Sites, device pairing, backups, the dangerous actions behind a PIN re-entry | Any other person's chats, memories, files, searches, relationships or usage, child included |
| Adult member | Own profile, PIN, devices, memories, grants held; the approval queue for asks addressed to adults | Users, Home settings, anyone else's activity |
| Teen | Own profile, PIN, devices, memories; may ask for a grant (approvals) | Users, Home settings, model and mode controls; no admin opens their page past the header |
| Child | Own profile (header, Overview), a PIN they or a parent sets, own memories | Users, Home settings, grants, the Devices pairing; no admin opens their activity |
| Guest | Own profile until `guest_expires_at` | Everything above; `min_role: guest` packages only |
| Robot or TV (shared screen) | A paired device's own session; Quick Connect | Nothing per-person beyond the signed-in session; no pairing starts from it |

Rule 0 stated: nothing here loosens a child or teen protection. A grant widens a role check only; it never reaches `min_band`,
the output gate, SafeSearch, the adult-site host list, the topic block or the crisis overlay (`SAFETY.md`). Removing an admin's
view of a child's chats removes a supervision path by the owner's ruling of 2026-10-07, not a protection; the text-free safety
alert to adults (`notificationTypes.ts`, audience `adults`) stays.

## 3. Flow and screens

**The ladder without an owner (NO-OWNER-ROLE-01).** `admin` is the top rung; admins are peers. Every `owner` row becomes
`admin` in one migration; the setup wizard's `owner` step keeps its id (`setupState.ts`) and its button reads "Create your admin
account". What the owner role decides today, and what decides it afterwards:

| Today only the owner | Afterwards | Code |
|---|---|---|
| Changes any role; creates an admin | Any admin, with a last-admin guard ("this is the household's only admin; make someone else an admin first") and "you cannot change your own role" kept | `personLifecycle.ts` `checkRoleChange`, `otherOwnerCount`, `MANAGEABLE_BY`; `routes/people.ts` `CREATABLE_BY`; `roles.ts` |
| Edits or deletes another admin | Any admin, same last-admin guard; the credential rule holds (an admin always has a PIN, password or passkey) | `MANAGEABLE_BY.admin`, `assertOwnerAdminLadder` (`settings.ts:541`), `layeredScalar.ts:97` |
| Factory reset, legacy import, emergency kit, the setup folder picker, restore, and the security note's Erase this hub (an extension of factory reset) and protection-change list | Any admin, after re-entering their own PIN in the same request (`confirmSecret` body field verified by `verifyAgainstRecord`, the lockout and throttle counting as on sign-in) | `storage.ts:192,205,224`, `memory.ts:411`, `backups.ts:300`, `setupFolders.ts:64`, `BackupsPage.tsx:68` |
| Holds `backups.restore` | Held by role; never grantable (the set is renamed `ADMIN_ROLE_ONLY_GRANT_ACTIONS`; the admin self-grant refusal goes) | `grants.ts:77,126` |
| Named as "the owner" for Tailscale, the setup checklist, the household name | The first admin by `created_at` | `tailscale.ts:158`, `setupChecklist.ts:56`, `settings.ts:358` |
| Appears as a label and picker option | Gone; `ROLE_LABELS`, `NewPersonForm.tsx` `ROLE_OPTIONS`, `UsersSection.tsx:279` role select | `roles.ts`, `NewPersonForm.tsx`, `UsersSection.tsx` |

The 84 `requireRole("owner", "admin")` sites become `requireRole("admin")` through one helper rename (`isOwnerOrAdminRole`
to `isAdminRole`, `wire.ts:818`), and a gate test fails on any `"owner"` role string left in `backend/src` or `frontend/src`
outside the migration. The four ladder copies collapse into the spec's enum order, read once.

**Role names (ROLE-RENAME-01).** The rung names and what a role carries are decided in [the modes note](modes-and-child-protections-2026-10-17.md),
section 11, item 4. After `Person.controls` the role is privilege only, and protections read `controls`. This note only removes
the `owner` rung, which holds under either answer.

**`min_role` as the default grant (GRANTS-01).** No grant rows are seeded at install (N people times M packages is data debt).
One resolver `packageAccess(person, manifest)` in `lib/plugins.ts` replaces the six `meetsMinRole` call sites: an active
`deny` on `use:<package>` refuses; else an active `allow` on `use:<package>` or `packages.use_all` admits; else `meetsMinRole`.
Deny beats allow, as the vocab says. A grant lowers the role floor only; `min_band` on blocks, the output floor and every
band-keyed check run after it unchanged. A grant may not admit a `guest` to a package above `guest`
(`approver` for guest is not in the vocab; guests stay role-only). Commands keep `commands.ts`'s own floor.

**Relationships (RELATION-INFER-01).** The narrow case built on 2026-09-13 ships: a stated relation is the speaker's, an inferred one is
a candidate the speaker answers (ASK-01) and nobody else reads. The pipeline that joins records to guess a relationship does
not ship in v1. Confirming an inferred edge is the speaker's own act; the "household adult confirms" path in
`routes/relationships.ts:110` and the admin `canSeeAll` over person-scoped edges and entities go with the visibility wall below,
because both let an adult read what a teen said. Household-scoped edges stay admin-managed.

**The visibility wall (NO-CROSS-USER-VISIBILITY-01, DOCS-GAP-03b).** `canAccessPerson` keeps one branch: `actor.id ===
personId`. Activity data (memories, conversations, temporary conversations, attachments, artifacts, chat folders, lists, the
dashboard's `visibleTargetIds`) is the person's alone. A second predicate, `canManagePersonControls(actor, target)`, carries the
ladder for what an admin writes about a child: allowances, topics, site blocks, session lock, companions, the real photo
confirmation. The profile page of anyone else shows the header and Overview; Memories appears only on your own page; Limits,
Topics and Sites appear for a person on child controls whom the viewer manages (`Person.controls`, modes note). `isProfileClosedTo` is deleted: a teen's and an adult's card open the
same way, to a page with nothing private on it. The approval queue shows what the asker asked for, which is their own act.

**Parental controls (PARENT-CONTROLS-UI-01).** The surface is the child's Family page (Limits, Topics, Sites tabs), already drawn by the kit
settings shell. What remains: the `parental-controls` link lands on Family with the children's cards first and a "Set limits"
action on each; Sites moves from the Users page onto the child's Limits tab (one place per control); the daily-minutes rows leave
the Limits tab under DOCS-GAP-02, as the modes note decides (section 11, item 3). Nothing for teens at person level, by the `not_placed` reason in `areas.json`.

**Change my PIN (ACCOUNT-PIN-CHANGE-01).** Settings, Profile (`account.profile` view, `settingsViews.tsx:34`) gains a card
"PIN or password": one line, "Needed to open your profile", and a Change button. The kit `Dialog` holds the current PIN
(`PasscodeInput` with `pinDigits` from `GET /api/auth/me`, or a password `Input` when `pinDigits` is null), the new one, and
"Use a password instead". A person with no PIN yet sees "Add a PIN" and no current field. Errors: "That PIN is not right. Try
again. 3 tries left." (401), "Too many tries. Wait 30 seconds." (429), "A PIN is 4 to 8 digits." (400). On success: "Your PIN is
changed. Use it next time you sign in." A PIN cannot be removed where the role requires one (`ROLE_REQUIRES_CREDENTIAL`).

**Switch profile (RAIL-SWITCH-PROFILE-01) waits on S1.** RULES.md S1 lists what the rail's profile menu holds, and the list
was owner-approved on 2026-10-06; a "Switch profile" row is not on it, so this note does not add one. The row stays open on the
backlog as a NEEDS-RULE-CHANGE request (decision 8). When S1 is amended, the design is: the row above Log out opens the sign-in
picker at `/sign-in?switch=1` with a "Back to Juniper" row; the current session stays valid until another person signs in, when
the hub revokes the previous session for that cookie (`issueSession` deletes the row it replaces) and the client clears the
query cache exactly as Log out does; lockout, the address slowdown and the session lock apply as on any sign-in.

**Connect a phone (DEVICE-PHONE-01).** In the Devices app's Add a device ([Devices note](devices-and-robot-link-2026-10-17.md), screen 2), an admin sees "Connect a phone". A dialog asks "Whose phone?"
(the roster, self first) and shows the kit `QrCode` of `<hub LAN origin>/connect?code=<code>` plus the code in letters for a phone
with no camera. The code is 8 characters from Quick Connect's no-ambiguity alphabet, lives 10 minutes, works once. The phone
opens `/connect`, the sign-in page redeems it, and the phone becomes that person's `phone` device with a session (`issueDeviceToken`
plus `issueSession(..., "paired_device")`), listed under their devices with the existing Remove. States: expired ("This code has
expired. Make a new one on the Devices page."), used ("This code was already used. Make a new one."), away ("Connect from the
home network. Away access pairs through the Away page."), localhost origin (the button is disabled with "Open Home from its
network address first, then connect a phone."). A child never sees the button; an admin pairing a child's phone is an admin act.

**Sign-in slowdown and protection checks (BRANCH-SEC1-01).** Land 9137951e (the slowdown) after a medium review: it replaces the
core token bucket, is keyed by client address under `TRUST_PROXY`, caps at 30 s and forgets after 15 minutes, so a household
NAT address is never locked out while the per-profile lockout still holds. Land ce58f59a (the checks) with two changes: the
shell commands run on the status board's own refresh schedule, never per request, and each row says what to do ("Turn on
FileVault in System Settings"). Drop 19f12bab (a stale flakes ledger). Both are admin-only status rows naming no person.

**Logs (LOG-PRIVACY-01).** The registry is the rule. The hub's `lib/log.ts` gains the typed API that takes only registry events,
a canary test plants a person's name, a title, a URL and an id in a turn and asserts no log line carries them, and the
problem report (`problem-report.schema.json`) is the one path to detail: the affected person previews it and sends it.

States common to every screen above: loading is the kit `Skeleton`; a failed request is the kit destructive `Alert` with the
server's message; offline shows the same Alert ("Cannot reach your Home. Check the network and try again."); Incognito on
changes nothing here (settings and sign-in are outside the temporary conversation).

## 4. Records and settings (spec first)

| Name | Type | Default | Scope | Meaning |
|---|---|---|---|---|
| `Person.role` (spec, tag N) | enum | unchanged | record | `owner` kept one tag, marked deprecated in the description; the hub never writes it |
| `Person.role` (spec, tag N+1) | enum `admin, adult, teen, child, guest` | `adult` | record | `owner` removed after hub and robot land; a robot that still holds `owner` reads it as `admin` |
| Hub migration `people.role owner -> admin` | migration | | hub | Idempotent; also rewrites `ROLE_REQUIRES_CREDENTIAL` and `CREATABLE_BY` |
| `confirmSecret` | string, body field | | wire, 5 routes | The admin's own current PIN or password; verified like sign-in; never logged |
| `grant-actions.json` `backups.restore` | description only | | spec | "Held by every admin; not grantable" |
| `packageAccess(person, manifest)` | function | | hub | The one resolver (section 3); reads `use:<package>` and `packages.use_all` grants |
| `phone_pairing_codes` | hub table `{id, code_hmac, person_id, created_by_person_id, expires_at, consumed_at, created_at}` | | hub only | Not a shared record (a credential artifact, like `sessions` and `device_tokens`); never synced, never backed up |
| `POST /api/devices/phone-code` | wire, admin, LAN only | | hub | `{person_id}` to `{code, expires_at, url}`; rate-limited per admin |
| `POST /api/auth/connect` | wire, LAN only, unauthenticated | | hub | `{code}` to a session and device; one use; the same address slowdown as sign-in |
| `GET /api/auth/profiles` `?switch=1` | no change | | | The picker already returns everyone; the Back row is client state |
| `log.ts` typed API | function per registry event | | hub | Takes a registry event id and its closed fields; nothing else compiles |

No new settings key. `security.session_lock_required` and `security.session_lock_timeout_minutes` stay as they are.
Shared shapes change in `commons/spec` first, then hub, then robot; every change above is additive within a tag.

## 5. Privacy and offline

Nothing leaves the home. No outbound connection is added: the QR carries a LAN origin, the phone's redeem is a LAN request,
and the protection checks read the local machine. With no network nothing here changes; with no hub a phone cannot pair. An
admin can see: the roster, roles, grants with their reason and author, every device's name, kind and link health, never who it belongs to beside a time (as the [Devices note](devices-and-robot-link-2026-10-17.md) decides), the status rows,
error codes and counts. An admin cannot see: any person's text, title, URL, file name, search, memory, relationship candidate,
conversation or per-person usage (rule 6a), a PIN or its digit count for another person, a pairing code after it is shown once
(stored as an HMAC with the keystore pepper, `lib/secret`), a session token. A backup carries people, grants, credential hashes
and device rows; it never carries sessions or pairing codes. The problem report is the only path from a person's detail to an
admin, and the person sends it.

## 6. Kit Elements and parts

Non-chat surfaces, so the kit's shadcn/ui set (rule 9b): `Card`, `Dialog`, `Button`, `Input`, `PasscodeInput`, `QrCode`,
`Select` (whose phone), `Alert`, `Skeleton`, `Tabs` (the profile page as today), and the kit `SettingsShell` for the Limits,
Topics and Sites cards. No className that changes shape or layout; no wrapper. No missing part while RAIL-SWITCH-PROFILE-01
waits on S1; when it proceeds, its `switchProfile` row on `RailProfileMenu` is an additive kit prop in `commons` first.

**Reuse check.** Looked at first: `POST /api/auth/change-secret` (used as is), Quick Connect's code alphabet, TTL and
single-use flag (reused for the phone code; the direction is reversed, hub shows and phone redeems, so it is a second table, not a
second mechanism: the TV flow stays in memory because a TV re-asks, a phone code survives a restart within 10 minutes),
`issueDeviceToken` and `issueSession`, `verifyAgainstRecord` for the PIN re-entry, `setupLocalOnly`'s LAN check as the model for
the LAN-only middleware, `requireRoleOrGrant`, the kit `QrCode` already used by `AwayFromHome.tsx`, the spec log registry and
problem report. Hand-built: `packageAccess()` (no shipped part resolves grants against a manifest), the role migration, the
pairing-code table, the typed log API (the registry is data; the hub needs the one function that honours it).

## 7. Rule check

- **Rule 0**: grants widen role checks only; band, floor, SafeSearch, topic block and crisis paths untouched; a child cannot
  start pairing. No conflict.
- **Rule 6**: not in the chat path. No conflict.
- **Rule 6a**: the wall removes the admin's child view, the admin `canSeeAll` and the parental Memories tab; the log API cannot
  carry text or ids; status rows name no person. No conflict; this note is the inventory the row asks for.
- **Rule 9 (a) to (c), 9b**: kit parts as they ship; a future gap is an additive kit prop in `commons`. No conflict.
- **S1**: the profile menu's contents are rule text (owner-approved 2026-10-06). A "Switch profile" row would change it, so it is
  not designed here: NEEDS-RULE-CHANGE, held for Jesse (decision 8). Everything else leaves the rail untouched. No conflict.
- **S4, S5**: the PIN card and the Devices dialog are views inside the kit settings shell; copy for setting keys comes from the
  spec; the dialog's own strings are page copy, not setting help. No conflict.
- **Platform principle 1 and 4**: four ladder copies become one; `canAccessPerson` and `canManagePersonControls` are the two
  questions, each in one place. **Principle 3**: the pairing table is a credential artifact, not a record, like `sessions`.
- **CREDENTIALS.md**: PIN re-entry and the pairing code are one-way (argon2id, HMAC with pepper), never logged or returned, one
  use, expiring, revocable from the Devices list. **SAFETY.md**: child protections unchanged; the "parents use the kid's
  passcode" line is the stated way a parent reads a child's chats.
- One NEEDS-RULE-CHANGE, held for Jesse: the Switch profile row in the profile menu (S1, decision 8).

## 8. Slices

| Id | Size | Order | Depends on | Exit check |
|---|---|---|---|---|
| NO-CROSS-USER-VISIBILITY-01 | M | 1 | architect verdict | `canAccessPerson` is self-only; `canManagePersonControls` carries the ladder; per-role regression tests on memory, conversations, attachments, artifacts, folders, lists, entities, relationships, dashboard; `check.sh` full plus review medium |
| DOCS-GAP-03b | S | 2 | slice 1 | Every card links; Memories only on own page; `isProfileClosedTo` deleted; a test per role |
| NO-OWNER-ROLE-01a (spec) | S | 3 | decision 1 | `owner` deprecated in `person.schema.json`, tag cut |
| NO-OWNER-ROLE-01b (hub) | L | 4 | 01a, decision 1 | Migration; the table in section 3 applied; `isAdminRole`; one ladder; a gate test finds no `"owner"` role string; full `check.sh`, review medium |
| NO-OWNER-ROLE-01c (step-up) | S | 5 | 01b, decision 2 | The five routes refuse without a correct `confirmSecret`; lockout counts; tests |
| NO-OWNER-ROLE-01d (spec) | S | 6 | 01b landed in hub and bot | `owner` removed from the enum, tag cut, pins bumped |
| GRANTS-01 (`packageAccess`) | M | 7 | nothing | Six call sites replaced; deny beats allow; a child with `use:<pkg>` allow still gets band filtering; tests |
| ACCOUNT-PIN-CHANGE-01 | S | 8 | nothing | The card and dialog; next sign-in needs the new PIN; wrong current PIN changes nothing; tests |
| RAIL-SWITCH-PROFILE-01 | S | held | S1 amendment (decision 8) | Not scheduled until Jesse amends S1; then the commons prop first, then the row |
| DEVICE-PHONE-01 | M | 11 | nothing | QR and code; second use and expired code refused; away request refused; the phone appears under the person's devices; tests |
| BRANCH-SEC1-01 | S | 12 | nothing | 9137951e and ce58f59a cherry-picked, checks on the refresh schedule, 19f12bab dropped; review medium; full `check.sh` |
| LOG-PRIVACY-01b (typed API, canary) | M | 13 | nothing | Only registry events compile; the canary test passes in the gate |
| LOG-PRIVACY-01c (problem report) | M | 14 | 01b | A person previews and sends; an admin reads only reports; tests per reporter mode |
| PARENT-CONTROLS-UI-01 (parental controls) | S | 15 | slice 1 | Family lands children first with Set limits; Sites on the Limits tab; Limits tab per the modes note's DOCS-GAP-02 |
| RELATION-INFER-01 (relationships) | S | 16 | slice 1 | The join pipeline recorded as dropped; the adult-confirm path removed; speaker confirm tested |

## 9. Legacy verdicts

- The owner role above admin: redesigned (removed; admins are peers with a last-admin guard and a PIN re-entry for the
  dangerous actions).
- A parent reading a child's chats and memories from the admin side (legacy "Child controls"): dropped (owner's ruling
  2026-10-07; the child's own passcode is the way).
- Quick Connect (legacy `lib/quickConnect.ts`): rebuilt as designed for TVs; its alphabet and single-use rule reused for the
  phone code.
- Sessions (legacy `lib/session.ts`): rebuilt as designed; a switch, once S1 allows it, revokes the replaced session.
- The change-PIN screen (`ChangeSecretSection`, deleted in the rebuild): rebuilt as designed on the kit settings shell.
- The sign-in token bucket (`@maipai/core` `secretThrottle`): redesigned as the per-address slowdown.

## 10. Supersedes

- `lib/access.ts` `canAccessPerson`'s child branch and its "parity with 4.14's conversation-visibility rule" comment;
  `dashboard.ts` `visibleTargetIds`'s child ids (already superseded by [the Home page note](home-page-2026-10-17.md)).
- The "parental view" of a child's memories in `docs/dev.md` (2026-09-14 decisions on the Memory page) and the Memories tab
  for a child on `PersonProfilePage.tsx`.
- GRANTS-01's wording "the default grant a package's install seeds": no seeding; one resolver.
- ROLE-RENAME-01's "`owner`/`admin` are unaffected": the owner rung goes first; the rung names themselves are the modes note's
  decision.
- [Security and data lifecycle](security-and-data-lifecycle-2026-10-17.md): its erase, emergency kit, protection-change list
  and restore follow this note's admin-after-PIN gate (that note says so in its own Supersedes).
- [Household memory permissions](../plans/household-memory-permissions-2026-09-26.md): "owner/admin" reads "admin";
  the design otherwise stands. [People profile](../plans/people-profile-2026-09-26.md): decision 1 (admin confirms a child's
  photo) stands as a control write; its child-view rule becomes the rule for every page but your own.
  [Family tabs](../plans/family-tabs-lane-b-2026-09-28.md): the Bots tab's `isOwnerOrAdminRole` branch reads `isAdminRole`.
- `grants.ts` `OWNER_ONLY_GRANT_ACTIONS` and the admin self-grant refusal; `ROLE_REQUIRES_CREDENTIAL` loses `owner`.
- Nothing in `RULES.md`; RAIL-SWITCH-PROFILE-01 is held until S1 is amended (decision 8).

## 11. Decisions for Jesse

1. NO-OWNER-ROLE-01 peers: any admin may edit, demote or remove another admin behind a last-admin guard (recommended), or an
   admin may only step down themself.
2. The dangerous actions (factory reset and erase, legacy import, emergency kit, folder picker, restore): any admin after re-entering their
   own PIN (recommended), or a named "primary admin" setting, which is the owner role under another name.
3. Withdrawn: the role names are the modes note's decision 4.
4. Relationship inference in v1: ship the narrow built case only and drop the join pipeline (recommended), or keep the
   pipeline on the backlog.
5. A parent seeing a relationship inferred from a teen's chat: no, by your 2026-10-07 ruling (recommended to confirm here,
   since the row named it as yours).
6. Connect a phone: an admin may pair any household member's phone by choosing the person (recommended), or only their own.
7. The admin's Memories view of a child goes with the wall (recommended, following the same ruling); say so if the child case
   was meant to stay.
8. RAIL-SWITCH-PROFILE-01 needs S1 amended (NEEDS-RULE-CHANGE, architect 2026-10-17): the profile menu list would read
   "Notifications, System status, Settings, Home settings (admin only), Help, Switch profile and Log out" (the same edit
   retires the stale "owner and admin" wording once NO-OWNER-ROLE-01 lands). Recommended: amend it with an `Owner-approved`
   commit; the alternative is to drop the row and keep Log out as the only way to change person.

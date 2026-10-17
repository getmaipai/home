# Packages, the app store, skills, package tools and integrations (2026-10-17)

This note decides how a household finds, installs, reads the state of and talks to packages: the Apps page and its store
(APPSTORE-DESIGN-01), the Skills page (SKILLS-PAGE-02), one list of package states in words (APP-STATE-01), typed read and action
exposure of package tools in the manifest (PKG-EXPOSE-01), the household runtime as a
workspace package (RUNTIME-01), a generic wall, budget and probe layer before any media package (SERVICE-WALL-01),
the integrations row "Find people and things" with calendar beside it (PRESENCE-FIND-01), a notes workspace (NOTES-01), the model's
knowledge of its own capabilities (SELF-KNOW-01), and the RapidOCR port (MEDIA-INT-06). Design note only, no code. It builds on
accepted records and re-decides nothing they settled: [tools-ecosystem-design-2026-10-03](../plans/tools-ecosystem-design-2026-10-03.md)
(T1 to T5, H1 to H4, K1 to K7, O1 to O17), [catalog-marketplace-research-2026-10-03](../plans/catalog-marketplace-research-2026-10-03.md),
[app-kind-2026-10-16](../plans/app-kind-2026-10-16.md), [status-internet-services-2026-09-30](../plans/status-internet-services-2026-09-30.md).

## 1. What exists today

| Area | Code or record | State on 2026-10-17 |
|---|---|---|
| Packages | `backend/packages/` (38 directories, `bundled-provenance.json`); `backend/src/lib/plugins.ts` reads `id`, `kind`, `min_role`, `args`, `warm`, `tier`, `data_sources` | Every package is bundled; one real `kind: "skill"` (`storytime-style`); no `kind: "app"` or `integration` package |
| Store | `backend/src/routes/store.ts` (`POST /api/store/installs/:id`, rollback, uninstall with preview, channel), `lib/store.ts`, `lib/storeIndex.ts` | Verify, unpack, smoke, permission diff (409 `requiresConfirmation`) and rollback work; `source` and `trust` arrive per request because no pinned catalog address or root key exists (K2, O14 open); no browse route; no store page in `frontend/src` |
| Apps library | `frontend/src/shell/appCatalog.ts`, `useAppCatalog.ts`, [app-library.md](../app-library.md); `frontend/src/apps/library/appPresentation.ts` | Lists launchable routes and (APP-KIND-04) package apps; `packageState()` knows two words, "Ready" and "Attention" |
| Skills | `frontend/src/shell/pages/settings/ChatSkillsSection.tsx` (view `chat.skills`, `spec/settings/areas.json:760`), `GET /api/plugins/skills` (`backend/src/routes/plugins.ts`) | One flat `Item` list with a `Badge` ("Used in chat", "Not used in chat yet", or `offer_label`); no search, tabs, categories, detail or Add |
| Package state | `lib/smoke.ts` (`enabled` or `disabled`), `lib/capabilities.ts` (`missingRequired`, `missingOptional`, `installRefusal`), `routes/plugins.ts:142` ("disabled (failed its last smoke test)"), `spec/vocab/status-model.json` (services, not packages) | Three vocabularies, none shared with the robot; "update ready", "needs setup", "beta" and "will not run here" have no word anywhere |
| Manifest | `@maipai/spec/schemas/manifest.schema.json`: `exposes.queries[]` (`id`, `description`, `args`, `returns`), `provides[]`, `permissions` (`integration:<id>`, `home:<domain>`, `ocr`, `net:<host>`), `needs[]`, `offer`, `data_sources`, `contributes.{widgets,pages,data,settings_area,tours}` | `exposes.queries` has no reader in `backend/src` (`lib/llm.ts:182` still says "once D's exposes.queries lands"); `knowledge_source.query_id` is its only consumer by name |
| Package host | `backend/src/lib/packageHost.ts`: `host.integration.call` answers only `home_assistant` (line 607) and `searxng` (line 666), every other id is `notImplemented` (line 2413); `host.ocr.read` (line 2463) requires `ocr` and calls `runRapidOcr` | `lib/integrations/homeAssistant.ts` is the one integration; `lights-on`, `lights-off`, `lock-doors` reach it |
| OCR | `backend/src/lib/documentExtraction.ts:157` spawns `MAIPAI_RAPIDOCR_COMMAND` from Home | A model run outside the Stack: the rule 11 breach MEDIA-INT-06 names. [vision-images-2026-10-17](vision-images-2026-10-17.md) section 3 measured that the chat model's projector reads a screenshot's text as well as an OCR pass |
| Walls and budgets | `backend/src/lib/rateLimiter.ts` (one `@maipai/core` token bucket per host, `tryConsume` only); `lib/internetProbe.ts` (DNS plus TCP once a minute, `status.internet_probe.*`); `status_events` and `GET /api/status/apps` (STATUS-SVC-01/02/05) | No daily cap, no remembered wall, no quiet after failures, no foreground and background split |
| Self knowledge | `lib/persona.ts` (identity line from the companion), `lib/composer.ts` (stable prefix), `spec/vocab/capabilities.json` | The model is told who it is, never what the house has installed |
| Notes | `backend/packages/write_document`, `lib/turnMachine/documents.ts` (`attachDocuments`), the `file` record (`origin` sent, made, exported; `kind` document) | Documents attach to a turn and are stored as `file` records; nothing persists a draft between chats |

## 2. Purpose and audience

The job: a person sees what the house can do, an admin adds to it from the one signed catalog, and the model and every page read
the same manifest to say what each package does and what state it is in.

| Viewer | Sees | Does not see |
|---|---|---|
| Owner or admin | Apps page with Installed and Discover, Install, Update, Remove, the permission and data-source diff, the package's state and its one action; Skills with Yours, Discover and Add; integrations connected for the household; package states behind the rail and drawer dots | Any person's notes, chats, connected personal accounts or their credential values (status only, CREDENTIALS.md) |
| Adult member | Installed apps and skills their role allows; Discover as a read-only browse with "Ask an admin to install"; their own notes; their own connected calendar | Install, Remove, Update, channel; anything household-admin |
| Teen | Installed apps and skills with `min_role` teen or lower, Tier 0 only unless an admin enabled a Tier 1 package (O7, K4); own notes | Discover, Add a skill, model and tool controls, any third-party tool by default |
| Child | Installed apps with `min_role: child` on the Apps page; no Skills section (as today); own notes in plain text | Discover, the store, states that name a cause ("needs setup" shows as "not ready yet"), any Tier 1 package (O12) |
| Guest | Apps with `min_role: guest` | Everything else |
| Robot and TV | The robot's package host serves the same state words and the same `capability-summary`; the TV shows installed apps only | Discover, Add, notes, integrations setup |

Rule 0 holds throughout: every list is filtered server side by package `min_role`, the capability allocation (`capabilities.ts`),
smoke status, `platforms`, Incognito and trust tier (K4, O7, O12). Nothing here loosens a child or teen protection.

## 3. Screens and information architecture

**3.1 The Apps page (APPSTORE-DESIGN-01).** It is the existing app library (the shell's Apps destination, `docs/app-library.md`),
not a new app on the rail (S1). Two tabs, kit `Tabs`: **Installed** (everyone) and **Discover** (adults; install controls for
admins). What is taken from the Obsidian community site (`community.obsidian.md`, the plugin search filtered by category): browse
by category, one search field with filter and sort beside it, plain cards (name, one-line description, kind, state), a detail view
with the README as the store card, and the install state on the card. What is not taken: download counts, ratings, author links
off the house, "featured by us" rows, anything that contacts a third party (K7 defers ratings; every install comes from the signed
catalog, never a directory). The capture of the reference, two screenshots at 1440 and 390 opened and judged, is the first build
task of the page slice, not a precondition of this note.

- Controls, left to right: `InputGroup` search; `ToggleGroup` of the manifest's nine categories plus All; `DropdownMenu` filter
  (kind, role floor, "community-made", needs something); `Select` sort (name, newest, recently updated).
- Cards: kit `Card` in a `card_grid` of three on desktop, two on a tablet, one on a phone (UI.md density budgets). Each carries
  `display`, `description`, a kind `Badge`, a "community-made" `Badge` for Tier 1 (PACKAGES.md honesty text), and the state sentence
  from section 4.1 as visible text with its one action as a `Button`.
- Detail: a `Sheet` on wide screens, a full page on a phone, route `<library route>/<package id>`. In order: the state sentence
  and action; the README, drawn by a kit Markdown block added to `@maipai/ui/src/blocks/` first with a `docs/design/UI-DECISIONS.md` row (until it lands, the detail shows the manifest `description` as plain text); "What it needs" (`requires`, `needs`,
  in `capabilityWords`); "What leaves the house" (the `data_sources` rows in the privacy page's words); permissions as the install
  prompt lists them; version, channel, licence, source commit. Install opens an `AlertDialog` with the permission and data-source
  diff in plain words (K2; an update that adds permissions re-sends the 409 diff with `confirmed: true`). Remove shows the
  `uninstall-preview` text ("The following will be uninstalled and users will lose access. Your pictures stay in Library.").
- States: loading, `Skeleton` cards; empty Installed, `Empty` with "Nothing installed beyond the included set yet" and a link to
  Discover for an admin; Discover failed, the kit destructive `Alert`: "Could not reach the catalog. Check the internet under System
  status, then try again."; offline, the last good index with "as of <date>" and Install disabled ("Install needs the internet");
  Incognito on, Discover hides and Installed hides `incognito: "blocked"` packages.

**3.2 The Skills page (SKILLS-PAGE-02).** Stays the Chat settings section `chat.skills` drawn inside the settings shell (S4), so
the page has no title or frame of its own. Layout after Claude's Customize page: `Tabs` **Yours** and **Discover**; `InputGroup`
search; `DropdownMenu` filter (installed, from the catalog, you made; kind) and `Select` sort; an **Add** `DropdownMenu` (adults;
"Upload a skill" opens a `Dialog` with the kit `Input` of type file; "Create a skill" opens a `Dialog` with `Field` rows for name
and description and a `Textarea` for the body). Sections as `ItemGroup`s with a count `Badge`: Included, From the catalog, You
made. Category tiles are `Card`s with a count and "Show all"; Featured and New are one row of `Card`s each with a "Show all"
`Button` that opens the full list only when pressed. A skill's detail is a `Sheet`: name, description, the SKILL.md body, origin,
state sentence. A created or uploaded skill is a household-local `kind: "skill"` package validated against the agentskills.io shape
the catalog's lint applies to `skills/`: no permissions, no recipe, never published (PACKAGES.md). Teens see Yours only; children
have no Skills section, as today.

**3.3 Notes (NOTES-01).** A catalog app (`kind: "app"`, `category: "Utilities"`, `platforms: ["home"]`, `incognito: "blocked"`,
`min_role: child`) at `/apps/notes` through the app kind: `pages/index.json` is a `split_view` of a `list` of the person's notes
and a `detail_pane`; a note is written in a new schema node `text_editor` (section 4.5) that renders the kit `Textarea`. Each note
is a `file` record (`origin: "made"`, `kind: "document"`, media type `text/markdown`) owned by the person, written through the
host's record API, so Library's Files page already lists it and uninstall never touches it (PACKAGES.md). "Attach to chat" opens
`/chat?attach=<file id>`; Chat attaches it through `attachDocuments` on the next turn, so a note reaches the model the way an
uploaded document does today, under the same minor rules, and nothing new enters the context builder. Empty: "No notes yet. Write
one here and attach it to any chat." Offline: fully local. Incognito: the app hides. A child's note is never shown to anyone else.

**3.4 Integrations (PRESENCE-FIND-01).** A flow, not a page. An integration is a catalog package of `kind: "integration"` (Home
Assistant is the exception: its address, token and exposure list stay where the smart-home note puts them): its connect step is
its `setup` flow in its `contributes.settings_area` (S4), its credential a `lib/secrets.ts` record, its consent the `data_sources`
sentence shown before the first request. Three things, in this order:

1. **Static locations ship now, with no plumbing.** "Remember my passport is in the safe" is `remember` and `recall`; the slice is
   one regression test that proves the round trip, nothing else.
2. **Calendar, read only, CalDAV first.** Package `calendar-caldav`: `provides: ["calendar"]`, `exposes.queries: [events_between]`,
   `permissions: ["integration:calendar-caldav"]`, `needs: [{kind: "service", id: "<the person's server host>", required: true}]`,
   `data_sources` one row ("your calendar server receives your login and the date range asked; events come in, nothing else goes
   out"), `offline: "degraded"` (cached events within `cache.stale_ok_s`). The server address and username are settings in its
   area; the password or app-specific password is a write-only secret with status, expiry and revoke (CREDENTIALS.md). A person
   connects their own calendar; an admin may connect one household calendar with audience household. A minor never connects an
   account and sees only the household calendar. CalDAV covers Nextcloud, Radicale, Fastmail and iCloud (app-specific password)
   with no developer console of ours; a Google OAuth package is a later S slice of the same shape.
3. **Live presence through Home Assistant, not Find My.** Apple publishes no Find My API; the only paths are reverse-engineered,
   which THIRD-PARTY-SERVICES.md rules out ("if a service says no, the answer is to ask less, sign in properly, or drop the
   feature"). The honest path is the household's own Home Assistant, whose companion app already reports each phone's location to
   a server the family runs: `exposes.queries: [person_location]` on the existing Home Assistant integration over
   `host.integration.call("home_assistant", "get_state")`, limited to `person.*` entities the admin adds to the smart-home exposure
   list (a `person` kind added to `integration.schema.json`'s `exposed[].kind`, with its `min_role`), never Home Assistant's own
   Assist exposure. Who may ask about whom is Decision 1.

**3.5 RUNTIME-01, SELF-KNOW-01, APP-STATE-01, the wall layer and MEDIA-INT-06** have no screen; their flow is sections 4 and 5.
Every state and error on these pages says the problem in the person's words, then the one next step (STYLE.md); the state
sentences live in section 4.1 and nowhere else.

## 4. Records and settings (spec first)

All additive. Shared shapes land in `commons/spec` with fixtures and a tag, then Home pins, then the robot (principle 3). Every new
record carries id, provenance and the clock stamp.

**4.1 Package states, one vocabulary (APP-STATE-01).** New `spec/vocab/package-state.json`, mirrored on `status-model.json`'s shape
(`state`, `severity`, `tone`, `problem`, copy per audience) with a fixture per state under `spec/fixtures/package-state/`.

| State | Sentence (adult) | Action | Derived from |
|---|---|---|---|
| `ready` | "Ready to use." | Open | `status: "enabled"`, smoke ok, nothing below applies |
| `needs_setup` | "Needs a few details before it can work." | Set up | a `setup` flow or a required `config` key with no value |
| `starting` | "Getting ready. This can take a minute." | none | install or update in progress, or a Tier 1 process warming |
| `needs_package` | "Needs {name} installed first." | Install {name} | `requires` names a capability no installed package `provides` |
| `unsupported` | "Will not run on this computer." | Learn more | `platforms` excludes this host, `min_app` above the hub, or a required engine role the hardware tier cannot run |
| `update_ready` | "An update is ready." | Update | the signed index lists a newer version on the package's channel |
| `problem` | "Something went wrong. Try again, or ask an admin." | Try again | `status: "disabled"` (failed smoke), a revoked version (K3), or a health item on its service |
| `beta` | "Early version. It may change." | none | `channel: "beta"`; combines with any state above as a second badge |

Precedence, worst first: `problem`, `unsupported`, `needs_package`, `needs_setup`, `starting`, `update_ready`, `ready`. A child's
copy never names a cause: `needs_setup`, `needs_package` and `problem` all read "Not ready yet. Ask a grown-up." The sentence is
visible text on every card, row and menu item, never a tooltip alone. One hub function `packageState()` in
`backend/src/lib/packageState.ts` derives it; `GET /api/plugins`, `GET /api/plugins/skills` and `GET /api/apps` gain an additive
`state: {id, sentence, action?}`; `appPresentation.packageState()` is deleted in the same change. The rail and drawer dot reads the
same field through `SidebarMenuBadge` (SVC-06).

**4.2 Typed reads and actions in the manifest (PKG-EXPOSE-01).** Extend `exposes` (never a second block):

| Field | Type | Default | Scope | Meaning |
|---|---|---|---|---|
| `exposes.queries[].min_band` | `child`, `teen`, `adult` | the package's `min_role` band | manifest | Lowest band whose turn may see this read |
| `exposes.actions[]` | list of `{id, description, args, returns, consequence, min_band?, confirm?}` | none | manifest | A typed action other packages or the model may call; `consequence` is T1's `read`, `write`, `physical`; `confirm: true` forces a person's confirmation in every band |
| `provides[]` | existing | | manifest | Unchanged: the capability ids (`calendar`, `home_control`) this package's reads and actions satisfy |

Resolution: `host.integration.call(<package id>, <query or action id>, args)` becomes generic. The host finds the installed package
whose `exposes` names the id, checks the caller's `integration:<id>` permission and the approver cell for the actor's band
(`spec/vocab/permissions.json`), applies `min_band`, Incognito and temporary mode (no `write` or `physical`), runs the target through
the existing `runPlugin()` path and caches by its `cache` block. `searxng` moves behind the same lookup; `home_assistant` keeps the
resolution the [smart-home note](smart-home-2026-10-17.md) defines (HOUSE-04: the entity resolved from the admin's exposure list in
the `integration` record), and the generic lookup delegates to it. An exposed read or action is always `offer: conditional`, never `base`, so the base set stays the ten on the record (rule 1).
Its gate reads only state, never wording: the package is enabled, the person's band meets `min_band`, and the person has
connected the account where one is needed. It reaches the model as one tool named `<package>__<id>`, counts toward the 16 a turn
may carry, and lands with its own CHAT-AB-01 bench row before it is offered; removing the exposure removes the tool on the next conversation (T2 freezes the set per conversation, so the
row's "next turn" reads "next conversation"). No raw SQL, no second device-state store.

**4.3 The wall, budget and probe layer (SERVICE-WALL-01).** The wall, quiet and budget numbers are one spec record,
`spec/vocab/service-wall.json`: a 24 h wall, a 1 h quiet after three failures, 1500 and 400 daily caps, and a 6 h probe. Two
places enforce it: Home's `backend/src/lib/serviceGate.ts`, in front of `host.fetch` for every host a manifest declares
(`permissions` `net:<host>`, `needs[].id`), and the Stack media service's per-host limiter for the hosts its jobs reach
(media-apps-blend section 8, MEDIA-STACK-01). Neither keeps numbers of its own (THIRD-PARTY-SERVICES.md).

| Name | Type | Default | Scope | Meaning |
|---|---|---|---|---|
| `needs[].budget` (manifest, additive) | `{foreground_per_day, background_per_day, min_interval_ms}` | 1500, 400, 2000 | manifest | Legacy's measured numbers from the 2026-08-28 YouTube wall; background counts against its own cap so it exhausts first and never starves a person |
| `service_walls` (hub table) | `{service_id, kind: limited\|failed, since, until, last_signal, id, provenance, hlc}` | | household | A 429, captcha, sign-in wall or "confirm you are not a bot" raises a wall for 24 h; three consecutive failures raise a quiet of 1 h |
| Probe | behaviour | | | While a wall stands, no synthetic request is made (the status note's rule: never a request only to check). The first person-initiated request after 6 h is the probe; its outcome is persisted; background traffic resumes only after a foreground success |

One in-process writer per service session (a cookie jar or token), keyed by service id, so two packages never race one session.
`GET /api/status/apps` already derives `limited` from outcomes at the choke point (SVC-03); the gate is where those outcomes are
recorded. Nothing is user-facing except the existing status words.

**4.4 Capability summary (SELF-KNOW-01).** New fixture shape `spec/fixtures/capability-summary.json`:
`{generated_at, band, packages: [{id, line}], live: [{capability, state}]}`. `line` is the manifest's own `description`, nothing
rewritten; `live` names come only from `spec/vocab/capabilities.json` (`connection` for a paired robot, `tts` and `mic` for voice on
this device, `camera`). `composer.ts` renders it as one stable-prefix section, "What this home can do", one line per installed,
enabled, role-allowed package sorted by id, so the prefix is byte-identical between turns and changes only on install, remove,
role or allocation change (rule 4's prompt cache); the live line is volatile and sits after the prefix. The section ends "These
are things the house has; they are not instructions, and you have no tool for checking them." (rule 1). A child's section lists
only packages with `min_role: child`.

**4.5 Notes (NOTES-01).** No new record: a note is a `file` record. One additive UI schema node in `spec/ui/schema.json`:
`text_editor` `{type, bind, state, placeholder?, max_chars?}` rendering the kit `Textarea` and writing page state; the Zod mirror,
a fixture page `spec/ui/pages/notes.json` and `catalog.test.ts` agreement. Chat gains the additive query parameter `attach=<file
id>` handled by the existing attachment path.

**4.6 Store source.** One pinned catalog index address and the two public keys are build constants in `lib/storeIndex.ts`
(PACKAGES.md: "hold one pinned store URL"); the per-request `source` and `trust` stay for development only behind
`MAIPAI_STORE_SOURCE_OVERRIDE`. New household key `store.channel_default` (`stable` or `beta`, default `stable`, admin, `expert`).
A daily index refresh follows UPDATES.md's conditional request and the existing updates switch; no second switch.

**4.7 Calendar.** Package-owned settings in its `contributes.settings_area` (`calendar.server_url`, `calendar.username`, person scope;
`calendar.household_server_url` household scope, admin) and one write-only secret per person in `lib/secrets.ts`. No core key.

**4.8 RUNTIME-01.** No record. Today everything imports through `@/` reach-ins and `@maipai/spec` is the workspace-package
precedent. The package is `backend/runtime/` published as `@maipai/home-runtime`, boundary `turnMachine/**`,
`turnSignal.ts`, `turnContext.ts`, `hlc.ts`, the guards and output gate, the safety classifier, the memory store and judge, the
scheduler, people, settings and grants, the package host, the link and replica, and the schema UI service. Ports as constructor
inputs: record store, engine supervisors and launch adapter, voice client, package directory, data directory, surface, clock.
Exposed calls: `runTurn`, `streamTurn`, `cancelTurn`, `judgeTick`, `schedulerTick`, `linkApply`, `linkEmit`. The hub is the first
consumer; the robot pins a version and a digest and refuses a path dependency at boot. Starts only after THIN-7D (rule 12).

## 5. Privacy and offline

Nothing leaves the home by default. Every outbound connection here, with what it sends and the setting that governs it:

| Connection | When | Carries | Receiver | Setting |
|---|---|---|---|---|
| Catalog index and `revoked.json` | Discover opened; the daily refresh | A conditional-request header and the user agent; no household data | The catalog host (ours, static, no tracker) | The existing updates switch; Discover is a person's action |
| Package tarball | Install or update | The package path | The catalog host or the pinned upstream (download, don't vendor) | The admin's Install |
| A package's own `data_sources` | As the manifest says | As the manifest's row says | The named host | The package's `opt_in` and the gate in 4.3 |
| CalDAV server | On connect and on a calendar read | Login and the date range asked | The person's own server | Per person connect; revoke in its area |
| Home Assistant | A read or action | The entity id | The household's own instance on the LAN | The one `platform:home-assistant-events` privacy row the smart-home note rewords; presence adds its words there, not a new row |

APP-STATE-01, SELF-KNOW-01, NOTES-01, RUNTIME-01 and MEDIA-INT-06 add no outbound connection. The privacy page gains the catalog and
calendar rows in the same commits that add them (PRIVACY.md).

No network: Installed, Skills, Notes, states and the capability summary read disk; Discover shows the last good index with its date
and no Install; a walled or offline service reads `limited` or "waiting for the internet" from the status model, and a failed read
is a rule 6 failure, never a failed answer. An admin sees package states, counts and health codes; never a person's notes, note titles, attached files, calendar events,
connected-account values or which person used which tool (rule 6a, NO-CROSS-USER-VISIBILITY-01). The capability summary names no
person. Logs carry typed events only (`package.state_changed`, `service.walled`, `store.install`) with a package id and no person.
A backup carries installed-package state and settings (`backup` mode per manifest, PKG-BACKUP-DECL-01), notes as `file` records,
`service_walls` (cold), and credential rows only as the keystore's encrypted blobs, never the key (CREDENTIALS.md).

## 6. Kit Elements and parts

Non-chat surfaces, so the kit's shadcn/ui primitives and the vendored dashboard set only (rule 9b): `Tabs`, `InputGroup`,
`ToggleGroup`, `Select`, `DropdownMenu`, `Card` (with `CardAction` for the state action), `Badge`, `Item`, `ItemGroup`, `Sheet`,
`Dialog`, `AlertDialog`, `Alert`, `Empty`, `Skeleton`, `Pagination`, `Field`, `Input`, `Textarea`, `SidebarMenuBadge`; the
`card_grid`, `list`, `split_view`, `detail_pane` and `empty_state` schema nodes for Notes; the kit Markdown block (a named gap below) for
a README and a note's preview; `MarkdownDocument.tsx` stays a chat and canvas renderer only. No className that changes shape, no wrapper (rule 9).

Named gap: a non-chat Markdown renderer, added to the kit's `src/blocks/` with a UI-DECISIONS row before APPSTORE-DESIGN-01b or
NOTES-01a uses it.

Named gap: a Markdown editor. The kit has `Textarea` and the shadcn registry has no editor. NOTES-01a ships `Textarea`; NOTES-01b
adds an editor to the kit first with a `docs/design/UI-DECISIONS.md` row (candidate: Kibo UI's Tiptap-based Editor, checked for
licence, maintenance and Base UI fit at build time; if it fails, the row says why and `Textarea` stays).

**Reuse check.** Looked at first: the store routes and `storeIndex.ts` (reused, one pinned address added); the signed-index verify
and smoke (reused); `MarkdownDocument.tsx` (not used: it renders the chat Element `MarkdownText`, which rule 9b keeps off non-chat pages); `ChatSkillsSection.tsx` and `GET /api/plugins/skills`
(extended, not replaced); `status-model.json` as the shape of the state vocabulary; `@maipai/core`'s token bucket (kept inside the
gate); `attachDocuments` for note attach; the `file` record for notes; `host.integration.call` (generalised, not duplicated);
Home Assistant's `person` entities for presence; the `model_tool` and T2 filter for exposing reads as tools; the chat Elements
`prompt-library`, `document-reference` and `mcp-server-panel` (not used: chat Elements on a non-chat page break rule 9b, and none
lists packages). For the wall: cockatiel and opossum (both maintained circuit breakers) give an in-process quiet and a half-open
probe but no persisted 24 h wall and no split daily budget; neither is used inside the gate, because the wall and the budgets must
survive a restart and the gate's own state table already holds the half-open rule, so a second in-memory state would be a second
definition. For the calendar: tsdav (MIT, maintained) is the CalDAV client of `calendar-caldav`, never a hand-written one. Hand-built
code is limited to `packageState()`, `serviceGate.ts` and the `text_editor` node, because no shipped part derives a package state,
persists a wall or writes page state from a text box.

## 7. Rule check

- **Rule 0**: every list, state and summary is filtered by role, band, allocation, tier and Incognito server side; the store, Add and
  integrations setup are admin or adult actions; a child's state copy names no cause; a minor never connects an account. No conflict.
- **Rule 1**: exposed reads and actions are tools under T2's filter; the capability summary is prose that says it is not a tool;
  `confirm` on an action is a consent word, which rule 1 permits. No conflict.
- **Rule 4**: the capability section is in the stable prefix sorted by id and changes only on install, remove or role change; the
  live line is volatile and outside the prefix. No conflict.
- **Rule 6 and 6a**: a walled service is a failed tool; states, logs and admin pages carry package ids and counts, never a person.
  No conflict.
- **Rules 7 and 8**: a calendar event, a note and an exposed read's result are data under the minor's floor; nothing is gated on
  a model id and a minor keeps the no-tools fail-safe. No conflict.
- **Rule 9 and 9b**: kit primitives and dashboard parts only; the editor gap is a kit addition with a ledger row first. No conflict.
- **Rule 11**: MEDIA-INT-06 is a measured conflict in today's code, not in this design: `documentExtraction.ts:157` runs RapidOCR
  from Home. Port: delete the spawn and `MAIPAI_RAPIDOCR_COMMAND`; `host.ocr.read` and the scan branch of `extractDocument` call the
  Stack's `vision` role (the chat model's projector, which the vision note measured as reading text as well as OCR); a household
  without vision gets the typed `unavailable` kind, which rule 6 handles. No OCR model is launched by Home, so no rule change.
- **Rules 12 and 13**: RUNTIME-01 starts after THIN-7D and ports before it deletes; SELF-KNOW-01 adds one prefix line per package
  and CHAT-AB-01's adult rows must not get shorter or slower, measured before landing. No conflict if the bench holds.
- **S1, S2, S4, S5**: the Apps page stays the existing library destination; Skills stays a settings section in the kit shell; the
  Notes app is schema pages with no chrome of its own; setting copy comes through `describeSetting`. No conflict.

No NEEDS-RULE-CHANGE.

## 8. Slices

| Id | Size | Order | After | Exit check |
|---|---|---|---|---|
| APP-STATE-01 | S commons, M home | 1 | STATUS-SVC-01 (landed) | One fixture per state; `packageState()` tests per state and band; captures at 1440 and 390 show the sentence as text on the Apps page, Skills and the drawer dot; `appPresentation.packageState` deleted; `bash scripts/check.sh` |
| SERVICE-WALL-01 | M | 2 | the `service-wall` spec record in commons (spec first); MEDIA-STACK-01 reads the same record | `serviceGate.ts` tests: a 429 raises a 24 h wall; three failures raise a quiet; background exhausts before foreground; no request while walled; the first person request after 6 h is the probe; `check.sh --pre` plus `backend/tests/serviceGate.test.ts` |
| APPSTORE-DESIGN-01 | S design (this note), then M build: 01a the pinned source, `GET /api/store/browse`, update check; 01b the Apps page | 3 | APP-STATE-01, K7.1 and K7.2 (signing, O14) | Reference captures opened and judged; with a fixture index: browse, filter, sort, detail, install with the diff dialog, update, remove with preview; offline shows the last index; a child never sees Discover; `lint:ui-rules` clean; captures at 1440 and 390 in both themes; full `check.sh` (install is a risky surface) |
| SKILLS-PAGE-02 | M: 02a Yours (tabs, search, filter, sort, sections, detail), 02b Discover and Add (upload, create, lint) | 4 | APP-STATE-01; 02b after 01a | A created skill validates against the agentskills.io shape and appears under You made; an invalid upload says what is wrong and what to fix; a teen sees Yours only, a child nothing; captures judged; `check.sh --pre` plus the section's tests |
| PKG-EXPOSE-01 | M | 5 | T1 and T2 of the tools note | Shared manifest fixtures with `exposes.actions`; host permission tests: an unexposed read never reaches a tool, a removed exposure is gone in the next conversation, a `physical` action confirms in every band, a child never sees a `min_band: adult` read; its bench row recorded; `check.sh` |
| SELF-KNOW-01 | S | 6 | COMP-03 | Three-package fixture yields three lines and nothing else; remove one, the line is gone next turn; the child band omits an adult package; the prefix is byte-identical across two turns; CHAT-AB-01 adult rows unchanged; `check.sh` |
| NOTES-01 | M: 01a the app on `Textarea` and attach; 01b the editor part | 7 | APP-KIND-01 to 04 | A note is a `file` record the Files page lists; attach sends it through `attachDocuments`; Incognito hides the app; uninstall keeps notes; a child's note is invisible to an admin; `catalog` check then `check.sh` |
| PRESENCE-FIND-01: 01a the static-location test (S), 01b `calendar-caldav` (M), 01c presence through Home Assistant (S) | S, M, S | 8 | PRESENCE-FIND-01b after SERVICE-WALL-01 and PKG-EXPOSE-01; PRESENCE-FIND-01c after Decision 1 | PRESENCE-FIND-01a: remember and recall round-trip test. PRESENCE-FIND-01b: connect against a fixture CalDAV server, credential stored encrypted with status and revoke, `events_between` reaches the model as a tool for an adult and not a child, its bench row recorded, offline serves cached events with "as of"; privacy row added. PRESENCE-FIND-01c: a `person.*` read limited to exposed entities; the asking rule from Decision 1 tested per band; `check.sh` |
| MEDIA-INT-06 | S | any time | the Stack's vision role on the Studio | The spawn and the env var are gone; `host.ocr.read` and a scanned image through `extractDocument` return text from the vision role on the Studio and the typed `unavailable` kind without it; `backend/tests/documentExtraction.test.ts` re-pointed; `check.sh` |
| RUNTIME-01 | L | last | THIN-7D | The hub boots and passes its suite through the package API with no `@/` import into the package; the package's tests run with fakes on every port; a path dependency is refused at boot; the API is in `docs/dev/`; full `check.sh` |

## 9. Legacy verdicts

The legacy mirror (`legacy-backups/home-legacy.git`) is absent from this checkout; verdicts rest on what the backlog rows record.

- `quiet.ts`, `accessMonitor.ts`, `sessionKeeper.ts` (the YouTube wall trio): **merged into `serviceGate.ts`**; the measured
  numbers (24 h wall, 1500 and 400 daily caps, a 6 h probe, a quiet after three failures, one writer per session) are copied, the
  per-service code is not.
- Linked accounts with an OAuth refresh token in plaintext (CREDENTIALS.md, found 2026-08-29): **redesigned** as per-person
  write-only secrets with status, expiry and revoke.
- Legacy media and playback integrations: **dropped** here (the metadata half keeps its backlog row). Nothing else borrowed.

## 10. Supersedes

- The media apps blend note's quiet mode for Stack media jobs ("four failures, 30 minutes", section 8 and MEDIA-STACK-01):
  replaced by the shared `service-wall` record in 4.3, so the Stack limiter and Home's gate apply the same wall, quiet, budget
  and probe.
- APPSTORE-DESIGN-01's output location ("a design note in `data-scratch/design/` saved as APPSTORE-DESIGN.md"): this note is the
  design note; the reference captures become the page slice's first task.
- NOTES-01's "an assistant-ui Elements-shaped editor": a notes page is a non-chat surface, so it is the kit `Textarea` and, after a
  ledger row, an editor primitive (rule 9b); "a hook into the existing memory/context-attach mechanism" is `attachDocuments`.
- PRESENCE-FIND-01's iCloud and Find My path: replaced by presence through Home Assistant, pending Decision 1; the static half ships first
  as the row already said.
- `appPresentation.packageState()`'s two words and `routes/plugins.ts`'s "disabled (failed its last smoke test)" as user copy: the
  state vocabulary of 4.1.
- The store routes' per-request `source` and `trust` as the production path: a pinned address and keys, override for development
  only. Nothing in RULES.md, the tools-ecosystem note, the app-kind note or the status note, which this note extends.
- The smart-home note's HOUSE-04 resolution path: unchanged; this note's generic lookup delegates `home_assistant` to it, and
  PRESENCE-FIND-01c adds a `person` kind to its exposure list.

## 11. Decisions for Jesse

1. Who may ask where a person is (PRESENCE-FIND-01c). Recommendation: a parent or admin may ask about a child only; a teen's or adult's
   location is theirs and shows to another person only when they share it from their own profile. The alternative is no presence
   at all.
2. Find My: drop it, as recommended (no supported API; reverse-engineered access breaks THIRD-PARTY-SERVICES.md), or commission a
   feasibility and terms check before any code.
3. The real catalog index address and the root key custody (O14, open since 2026-10-03): Discover shows only the bundled set until
   they exist. Recommendation: cut the keys this week so APPSTORE-DESIGN-01a can land with a live index.
4. MEDIA-INT-06: OCR is the Stack's vision role and Home launches no OCR model, as recommended, or the Stack gains its own `ocr`
   role for scanned documents on a hub without vision (a Stack release question).

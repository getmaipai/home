# Catalog holds the data, the Stack acts, Home knows people: parts, units, one budget (2026-11-16)

Status: proposed, needs an architect verdict. Owner decisions (Jesse, 2026-11-16, in chat; his words are the record, spelling tidied):

- "home really should just know category (ex. image) and model, description, and priority (ex 1)", later adding "enabled/disabled status".
- "the stack contains the rest of the data on the models like metadata including url, sha"; "install uninstall are calls to the stack".
- "the stack can have an updater that checks for new versions and flags if one is available where home can query the stack to know and show an indicator and an upgrade button that calls for the stack to update"; "it should be responsible for the queue management, memory management ... and the sizing"; "is the stack healthy, is the stack busy, what's consuming the stack, what errors does the stack have".
- "no wan"; and, on removing the sound from children's clips, that it is not a proper fix: "lets backlog how to solve this properly".
- "dont keep legacy names, code, tables, etc for ease of migration - do this right".
- "50% of a mac studio 128gb is no different than a mac studio 64gb"; "why are we doing fixed machine classes. is that wise vs dynamic?"
- "how can we build this so pieces are just upgradeable units that can work in and out of maipai and be upgraded, can be maintained by someone else for use in their system. but we also want this to be performant" (his example: PowerShell commandlets that are registered, upgraded and called by a core script).
- Answered in the question box the same day: a hard rule in `RULES.md` (yes); a Stack that runs with no Home (yes, small, after Home conforms); outside apps drawing their own web screens (no, our cards only).

Evidence, the audit with file and line, and the full plan: [reports/stack-vs-home-model-data-review-2026-11-16.md](../reports/stack-vs-home-model-data-review-2026-11-16.md) and [reports/portable-apps-and-catalog-review-2026-11-16.md](../reports/portable-apps-and-catalog-review-2026-11-16.md).

## Supersedes

- [model-choice-2026-11-16.md](model-choice-2026-11-16.md) section 1 ("The pair is data in the package (the engine catalog the Stack serves)") and section 4 ("the picture status lists the installed families with a `role` of primary or secondary"): the pair is priority 1 and 2 of the parts list in section 3 below, and the data lives in the Catalog. Section 5 row 2 (MODEL-PAIR-01) is replaced by the PARTS rows below; OPTION-NAMES-02 as a Home-side name map is dropped (names arrive from the Stack). Section 6 ("The default lives in the engine catalog"): the default is the `priority` field. Sections 2 and 3 (the Make with chip, the retry order) stand and read the parts list.
- [h3-tier-slots-2026-11-16.md](h3-tier-slots-2026-11-16.md): its tier tables stand as measured peaks; where it writes them into `TIER_CANDIDATES` with machine classes, read "the part's `peaks` and `builds`" (section 2 below). H3-SLOTS-STACK-01 and H3-SLOTS-HOME-01 are re-read against this note before dispatch.
- [resource-tiers-2026-10-27.md](resource-tiers-2026-10-27.md) line 114 ("The model names stay under Details, as today") and every place it sizes by `p16`, `p32`, `p64` or `p128`: names come from the Stack per audience; sizing is the one budget of section 5. The tier ladder (Reduced, Standard, Boost, Max) and its shares stand.
- [video-tiers-2026-11-02.md](video-tiers-2026-11-02.md) decision 1 ("Minors keep the silent Wan Quick lane ... until VIDEO-LTX-06"): unchanged in order, restated as the plan of section 8. Nothing about a child's or teen's protection is loosened by this note.
- [video-tiers-2026-11-02.md](video-tiers-2026-11-02.md) decision 3, where Wan stays as the speed floor to compare against, and VIDEO-TIERS-01's "an adult's Standard falls back to Wan Quick until the licence is accepted": Wan is in no adult path (VIDEO-WAN-HIDE-01); an adult with no accepted licence gets the plain line and the accept step, not another model.
- [memory-management-2026-10-25.md](memory-management-2026-10-25.md) Q2 to Q5 and Q7 (class order, round robin by person, backfill, aging, no cap on the line): the policy stands in full. What changes is where it runs: Home turns Q2, Q3 and Q5 into the priority and group it sends, and the Stack's queue applies them with Q4 and the start rule of Q6; Q7 (no cap on the line) holds in both queues; Home's re-queue of a stopped job (Q6, R15) stays (section 6).
- [resource-profiles-2026-10-30.md](resource-profiles-2026-10-30.md) section 3b ("Live fit: the table is the wish, memory decides") and [resource-management.md](resource-management.md) R12 ("Home's live fit reads its hardware table from the Stack"): the live fit ladder stands and runs in the Stack; Home's copy and its hardware table are deleted (HOME-MEMORY-REMOVE-01).
- [making-space-2026-10-30.md](making-space-2026-10-30.md) and [auto-close-apps-2026-10-30.md](auto-close-apps-2026-10-30.md), where Home closes apps to make room: the same steps, the same settings and the same counts-only reporting (rule 6a), run by the Stack on the computer it is on (JOBS-PRIORITY-01). MEM-SPACE-07 is re-read against this before dispatch.
- The Stack's own records that say it "installs only through Home", and the org product table's "Home is its only caller" (in `getmaipai/.github`, outside this rulebook): both are amended when STACK-ALONE-02 lands, by section 10. Until then they stand.

## Reuse check

Everything named here exists and is extended, not rebuilt: the Catalog's signed index and its `models/index.json` and `engines/index.json`; the Stack's job queue (`lib/jobs.ts`), governor and admission (`lib/governor.ts`, `lib/admission.ts`), memory watchdog, health items with fixes (`routes/health.ts`), event feed, engine updates with rollback and the model update check (`routes/updates.ts`, `updates/catalog.ts`), components list (`lib/components.ts`), tier resolver and shares (`lib/tiers.ts`); the spec's Stack wire shapes (`commons/spec/stack/`); Home's Stack client, household settings store, tier slots (`lib/tiers.ts`), household queue scoring (`lib/jobs/jobScore.ts`), AI and models cards and the setup wizard; Home's package host, which already runs code packages as MCP servers (`lib/denoHost.ts`), and its unused general MCP client (`lib/mcp/connector.ts`). What is new: one record (`part`), one list route, one choices setting, one budget setting, and the deletion of every copy beside them.

## 1. The line

| Owner | Owns | Never holds |
|---|---|---|
| Catalog | Signed data: every installable part and every package | Running state, household choices |
| Stack | Every action and runtime fact: install, uninstall, update, enable, what fits, what is loaded, what runs or waits, what is wrong, the budget | People, age, households, wording for people |
| Home | People, the age and surface gates, the household's choices, wording, notifications, drawing what the Stack serves | Model names, descriptions, download links, checksums, sizes, fit math, engine processes, the Stack's health logic |

The Stack has no users. Home sends the audience (`adult` or `minor`) with every read and every job, and the Stack enforces it. The age and surface gates (rule 0) run in Home before anything reaches the Stack.

## 2. A part

A part is anything the Stack installs and runs: a model, a tool (a sharpener, a stem splitter, a wake word), or an engine (the chat engine, a picture runner). One record in `commons/spec`, one source file in the Catalog (`parts/index.json`), one signed published index. The Stack pins a Catalog tag at build, so a new install works offline, and reads a newer signed index only when update checks are on.

The record (`StackPart`, PARTS-SPEC-01): `id` (opaque), `kind` (model, tool, engine), `category`, `priority` (the shipped order, 1 first), `label` (true name, adults only), `neutral_label` (what a child or teen is served), `description`, `adult_only`, `version`, `files` (link, sha256, bytes), `licence` (name and notice id, never the text), `runner` (the engine part that runs it), `requires`, `builds` (tier steps), `peaks` (measured memory per option set, each marked measured or unverified), `min_stack`. A chat model's part also carries what chat rules 3 and 8 need: its sampling with the source of the values named, the template features it is proven to support, and its measured record (PARTS-SPEC-02). Home reads these from the Stack for each turn; a model with no measured record keeps the no-tools fail-safe for minors, exactly as rule 8 says today.

No machine class is in the record. No field says what any household prefers.

## 3. What Home reads and sends

One list, `GET /stack/v1/parts?audience=&kind=&category=`. A row carries: id, kind, category, priority, label, description, enabled, state, size, download size, progress, whether it fits each tier and why not, whether it can be installed or removed and why not, whether a licence must be accepted, what requires it, and whether an update is available. A minor's list has neutral labels, no descriptions and no adult-only rows, so a name cannot leak through a Home defect.

Actions, all by id: install, uninstall, update, roll back. The caller never supplies a link or a checksum. Generation routes take an optional `part` id and the audience; with no `part`, the Stack uses the first enabled part in the household's order, then the shipped priority. A minor's job is different: the Stack runs it only on a part that is in the minor's list, and it never falls back to the household's order. A part whose output can carry speech that is not yet checked is `adult_only`, so it is in no minor's list, until its check ships.

This list replaces the Stack's separate lists of models, the model catalog, components, tier candidates, capabilities and the install plan.

## 4. The household's choice: one store

Home's household settings hold one value per category: an order and an off list, both empty by default. Empty means the shipped priority with everything on. Priority 1 is the Primary and priority 2 is the Secondary; "try the other model" and the word-check retry of rule W4 use priority 2. Home pushes the value to the Stack; the Stack stores no household. An engine has no switch: the Stack turns it on when an enabled part requires it. Nothing about any household is written into a repo, a default or a migration.

## 5. Sizing: one budget, no machine classes

One setting, the share of this computer the Stack may use (1 to 100 percent), shown to people as a slider in plain words with no memory figures. The Stack turns it into a byte budget, limited by the hardware ceiling. Equal budgets give equal fit answers on any computer.

Three things that depend on the machine class today come from the budget instead: which parts can ever run (the part's peak against the tier's share of the budget; the shares 0.6, 0.85 and 1.0 stand), what stays loaded and what loads on demand (required parts in priority order until the resident share is full), and the working margin (a continuous function of the budget). A second, live check stays at job start. A preview route returns the consequence in plain lines before the person saves. Speed is served from timings measured on this computer, separately from fit.

## 6. Jobs, memory and the queue

The Stack decides whether and when a job can run. Home decides whose job goes first. A job submit gains a `priority` number and an opaque `group`; the Stack orders by priority, then age, with a fair share across groups. Home computes the priority from household policy and a child's daily limit and passes a hashed person id as the group. The priority keeps memory-management Q2 (chat, then pictures, then video, then the rest), Q3 (by person), Q5 (aging) and Q7 (no cap on the line); the Stack applies Q4 (backfill) and the start rule of Q6, and JOBS-PRIORITY-01 builds whatever part of them its queue lacks; Home's re-queue of a stopped job stays in Home. Home's own fit, memory and app-closing code is deleted; its queue code keeps the scoring and the mirror of Stack job states.

## 7. Status

One read, `GET /stack/v1/status`: health (ok, degraded, down, updating), running and waiting counts, what holds memory, pressure, the jobs, and a problems list with a plain cause and a fix for each (rule S6). Home draws it. Home keeps health logic only for its own database, its own jobs and the link to the Stack. Every status surface of rule S6 stays, with the same words in the same places; only where its data comes from changes. The S6 table names files as data sources, so the row that moves them (HOME-STATUS-01) edits that table in its own commit with `Owner-approved`.

## 8. Video without Wan

Wan is removed. Children and teens are on it today because the finished-clip check looks and does not listen, and LTX-2.5 can speak. The proper fix is VIDEO-LTX-06 (transcribe the clip's sound and run the words through the child and teen line). Order, by rule 12: Wan is hidden from every adult list now; VIDEO-LTX-06 ships; children and teens move to LTX-2.5 with the audio check; then Wan is deleted. Until then the children's and teens' lane is exactly as it is: Wan stays installed and installable for a household with a child or a teen, LTX-2.5 is `adult_only`, and the Stack refuses a minor's clip on any other part. Home's own lane check (`videoModelForLane`) is not removed before the Stack enforces the minor's list (the video slice of HOME-PARTS-04 waits for that). No silent workaround is built.

## 9. Units: pieces that work in and out of MaiPai

A unit is a piece someone can build, version, publish, and upgrade on its own, and that works in another system as well as in ours. The core never calls an implementation by name. It calls a role or a command, and the Catalog entry says which installed unit answers it. Two units that answer the same role are priority 1 and 2, so swapping is changing the order.

| Kind of unit | Example | Contract | How it is called | Cost per call |
|---|---|---|---|---|
| Tool | astronomy lookups | a plain MCP server: named commands with typed input and output | per request, to a warm process | milliseconds |
| Part | a model, a voice | the part record of section 2 | loaded by its runner | none of its own |
| Component | a voice loop (it holds no model) | a role contract: a streaming wire plus the hooks the host fills | one long-running process on loopback | none per request |

Every unit, whatever its kind, has the same life: a manifest with an id, a version and what it provides and requires; files pinned by checksum; listed in the signed Catalog index; installed, updated and rolled back by id; replaced without the caller changing.

Speed rules, because a boundary in the wrong place is slow:
1. Processes stay warm. Nothing on a person's path starts a process per call.
2. The boundary goes around a whole hot loop, never through it. A voice loop is one unit with one hook (`respond`), not five services passing 20 ms audio slices.
3. Streams and binary frames on loopback for audio and tokens; JSON only at the edges.
4. Every role contract carries a timing budget and a bench. A unit is signed only when it passes the contract test and the bench on our hardware (rule 13).
5. A unit we wrote in TypeScript may also be imported directly by a TypeScript host with the same contract, with no process between. A unit we did not write always runs in its own process with no network and its own folder.

Rule 11 stands: only our own tested Stack components run the models. An outside author supplies tools and components that hold no model and run none; a component asks the Stack for a model by role. A runner is always ours. Adopting an outside runner would need the owner to change rule 11, and this note does not propose it.

An outside author conforms to the open contract (MCP for tools, the role contract for components), not to MaiPai. The MaiPai side (the age floor, privacy rows, allowed hosts, how a result is drawn) is an entry we write and sign in the Catalog. Outside tools stay off for children and teens by default, as decided on 2026-11-06. Outside units draw nothing of their own: results are shown with our answer blocks and pages (rules 9 and 9b).

The portable app and voice loop designs, their gaps and their briefs are in the second report; they get their own note and architect verdict before any build (PORTABLE-01).

## 10. A Stack with no Home

After Home conforms, the Stack can run alone: its own keys with scopes in place of Home's single token, a command line that makes the calls Home makes, a network bind that is off by default and needs a key, its own installer and updater, and the CSAM block inside the Stack because a stand-alone run has no age gates. It stays without an interface.

## 11. Clean break

Each row deletes what it replaces in the same landing. No alias lists, no "new key, else old key", no branch for an older Stack, no legacy table. Old setting keys are removed by one migration that writes no household value. Ids that name files already on disk stay, because they are opaque keys. A stored id that no longer exists is not found, and the default applies. Home and the Stack ship as a pair, so a landing that removes a route lands with the caller's change.

## 12. Build rows

Spec, then Catalog, then Stack, then Home, then Bot. Each row is small, has an exit check that can fail, and is in `docs/BACKLOG.md` under "Catalog data, Stack actions, Home people". Rows: PARTS-SPEC-01, PARTS-SPEC-02, PARTS-CATALOG-01, PARTS-STACK-01, PARTS-API-01, PARTS-ENABLE-01, PARTS-UPDATE-01, STACK-STATUS-01, VIDEO-WAN-HIDE-01, VIDEO-LTX-06 (existing), VIDEO-WAN-REMOVE-01, BUDGET-01, BUDGET-02, BUDGET-03, HOME-PARTS-01 to HOME-PARTS-05, JOBS-PRIORITY-01, HOME-MEMORY-REMOVE-01, HOME-STATUS-01, BOT-PARTS-01, STACK-ALONE-01 to STACK-ALONE-04, PORTABLE-01, then the existing MODEL-WITH-01 and MODEL-RETRY-01.

The riskiest rows and their guards: BUDGET-02 (a parity test against today's plan at five memory sizes, and two real runs); PARTS-STACK-01 (every link, checksum and byte count equal to today's pins); VIDEO-LTX-06 and VIDEO-WAN-REMOVE-01 (risky surface, real clips).

# Companions: many per person, one shared chat, presence across the app (2026-10-24)
> Status (2026-10-31): superseded in part by [companion-three-screens-2026-10-28.md](companion-three-screens-2026-10-28.md): the four-tab editor and four-tab detail.

> **Superseded in part (Jesse, 2026-10-26, [companions-handoff-revamp-2026-10-26.md](companions-handoff-revamp-2026-10-26.md) sections 3 and 6):** every reply carries a 28px face (not a marker only on change), and decision 13.6 is reversed: each reply's portrait is kept per look version. The rest stands.

Owner's request (Jesse, 2026-10-24): review the product spec "MaiPai Companions: Product and UX Design Specification" (746 lines,
with nine reference images: a Character.AI-style persona grid, a header companion selector, an agentic task card, a new chat with a
companion, a companion detail page with Activity / About / Tasks / Chats, a Yours / Discover grid with state badges, a two-step
"Create a Companion" wizard, a page with a collapsible floating assistant, and a one-question `@mention` switch) and come back with a
design, no code. The plan must shell every new surface with "coming soon" placeholders first, so he can see and steer the look and
feel before anyone spends time on the real build. Added the same day: the true agentic layer (a companion shopping online, reading
and replying to email, acting on its own) waits; it is a larger design of its own and appears here only as coming-soon shells.

This is the design record COMPANIONS-MULTI-01 asks for (`docs/BACKLOG.md`). It needs an architect verdict before any slice is built.
Spec concepts are quoted by section number ("spec 6"). Example companions use the bundled set already in the repo (MaiPai, Nova,
Riff, Rivet, Sprout, Buddy, Pal, The Tutor); the spec's Milo, Ada and Fin are not roster names and never appear in copy or data.

## Answer

1. **Adopt the spec's model: one conversation, many speakers.** A conversation keeps one id for life. The person switches the
   active companion from the chat header, or borrows another companion for one turn with `@name`. Nothing forks and no system
   message is written; the next reply simply comes from the new speaker and says so once. "Branch in new chat" (already built,
   gap matrix A7) is the only way to get a second conversation.
2. **Two records change, both additive, spec first.** `conversations.companion_id` (already there, never read) becomes the
   per-thread pick. Each turn gains an `answered_by` snapshot (companion id, name, look stamp, how it was picked) so
   attribution survives a rename or a removal. Both are spec records (SPEC-01), so commons/spec changes first. `persona.active_id` keeps its one meaning: my default for a new conversation.
   COMP-04's `companions.enabled` (person scope) is "the companions I hold"; nothing new is invented for Yours.
3. **The Companions app grows two tabs and a detail with four tabs.** Yours is today's CardGrid plus the person's own latest
   activity line and two counts; a job's state stays on the job's own card (S6). Discover is a grid of companions the person does not hold yet, in the look of the first
   reference image. Detail gets Activity / About / Tasks / Chats; About contains the existing companion information.
4. **Creation is a two-step kit Wizard** (template, then name and look) that lands in the existing editor. Templates are
   personality starting points, never free-form system prompts or model picks (rules 1, 8 and 14).
5. **Presence is one controller, two placements.** The chat corner avatar stays. Jesse chose the spec's floating launcher on
   non-chat areas and edited S2 for it on 2026-10-24; it lands in commons first (rule 9c), so phase 0 shows it as a scripted
   HTML mockup (section 7).
6. **Tasks ride what exists.** Spec 7's task states map onto jobs, projects, the scheduler and the designed `Ask` record; there is
   no second task system. The agentic tooling itself (shopping, email, acting alone) is a later design (AGENTIC-DESIGN-01) and
   shows only as shells here.
7. **Memory stays one store, split by kind of fact (COMP-05).** Facts about the person are shared by every companion; rapport
   (a running joke, how a companion addresses you) is a person-scope record with a `companion_id` qualifier, read only by that
   companion. Conversation context is what the turn already has (section 8).
8. **Phase 0 is shells.** Seven in-app surfaces behind one per-person switch only an admin may turn on, each a kit EmptyState or
   a disabled kit Element with one plain sentence of "coming soon" copy, plus one HTML mockup for the two surfaces the rules keep
   out of the app for now, the who-answered marker and the launcher (section 10).
   Nothing in phase 0 writes a record.

## 1. What the spec asks for against what exists

| Spec | Asks for | Home today | Gap |
|---|---|---|---|
| 3, 4 | Companion / Conversation / Presence; one conversation id; switch or `@mention` never forks | `conversations.companion_id` exists but the turn reads `persona.active_id` only (`turnNext.ts:532`); frontend never sends it | Per-thread pick, header selector, speaker snapshot |
| 4.3 | One-turn guest `@mention` | No `@` support in the composer; kit ships `ComposerMentions` and `ComposerTriggerPopover` | Wire the Element to the person's companion list; one-turn routing |
| 4.5 | Speaker attribution on every assistant message | `conversation_turns` has no companion column; no per-message label | Additive `answered_by` field; a change marker in the thread |
| 5 | Standard MaiPai always available | The `default` companion ("MaiPai") is a bundled companion and the fallback (`DEFAULT_PERSONA`) | None; it is the first entry of every selector |
| 6, 7 | Inline task cards; work types; ten task states; approvals | jobs, projects (xstate), `scheduled_jobs`, approvals (two kinds), `Ask` designed; kit `TaskCard`, `AgentStatus`, `BackgroundInbox`, `ApprovalCard` | Companion id on jobs and projects; the agentic tooling itself (deferred) |
| 8 | Three memory layers; least privilege | `memory_records` scopes self / person / household; no companion partition | Provenance only (section 8) |
| 9 | Presence Controller; floating launcher; bottom sheet on phone | `useCompanionPresence` in Chat; corner `CompanionAvatar` with Hide; kit `LauncherBubble`; `InstallDock` is the shell's only fixed element | Lift the controller; launcher allowed by S2 since 2026-10-24, commons first |
| 10 | Two-step wizard, six templates, Advanced (instructions, model, tools, memory policy) | `/companions/new` opens the editor directly; kit `Wizard` primitive | Wizard; templates as dial presets; Advanced trimmed by rules |
| 11 | Yours cards (video, state, latest activity, counts, Open / New chat / Review); Discover entries with Add | One CardGrid of every ready companion the person may use | Two tabs; latest activity and counts (state stays on the job card, S6); a source for Discover |
| 11.3 | Detail tabs Activity / About / Tasks / Chats | Detail page; editor with Identity / Voice and style / Look / States | Four tabs; Chats is a filtered conversation list |
| 12 | Empty states | Kit `EmptyState` primitive and Elements; copy pattern "is not built yet" in `ChatSkillsSection.tsx` | Copy per surface (section 10) |
| 13 | Explicit branch only | "Branch in new chat" menu item built (A7) | None |

## 2. Conflicts with rules and prior decisions, and how this note resolves them

| Spec passage | Conflicts with | Resolution |
|---|---|---|
| Companion names Milo, Ada, Fin | PII and roster rule (org CLAUDE.md) | Bundled names in every example and shell |
| Advanced: custom instructions | Rule 1 (model decides, no word rules), rule 14 (companion voice is a mechanism, never prompt prose), video note | Not offered. A companion is dials, examples, interests and a backstory from the manifest `companion` block; the editor already exposes them |
| Advanced: preferred model per companion | Rule 8 (a minor never chooses a model); one model setting per person today | Not in this design. Listed as an owner question; if wanted, adults only, as a per-companion override of the existing chat model key |
| Templates Finance, Health | Assistant-layer non-goals (finance, health feeds) | Replaced by Chat buddy, Research, Shopping (coming soon), Homework helper, Storyteller, Custom. Owner question whether Finance or Health returns |
| Companion states success, error, returning | The twelve shipped video states | success is `celebrate`, error is `oops`, returning is `greeting`; no new states |
| Ten task states and a Tasks tab | Principle 1 (one definition); S6 (no new status UI); jobs, projects, scheduler, `Ask` already defined | Mapping in section 6; the Tasks tab lists existing records, it defines none |
| Floating launcher on every page | S2 as it stood ("only the rail is ours"); S6 if it carries a count or state | Resolved by Jesse's S2 edit of 2026-10-24: allowed on non-chat areas, no count or status; commons first, an HTML mockup in phase 0 (section 7) |
| Companion-private memory | Principle 1; memory note (scopes self / person / household; rule 6a) | Provenance, not partition (section 8) |
| Companions for children | Memory ruling 2026-10-14: companions on by default for every profile; rule 0 | Children switch only among `companionFits` companions; no tasks, no Discover Add without an adult, no model choice |
| "Needs approval" and "Working" card badges | S6 as it stood (a job's state lives on the job's own card and the Ask); owner note 2026-10-24: the agentic layer waits | Resolved by Jesse's S6 row of 2026-10-24: one own-jobs summary line per card, nothing more (section 4); a card links to its Tasks tab; AGENTIC-DESIGN-01 for the tooling |

## 3. One conversation, many speakers (spec 3 to 5, 13)

**Vocabulary (one definition).** A *companion* is a manifest `companion` block or a household companion (unchanged). The *standard
MaiPai* of the spec is the bundled `default` companion, display name "MaiPai"; it is always the first entry and the fallback.
A *conversation* is the existing record. *Presence* is where the companion is drawn (section 7).

**The per-thread pick.** `conversations.companion_id` is already in the spec (`conversation.schema.json`); only its description
changes: the conversation's active companion, set at creation from `persona.active_id` (or from the companion the person started
the chat from) and changed by a header switch. A switch is `PATCH /api/conversations/:id { companion_id }`, which bumps `hlc` and
`updated_at` (principle 3 is already met by the record's id, `source` and `hlc`) and refuses an id that does not fit the person
(a 400; POST gains the same check, which it lacks today). `persona.active_id` is untouched: one writer, one meaning, my default for
the next new conversation (COMP-04, the companions brief: "switching never changes the conversation or what the hub knows; it
changes who is talking").

**The pick order in the turn** (`turnNext.ts:532`), `companionFits` on every pick, every turn (rule 0, COMP-04):

1. the robot's assigned companion (`via: "device"`);
2. otherwise a temporary chat, a bare turn or companions turned off gives MaiPai (`via: "fallback"`);
3. otherwise the turn's `@mention` (`via: "mention"`);
4. otherwise `conversation.companion_id` (`via: "conversation"`);
5. otherwise `ownPersona` (today's path). A pick that does not fit gives MaiPai with `via: "fallback"`, the reason COMP-04 asks to record.

`GET /api/companions/avatar` takes the conversation id so the corner character follows a switch.

**Switching (spec 4.2).** The header gains a companion control next to the title in `ChatHeaderBar`: the companion's still poster
and name, opening the kit `DropdownMenu` the header already uses, listing MaiPai first, then the companions the person holds
(`companions.enabled`, filtered by `companionFits`), each with its poster, name and tagline, and a last item "Manage companions"
to `/companions`. Choosing one sends the PATCH and shows one toast "Now chatting with Nova" through a `toast` re-export from the kit's
`ui/sonner.tsx` (rule 9b forbids a direct `sonner` import; the 28 existing direct imports are debt, not permission, and the re-export
is the first commons step of COMP-04a). `chatHeaderBar.tsx` imports no toast today, so the phase 0 shells raise theirs from a handler
in a file that already toasts (`ChatPage.tsx`), adding no import; a new kit tag for the re-export waits for Jesse's yes. A toast is action feedback,
not system status, so S6 is untouched. The thread is not touched. The next assistant message carries the new speaker, and the corner avatar swaps to the
new companion's clips at the next loop point.

**Guest turn (spec 4.3).** Typing `@` in the composer opens the kit `ComposerMentions` popover with the same list. A chosen mention
is a chip in the composer; the turn request carries the companion id for that one turn, resolved through the same gates (step 3
above). The conversation's `companion_id` does not change, so the next turn resumes the active companion with no extra state.
If the companion does not fit the person's type it is not listed; a hand-typed `@name` that matches nothing is plain text
(rule 1: no word rules; the chip is the only trigger).

**Who answered (spec 4.5).** `ConversationTurn` gains one optional property, `answered_by` (null for a bare turn or an old row),
spec first in `conversation-turn.schema.json`, stored as one JSON column like `signal` and `plan`:

| Field | Meaning |
|---|---|
| `companion_id` | the persona id; `default` is MaiPai itself, so no separate "MaiPai or companion" kind (principle 4) |
| `name` | the `display_name` at the moment of the turn |
| `look` | the approved animation version stamp the avatar route already computes, or null |
| `via` | `conversation`, `mention`, `device` or `fallback` |

The name is `answered_by`, not `speaker`, because `speaker_evidence` already means the person who spoke. A rename or removal later
leaves history as it was; a removed companion's turns keep the saved name with a plain mark, not the old picture (a still per look
version after deletion would be a new store; owner question in section 13). The thread shows a marker only when the answerer
differs from the previous assistant message, or when `via` is `mention` ("Nova joined for one question"). The kit offers no
avatar slot on the assistant message, and a Home component in the `MessageBefore` slot would be a wrapper (rule 9b; the
`THREAD_SLOTS` fillers are not in rule 9's bindings exception, and ELEMENTS-LINT-03 flags them), so the marker is a kit change
first (rule 9c): the kit Thread draws a `SpeakerMarker` (poster, name, optional "joined for one question") itself from the
message's metadata (`metadata.custom.answered_by`) through an additive prop, and Home passes only the data and the copy. No Home
slot component, no `DayDivider` reuse (`chatDateDivider.tsx` is a baselined wrapper, debt and not a model). Home's comments calling turns hub-internal
(`schema.ts`, `conversationHistory.ts`, `wire.ts`) are out of date since SPEC-01 and are corrected in the slice.

**Branch (spec 13).** "Branch in new chat" is the explicit branch; a branch copies the turns with their `answered_by` snapshots
and starts with the source conversation's `companion_id`. No other action creates a conversation.

**Children and teens.** The selector and the `@` list show only companions that fit the person's type (rule 0); a child's list is
the adult-chosen set from COMP-04. A switch never loosens a filter: the band comes from the person, never the companion.

## 4. The Companions app: Yours and Discover (spec 11.1, 11.2)

Two kit `Tabs` on `/companions` (the same primitive the editor uses).

**Yours** is today's CardGrid (poster or idle clip, name, tagline, audience badge, "Your default") with two additions per card, both
the viewer's own: one latest-activity line (the newest of their jobs or conversations with this companion, "Found 3 recipes,
yesterday") and counts, "N tasks · M chats", from their jobs plus projects and their conversations by `companion_id`. Counts are inventory: "N tasks · M chats", the viewer's own rows only (rule 6a,
NO-CROSS-USER-VISIBILITY-01). State is one more line, and only because Jesse added the S6 row for it on 2026-10-24 (the architect
had read S6 twice as forbidding it: "a job running" is S6's own example, and an open ask already has the Needs-you card, the bell
and the Ask): "1 working · 2 waiting on you", the viewer's own jobs for this companion, drawn with the kit Status Element as
shipped, reading the same job records as the Tasks tab and never a copy; the line is absent when every count is zero. The spec's
Working / Needs approval / Error badges are not drawn beyond that line. "N tasks" opens the detail's Tasks tab, where each job's
own card shows its state; an open ask is still answered on the Ask, the Needs-you card or Notifications, never on the card. Every viewer,
admins included, sees only their own rows and counts (rule 6a, NO-CROSS-USER-VISIBILITY-01; the ACTIVITY-01 row's "admins see
household jobs" predates the 2026-10-07 owner rule and is stale). Actions: Open (detail) and New chat (a conversation with this
`companion_id`). Jobs and projects gain an additive `companion_id` (provenance of who worked); none of it is a new store.

**Discover** lists every companion the person may use that is not in their set yet, in the look of the first reference image:
a filter chip row (kit `Chip`: All, Chat, Research, Shopping, Stories, Kids) and a grid of poster cards with name, purpose line,
creator (the manifest `author`), the audience badge and an origin badge in the Skills page's words (packages note, section 2):
*Included*, *Made at home*, *From the catalog*. Two groups, one grid:

- **On this Home**: installed companion packages and household companions with status `ready` (being ready already makes a
  household companion visible to the household; no new sharing flag). Add appends the id to the person's own `companions.enabled`
  list (COMP-04, one settings write) and lands on Yours.
- **From the catalog**: catalog packages of kind `companion` not yet installed. For an admin, Add is the normal store install
  followed by the same settings write. For an adult member the control reads "Ask an admin to install" and files the existing
  `install_package` request; the card then reads "Requested". This group reuses the store browse route (APPSTORE-DESIGN-01)
  filtered to companions, never a second browse, and is empty until the catalog's `companions/` holds a package.

Who sees what: adults and admins see both groups; teens see "On this Home" only (they write their own settings under the teen
privacy ruling); children have no Discover tab, because COMP-04 makes a child's set adult-written from Settings, People.

**Yours is `companions.enabled`.** COMP-04 already names the record: a person-scope list of companion ids, written only through the
settings writer; `persona.active_id` becomes the default inside that set. The list a person sees is their stored list plus their
current `persona.active_id` plus `default`, so no household needs a migration; an id that was uninstalled or no longer fits the
person's band is dropped on read, the same fallback `persona.active_id` already uses; removing the default from the list sets the
default back to MaiPai. Spec first: `companions.enabled` is added to `spec/settings/keys.json` with `options_from: "companions"`
and `persona.active_id` moves to the same `options_from` range so a household `hc-*` id is a valid value (today Home works around
the fixed eight-id range in `settings.ts` and declares the key a second time in `personaKeys.ts`; that duplicate is reported in
section 9, not fixed silently).

## 5. The detail page: Activity, About, Tasks, Chats (spec 11.3)

For the preview, Yours uses left-aligned cards with a sample status, one activity line and task/chat counts; Activity shows sample recent rows and a note that real activity is coming soon. This data is deterministic per companion id, local only, and is not saved or fetched. Starting a companion-specific chat remains disabled until Home has a route for it.

`/companions/:id` keeps its header (poster or clip, name, tagline, audience, the Make this my default action) and gains four tabs.

- **Activity**: the kit `Timeline` Element over this companion's rows of the ACTIVITY-01 read model (jobs, projects, asks), newest
  first, with the same wording the chat's activity card uses. Every viewer sees their own rows only, admins included (rule 6a).
- **Tasks**: kit `TaskCard` per job or project of this companion, grouped Working / Waiting for you / Scheduled / Done / Failed,
  with the pause and cancel the records already support. It lists; it never defines a task kind.
- **Chats**: the conversation list filtered by `companion_id` (plus conversations where this companion spoke a guest turn, marked
  "joined for one question"), each row opening the chat.
- **About**: the companion's description, voice, and current profile details, with a settings icon that opens `/companions/:id/edit`.
  Nested tabs are avoided; the editor stays the one place that
  writes.

## 6. Tasks and the agentic layer (spec 6, 7)

Mapping, so the companion work layer rides what exists:

| Spec 7 state | Home record and state |
|---|---|
| Draft | a project in `planned` |
| Queued, Running | job `running`; project `running` |
| Waiting for approval | an open `Ask` of kind approval (or a pending `approvals` row today) |
| Scheduled | a `scheduled_jobs` row with its next run |
| Paused | project paused (runner) |
| Succeeded, Failed, Cancelled | job or project `done`, `failed`, `cancelled` |
| Expired | an `Ask` past its deadline (asks note) |

Work types: immediate is a job or a tool call in the turn; background is a project; scheduled and conditional are the scheduler
(conditional is a scheduled check that opens an `Ask` when its condition holds). Autonomy is BRAKES-01's per-tool do / ask / never;
read-only is the default and nothing in this note widens it.

**Quick answers, not typed ones (owner, 2026-10-24, from two Conduit screenshots).** When a companion proposes an action
("Got it: Magic Night, Friday, November 13, 5 to 11 PM on the shared calendar. Add it?"), the person answers with one tap, never
by typing yes. That is the asks design as written: the proposal is an `Ask` and the thread shows the kit `ApprovalCard` at that
turn, states request / running / done / denied, with its shipped buttons "Allow once", "Always allow" (adults, BRAKES-02c) and
"Deny" (ui-v0.5.330 hard-codes those labels; a wording change such as "Not now" is a kit prop first, rule 9c, not asked for here),
answered through `ask_answer` (asks note section 3, BRAKES-02b). A child's card reads "Asked a parent" with no buttons (rule 0,
asks note section 2). Nothing new is designed here: the card is the quick-answer surface for every proposal a companion makes,
calendar or otherwise, and a typed reply still works. The screenshot's thumbs up and
down on a reply are the kit action bar and `feedback-dialog` Home already ships (`chatActionBar.tsx`); a companion's reply gets the
same bar, so the rating reaches the same `answered_by` companion through the turn. Emoji-only buttons are not adopted: the card's
labels say what happens (STYLE.md, the dad test).

What waits (owner, 2026-10-24): the tooling for a companion to shop online, read and reply to email or act unprompted. That is
AGENTIC-DESIGN-01, a design of its own (tools, approvals, receipts, the robot). Until it exists the Tasks tab and the task card are shells (section 10).

## 7. Presence: one controller, two placements (spec 9)

**The controller.** The thread-independent half of `useCompanionPresence` (the avatar query, the hidden flag, the failed state) moves
to a shell-level context; the state signals stay where a thread exists. Chat keeps the corner `CompanionAvatar` as shipped (video
note section 14). "Hideable in settings" means the browser-storage key `maipai.companion.avatar.hidden` becomes one spec person
setting that every placement reads (principle 4, S4, S5); no second flag.

**The launcher was a rule question, and the reading before 2026-10-24 was no, for a shell too.** S2 says "Only the rail is ours" and "Global things (switching
apps, ...) live only in the main navigation, and an app never draws a second copy of them" (RULES.md lines 411 and 416 to 419).
A bubble drawn by the shell over every app is a second way into Chat, the same reading that refused the shell-owned mini bar over
non-media apps (media apps blend note, lines 218 to 221). S1 is untouched by a bubble outside the rail. S6 is touched only if the
bubble carries a count or a working or needs-you expression outside Chat; a bubble showing idle, greeting and sleeping with no count
stays clear of it. The Elements ledger (`ELEMENTS-DECISIONS.md` line 84, master plan Q5) already recommends "the rail's Chat stays
the one way in" with no ruling recorded; one answer from Jesse closes Q5 and this. The architect (2026-10-24) ruled that a
coming-soon shell in `frontend/src/shell/` breaks S2 the same way, whoever can see it, so phase 0 shows the launcher only as a
scripted HTML mockup beside this record (`assets/companions-shared-chat-2026-10-24/launcher.html`), rendered at 1440 and 390 px.

**Decided 2026-10-24: Jesse chose the spec's launcher** (the compact character button at the lower right of every non-chat area,
opening a 320 to 380 px chat panel on desktop and a bottom sheet on the phone, the conversation shared with Chat, hideable by the
person) and approved the S2 edit in this record's commit (`Owner-approved: 2026-10-24`). The launcher shows only the idle, greeting
and sleeping looks: no working or needs-you expression and no count, because S2 says it carries no count or status (S6). The sentence added to S2 is: "The shell may draw the person's companion
launcher at the bottom corner of any app except Chat; it opens Chat or a chat panel, carries no count or status, and the person can
turn it off." Then it mounts once in the shell beside `ShellInstallStrip` (`Routes.tsx` 141 to 145), stacked clear of `InstallDock`,
hidden on Chat routes so the character is drawn once. The kit `LauncherBubble` as shipped cannot meet the spec (hard-coded
message icon, 304 px panel, "typically replies in a minute" copy, no Escape or outside click, no phone sheet), so the slots and
dismissal go to commons first (rule 9), and a full chat inside the panel also needs the `assistant-modal` Element the kit still lacks.
A short launcher that opens the Chat app needs none of that. Build order (COMPANIONS-PRESENCE-01): commons first, the
`LauncherBubble` slots and dismissal plus the `assistant-modal` panel Element, then the shell mount; until that tag exists the
launcher stays the HTML mockup of section 10 even though S2 now allows it. The spec's "Your research is ready" line on the
launcher is not adopted: S2 as edited says the launcher carries no count or status (S6), so the ready signal stays the Ask and
the notification.

**Already covered without a launcher**: the character and its state machine, the phone size, Hide, the avatar gate through
`companionFits`, and the way into chat from anywhere (rail, phone drawer, the Home page ask box).

## 8. Memory and context (spec 8)

Jesse decided this in the companions brief ("every companion knows what the hub knows ... and each also has its own relationship
with the person ... one more scope on memory, per companion, not a second memory system") and COMP-05 made it a test: companion A's
running joke is absent from companion B's context. The shape that fits the shipped spec and the built robot precedent
(`robot-own-name-and-memory-2026-10-20.md`, ROBOT-MEMORY-01):

| Spec 8 layer | Record |
|---|---|
| Profile memory, shared | `scope: person`, `companion_id: null`; a fact about the person lands here whichever companion heard it |
| Companion-private (rapport) | `scope: person`, `person: <speaker>`, `companion_id: <companion>`; read only by that companion for that person |
| Conversation context | no record; the window, rolling summary and episode recall the turn already builds (rule 4) |

Recall gains one filter beside the device filter: `companion_id IS NULL OR companion_id = <the turn's companion>`. Robot turns keep
rapport bound to `device_id`. The judge writes no rapport for an unknown speaker or for a guest turn (`via: "mention"`): rapport
needs a known person and the companion they are actually talking with. The review queue shows rapport in the person's own list grouped under the companion's name. Deleting a
household companion deletes its rapport records, as Forget a robot does. Rule 0's companion paragraph, rule 6a and
NO-CROSS-USER-VISIBILITY-01 hold because the person gate in `canRead` is reused unchanged.

Why not the spec's `companion` scope: the pinned spec has it, but its validator refuses a person on a companion-scope record, so it
could never say whose rapport it is, and Pippa's joke would reach Oliver through the same companion. Why not provenance only: the
memory's `source` already points at the turn, whose `answered_by` names the companion; a second copy breaks principle 1, and it would
fail COMP-05's test. Spec first: `companion_id` allowed on `person` scope in `memory-record.schema.json` and both validators; Home
adds the column, the filter, the judge's rapport branch, and a default-deny for unknown scopes in `canRead` (today anything that is
not self or person reads as household; no write path produces one, but the slice closes it).

One reading only Jesse can confirm (section 13): the spec's "what this companion learned that the others do not see" could also mean
"everything said to B stays with B, episodes included". The record above splits by kind of fact, not by who heard it.

## 9. Resolver verdicts (design-resolver, 2026-10-24)

| Question | Reading | Confidence |
|---|---|---|
| Where the conversation and turn records live | Spec shapes since SPEC-01 (`conversation.schema.json` already has `companion_id`; `conversation-turn.schema.json` is synced by the robot). Spec first. The local commons checkout is on a stale branch at spec 0.1.146; work from the pinned tag directory `commons-tags/spec-spec-v0.1.223` or a fresh branch | high |
| Smallest additive change | `answered_by` on the turn (section 3); description change only on `companion_id`; PATCH gains the field | high; `via` medium |
| Memory layers | COMP-05's shape: `person` scope plus `companion_id` qualifier; not the spec's `companion` scope (its validator refuses a person, so it cannot say whose rapport it is); not provenance only (breaks COMP-05's test) | high on one store; medium-high on the qualifier |
| Discover | Both groups (On this Home, From the catalog), in the Skills page's words; `companions.enabled` is Yours (COMP-04); catalog group reuses the store browse | high; Yours starting contents medium |
| Floating launcher | Breaks S2 as written; S1 untouched; S6 only with a count or state; one Jesse answer closes master plan Q5 and this | high on S2; medium on S6's reach |

Things the resolvers found that are wrong today, to fix in the named slices rather than silently: `persona.active_id` is declared twice
(spec keys.json and `personaKeys.ts`) and its spec range is the fixed eight bundled ids, so a household id passes only through a name
check in `settings.ts`; approving an `install_package` request installs nothing and any adult may approve it; `canRead` treats an
unknown memory scope as household; POST `/api/conversations` does not check `companionFits` on `companion_id`.

## 10. Phase 0: the coming-soon shells (COMPANIONS-SHELL-01)

Purpose: Jesse steers the look and feel before the real build. Rules for every shell: a kit primitive or Element as shipped, no
Home wrapper, no className that changes shape; the copy is one sentence in the existing pattern ("Coming soon: what it will do.");
nothing writes a record; a shell never shows a child anything a built feature could not. All shells sit behind one household-scope
setting `companions.preview_shells` (`level: basic`; written only by an owner or admin and shared by everyone in the home, under Settings > The home > General > Household; off by default; copy through `describeSetting`, S5).

| # | Surface | What shows in phase 0 | Kit parts | Copy |
|---|---|---|---|---|
| 1 | Chat header companion control | The viewer's real companions with posters, MaiPai first; picking one changes the header label for this page view only | `DropdownMenu`, `Avatar` | toast "Coming soon: switching companions mid-chat" |
| 2 | `@` mention in the composer | The kit popover with the same list; the chip renders; the turn ignores it | `ComposerMentions`, `ComposerTriggerPopover` | toast "Coming soon: asking another companion one question" |
| 3 | Who-answered marker | In the HTML mockup only (shell 8): the kit has no `SpeakerMarker` yet and a Home slot component would be a wrapper | none (mockup) | "Mockup: lands in the kit first." |
| 4 | `/companions` tabs | Yours (today's grid plus "0 tasks · N chats", N real, and one summary line "Example: 1 working" on the first card, labelled like row 6); Discover (bundled companions not held, the chip row, Add disabled) | `Tabs`, `Chip`, `CardGrid`, `Badge` (audience only), `Status` | Discover footer: "Coming soon: add a companion to your set from here." |
| 5 | Detail tabs | About real (includes companion details); Activity, Tasks, Chats as EmptyStates | `Tabs`, `EmptyState` | "Coming soon: what Nova has been doing." / "Coming soon: tasks Nova is working on." / "Coming soon: your chats with Nova." |
| 6 | Example task card | One `TaskCard` in the Tasks tab with sample steps, labelled Example | `TaskCard` | meta "Example" |
| 7 | Create a companion wizard | Two real steps: template cards, then name and look; Finish opens the existing editor as a draft | `Wizard`, `CardGrid` | step 2 footer: "Finish opens the editor; templates set the dials, coming soon." |
| 8 | Launcher mockup (not in the app) | A static HTML page beside this record: the bubble with a companion poster on a non-chat page, the open panel, the phone sheet, and the who-answered marker from row 3 | none (mockup) | "Mockup: the panel Element lands in the kit first." |
| 9 | Ask card with quick answers | One example `ApprovalCard` in the thread after a companion's proposal ("Add Magic Night to the shared calendar, Friday 5 to 11 PM?"), state request, the shipped buttons with handlers that show the coming-soon toast like the other shells | `ApprovalCard` | "Example: a companion's proposal is answered with one tap once BRAKES-02b lands." |

Shells 1, 2, 4 to 7 and 9 are in-app behind the switch. Rows 3 and 8 are the two surfaces rule 9c keeps out of the app for now (the
marker until its kit Element lands, the launcher until the panel Element lands; S2 allows the launcher since 2026-10-24); one scripted HTML mockup holds both, opened and judged like a
screenshot.

Evidence for done: a screenshot of each in-app shell and the mockup at 1440 and 390 px, generated by script against the seeded demo household and opened
and judged (docs/VERIFICATION.md), and `bun run lint:ui-rules` clean. Jesse's steering on these screenshots decides the copy, order
and whether a surface is dropped before phase 1.

## 11. Build phases and backlog rows

| Row | Phase | Scope | Size | Done when |
|---|---|---|---|---|
| COMPANIONS-SHELL-01 | 0 | Section 10 | M | Seven in-app shells behind the switch plus one mockup (marker, launcher); screenshots judged |
| COMP-04a | 1 | Spec first: `answered_by` on turns, `companion_id` description; commons first: `SpeakerMarker` in the kit Thread and the `toast` re-export; `PATCH` companion_id with `companionFits`; the pick order in the turn; avatar route per conversation; header control; toast; marker | M | A conversation switches Nova to Riff and each reply names its speaker; a child cannot pick an adult companion (test) |
| COMP-04b | 1 | `ComposerMentions` wired; one-turn override; "joined for one question" | S | Test: the override lasts one turn; unmatched `@text` is plain text |
| COMPANIONS-YOURS-01 | 2 | `companion_id` on jobs and projects; the viewer's latest activity, counts and the one own-jobs summary line (S6 row, kit Status as shipped); no other state badge | S | Counts and the summary line match the viewer's own records; an admin sees no other person's rows (test) |
| COMP-04c | 2 | Spec first: `companions.enabled` and `options_from: "companions"` for both keys; the two groups; Add and Ask an admin; the approval that leads to an install | M | Add for an adult lands on Yours; a teen sees On this Home only; a child has no Discover |
| COMPANIONS-DETAIL-01 | 2 | Activity, Tasks, Chats with real rows; Setup summary | M | Tabs read ACTIVITY-01 rows; Chats filter by companion_id and guest turns |
| COMPANIONS-WIZARD-01 | 2 | Templates as dial presets; Finish creates a draft household companion | S | Draft appears in the editor with the preset dials |
| COMPANIONS-PRESENCE-01 | 3 | Controller in the shell; the hidden flag as a person setting; the launcher after the commons tag (`LauncherBubble` slots, `assistant-modal`) | M | One hidden flag; corner avatar unchanged |
| COMPANIONS-MEMORY-01 (COMP-05) | 3 | Spec first: `companion_id` on `person` scope; column, recall filter, judge rapport branch, `canRead` default-deny, delete with the companion | M | Test: A's running joke is absent from B's context; a birthday told to A is known to B |
| AGENTIC-DESIGN-01 | later | The agentic tooling design (shopping, email, acting alone, receipts) | L, design | Its own record and verdict |

COMP-04 is amended rather than duplicated: its three open outcomes (the header pick, one named message, `companions.enabled`) become
slices a to c above, its `kid_safe` reads `companionFits`, and its "name opener in text" trigger is dropped for the `@` chip (rule 1).

Order follows the plan order memory (setup, then voice, then data, then tools): phase 0 now, phases 1 and 2 after Jesse's steering,
phase 3 after the architect rules, AGENTIC-DESIGN-01 when Jesse opens it. Dispatch: phase 0 and the typed slices of phases 1 and 2
are decided, verifiable work for Codex; the turn change in COMP-04a is a governed chat-turn path and gets a code review
at medium.

## 12. Rule check

Rule 0: every list is filtered by `companionFits` and `companionsAllowed`; the band comes from the person. Rule 1: the `@` chip is
an explicit trigger, no word matching. Rule 2: no engine change. Rule 5: no caps. Rule 6: a failed job is a card state, never a
failed answer. Rule 6a: `answered_by` holds a companion name, not a person's text. Rule 8: no model choice for minors; none offered at
all in this note. Rule 9: every chat piece is an assistant-ui or kit Element as shipped, no wrapper, no shape className; the thread
marker is drawn by the kit Thread from message metadata (commons first, rule 9c), with no Home slot component. Rule 9b: Yours, Discover and the detail use shadcn/ui through the kit. Rule 14: a companion is
dials and clips, never prompt prose. S1: the rail is untouched. S2 (edited 2026-10-24): the shell may draw the companion launcher on non-chat areas; its Elements land in commons first (rule 9c), so phase 0 keeps the mockup in docs. S4 and
S5: the preview switch is a setting record with copy from the spec. S6 (row added 2026-10-24): a Yours card carries one own-jobs summary line from the job records, the kit Status Element as shipped, and nothing else about state; an open ask is answered on the Ask. V1:
nothing here touches a video service.

## 13. Decisions (Jesse, 2026-10-24, through the wizard)

| # | Question | Decision |
|---|---|---|
| 1 | Floating launcher | Yes, the spec's full launcher: character button on non-chat areas opening a chat panel (desktop) or bottom sheet (phone). S2 edited in this commit (section 7). Closes master plan Q5 the other way: the rail's Chat is no longer the one way in. |
| 2 | Companion memory | Shared facts, private rapport (section 8 as written). |
| 3 | Templates | The current six: Chat buddy, Research, Shopping (coming soon), Homework helper, Storyteller, Custom. No Finance or Health. |
| 4 | Per-companion model override | Not offered. Every companion uses the household model. |
| 5 | A new person's Yours | MaiPai plus the companion they picked at setup; the rest wait in Discover. |
| 6 | A removed companion on old chats | The saved name with a plain mark; no still store. |
| 7 | Cards without state badges | Jesse asked the architect to re-read S6 for one own-jobs summary row per card. Ruling: S6 as written forbade it in every form. Jesse chose the rule change: one S6 table row added in this commit (`Owner-approved: 2026-10-24`), so each Yours card may carry one own-jobs summary line (section 4). |

## 14. Supersedes

Three passages are replaced, and the rest is extended:

- **COMP-05** (`docs/BACKLOG.md`, the companion memory row): its planned `scope` gaining `companion` is replaced by a `companion_id`
  qualifier on `person` scope (section 8); the test it names stands.
- **COMP-04**: its "a name opener in text" trigger is replaced by the `@` chip (rule 1); its `kid_safe` reads `companionFits`; its open
  outcomes become slices a to c (section 11).
- **`companion-video-characters-2026-10-21.md` section 14**: "Not in this version: the large launcher bubble" becomes "the launcher
  is decided and allowed by S2; commons first, mockup in phase 0" (section 7).
- **Master plan Q5** (`ELEMENTS-MASTER-PLAN.md`) and the old `ELEMENTS-DECISIONS.md` ledger line ("the rail's Chat stays the one way
  in"): replaced by Jesse's 2026-10-24 ruling; `launcher-bubble` and `assistant-modal` are claimed by COMPANIONS-PRESENCE-01.
- **S2 and S6 before 2026-10-24** as read by the architect in this record's earlier runs: the rule text itself now carries the two
  owner-approved additions.

Extended, decisions intact: `companions-app-2026-10-21.md` (two tabs, four detail tabs), the assistant-layer plan (ACTIVITY-01 gains
a per-companion view with own-rows-only visibility).

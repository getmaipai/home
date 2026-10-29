# Agentic actions for companions: design (2026-10-29)

Status: proposal for the owner. Research and design only; no code changed. Needs an architect verdict before any slice is filed.
It extends, and does not replace, [assistant-layer-2026-10-04.md](assistant-layer-2026-10-04.md) (errands, approvals, heartbeat) and
[tools-ecosystem-design-2026-10-03.md](tools-ecosystem-design-2026-10-03.md) (tool declaration, MCP client, offered set). Where this note
changes one of their decisions it says so in section 8.

Inputs: those two notes, [mcp-connectors-survey-2026-10-03.md](mcp-connectors-survey-2026-10-03.md), `docs/design/RULES.md`, a read of the
current code (file references below), the owner's example requests, an outside design proposal ("ChatGPT notes", 998 lines, reviewed in
section 6), and the outside research listed under Sources.

**Owner direction, later 2026-10-29: start with MaiPai's own apps, alarms and reminders first.** If that goes well, expand to notes and
memories. The Apple bridge in 3.8 is kept as a later provider, not the first build. Sections 3.8, 7 and 11 carry this; nothing else changes.

## 1. The answer in short

1. **Nobody authors workflows.** The model plans each job itself from the tools it is offered. Adding a capability means installing a
   connector (an MCP server pinned by hash), not drawing a flow. The owner's worry, hand-managing every workflow, is answered by removing
   the workflow as the unit of work.
2. **Safety is enforced by code around the model, never by the model's judgment.** Every tool call gets an effect class from a trusted
   manifest, a policy decision (do, ask, never), arguments checked in code, and a receipt. The model can be fooled by a web page; the
   policy node cannot.
3. **A run that has read untrusted content cannot send, spend or delete without a person's approval.** This is the "Rule of Two" applied
   per run (untrusted input, sensitive access, outside effect: at most two at once).
4. **Money, messages to other people, deletion and account changes start at "ask" or "never".** Purchases stay "never" (cart handoff only)
   until the owner decides otherwise. Logging an entry in the household's own ledger, editing the household's own note, and zipping files
   into a folder are "do, with a receipt and an undo".
5. **Routines are saved from runs that worked.** After a good run the person says "do this every Friday"; Home saves the goal, the
   constraints and the tool-call trace as a routine, replays it, and falls back to the model when the world differs. The person edits it as
   a short readable list, not a graph.
6. **Almost everything is reused.** The scheduler, errand record, approvals, policy node, extraction call, credentials center and
   notifications exist. What is missing is the MCP client, the `tool_action` approval kind, per-run taint tracking, a credential broker for
   connectors, and the browser worker. Nothing here needs Temporal, n8n or a new store.

## 2. What exists and what is missing (read from the code, 2026-10-29)

| Need | Exists | Missing |
|---|---|---|
| Tools in the turn | engine-native tool calls, `tool_choice` auto (`llm.ts:169-172`); `policy.ts` gates by role and parks `confirm_needed` (`:326-352`); tool budget (`toolGates.ts:57`); a failed tool never fails the answer (rule 6) | `model_tool` manifest block (T1), per-person offered set (T2) |
| Third-party tools | MCP client SDK is a dependency; Home hosts Tier 1 packages as MCP servers under Deno (`denoHost.ts`) | MCP client for outside servers (BACKLOG:2812; six unlanded commits on `BRANCH-MCP-01`) |
| Schedule | durable `scheduler.ts` (`scheduleJob :115`, `runDueJobs :452`), survives restart | job `kind: turn` (SCHED-02), routines (ROUTINES-01) |
| Multi-day goals | project runner (`lib/projects/`); `tool` step throws today (`steps.ts:117`) | Errand record (ERRAND-01), PROJ-TOOLSTEP-01 |
| Approvals | `approvals.ts` with a closed kind list, no self-decide (`:28, :105`); in-turn `parkAsk` (`machine.ts:349`) | kind `tool_action`, per-tool do/ask/never, receipts (BRAKES-01) |
| Credentials | keystore AES-256-GCM, scoped, revocable, per person (`.github/docs/CREDENTIALS.md`) | OAuth and linked-account plumbing (BACKLOG:3521-3547), a broker that hands connectors a credential without the model seeing it |
| Notify | `notifications.ts` (in app, Telegram out, robot), quiet hours | "notify only if changed" as a routine property |
| Browser | nothing for users; Playwright is a test dependency only | browser worker (BROWSER-BENCH-01 first) |
| Notes, ledger, calendar, files | none (Home Assistant is the only integration) | one connector each |
| Companion grants | none: tools are per person and per role, not per companion | decided in 3.7 |

## 3. Design

### 3.1 Three layers

```
 person asks / schedule fires / watch triggers
                  |
   (1) LOOP  a turn run as the person: model plans, calls tools, sees results, stops
                  |   every call passes through
   (2) POLICY  effect class -> do | ask | never, argument checks, taint check, budgets
                  |
   (3) CAPABILITIES  connectors (MCP servers), packages, browser worker; credentials stay here
                  |
   RECEIPT -> Activity feed, thread line, undo where an inverse exists
```

- **Loop.** A bounded tool loop inside the existing turn machine. Interactive requests run in the thread. Background requests are the
  same turn started by the scheduler as that person (SCHED-02), so they inherit the person's age band, surface, offered set and output gate.
  A goal that outlives one turn is an Errand: a small stored record (goal, constraints, budgets, state, open question) that each run loads
  fresh, so context never grows without bound.
- **Policy.** Deterministic code (`policy.ts`, extended). Described in 3.3 and 3.4.
- **Capabilities.** Where the outside world is touched. The model never holds a secret and never sees a raw token.

### 3.2 How the model gets tools without anyone wiring workflows

- A connector declares its tools. We mirror MCP annotations as hints only; the trusted class comes from our own manifest block, set at
  install review (T1 already says this, and the MCP spec confirms annotations are untrusted unless the server is trusted).
- The offered set is computed per person and frozen per conversation (T2). Above the cap of 16, the model calls `find_tools` itself (T3),
  a tool it chooses to call, so no classifier picks tools from message text (rule 1).
- Adding "Joplin" or "my ledger" is an install plus a credential grant. After that the model can compose "find my croc note, add a row"
  from `search_notes`, `get_note`, `update_note` with no flow authored by anyone.
- **Entity resolution happens in tools, not in the model.** The model passes a name ("the gas card"); the tool resolves it against the
  real accounts and returns exactly one match or an error listing candidates. The model never invents an id. No single match means the
  tool fails closed and the model asks the person.
- **Structured extraction for anything parsed from messy input** (a spoken "twenty-one dollars and six cents at Costco"). The existing
  `extract.ts` call (constrained JSON schema) produces `{amount, payee, account, category, date}` with nulls allowed. Missing or
  speech-derived money fields are shown back for one-tap confirmation; clean typed input with a unique account match goes straight through.

### 3.3 Effect classes and default policy

The class belongs to the tool, set in the trusted manifest. The default policy belongs to the person and is editable per tool.

| Class | Meaning | Default for an adult | Receipt and undo |
|---|---|---|---|
| `read` | reads the household's own data | do | log line |
| `read_external` | reads the open web or a logged-in site | do, inside the domain allowlist | log line |
| `write_own` | changes the household's own data and has an inverse (note edit, ledger entry, calendar event, file created in an output folder) | do if the run is untainted, else ask | receipt line with the diff; undo through the inverse |
| `write_own_hard` | own data, no inverse (overwrite, merge) | ask | receipt |
| `write_shared` | write into a household-owned account at an outside provider (family calendar on the Apple bridge or CalDAV; not the hub's own lists) | adult: do if the run is untainted; teen: ask a parent; child: never | the writer's own receipt; the household sees the item itself in the shared account |
| `send` | any message or post to another person or service | ask, exact text shown | receipt |
| `spend` | purchase, payment, subscription, transfer | never (cart handoff) | n/a |
| `destructive` | delete, empty, unsubscribe, cancel | ask, exact target shown; permanent deletion never | receipt |
| `account` | security or account settings, accepting terms, new credentials | never by the model; the person does it | n/a |
| `physical` | locks, doors (Home Assistant) | ask (T4, unchanged) | receipt |

Children and teens: agentic tools stay off except the existing reminders and lists, and a minor's `write_own` becomes ask (T4). This
design adds no agent surface for minors. A model with no measured record gets no tools for a minor (rule 8).

### 3.4 Safety architecture (what stops the bad outcomes the owner named)

1. **Approvals bind the exact action.** An approval row stores the tool, the arguments hash, the connector version and the rendered
   preview. Approving runs that call once. The model cannot change the arguments after approval, and "approve all" does not exist.
   The card shows what will happen in the tool's own words (amount, payee, account; recipient and body; file path), never the model's
   summary of it. Reuses the shipped `approval-card`; no second approval path (the self-decide refusal at `approvals.ts:105` stays).
2. **Taint tracking per run.** A run becomes tainted once any tool result carries untrusted content: a web page, an email, a note body
   written by someone else, a downloaded file. A tainted run can still read and summarize, but every `write_own`, `send`, `destructive`
   and `physical` call asks, whatever the person's default. Taint never clears inside a run. This is the lethal-trifecta and Rule of Two
   idea implemented as one boolean the policy node checks, so no prompt-injection defense depends on the model noticing the attack.
3. **Quarantined reading.** Untrusted pages and files are read by a constrained extraction call that returns a fixed schema (price,
   title, date, link), not free text into the planner. The CaMeL and dual-model papers argue the same split: the model that reads
   untrusted text should not be the one that picks tools. We approximate it with schema-constrained extraction because a second model is
   not available on a household machine.
4. **Credentials are capabilities, not prompts.** The credential for "watch my calendar for changes" is a read-only grant, so even a
   fully hijacked run cannot write. Grants are per connector, per account, per verb, with expiry and one-click revoke (the credentials
   center already promises scoped, revocable, per person). Secrets are entered in the credentials center, never in chat and never through
   a form the model requested (the MCP spec itself says secrets must use URL-mode, out-of-band entry, never form mode).
5. **Egress is closed.** A connector reaches only the hosts its manifest declares (H3). The browser worker reaches only the domains the
   person allowed for that errand. A tainted run cannot call a tool that takes a free URL or recipient the model composed, which blocks
   the "encode private data into a link" exfiltration path. Private hosts and metadata addresses stay blocked by `ssrfGuard`.
6. **Budgets on every run.** Per run: max tool calls, max model calls, max wall time, max pages, allowed domains, and spend fixed at zero.
   Per errand: max runs and max days (ERRAND-01). Hitting a budget stops the run and says so in plain words (rule 6). Every run can be paused or
   cancelled from the Activity feed; cancel cascades to child jobs.
7. **Verify after acting.** After a write the loop re-reads the target and compares it with what the tool call was meant to do
   (the new row exists, the entry shows the right amount). The receipt reports the verified state, not the intended one.
8. **Standing approvals are narrow and expire.** After three identical approved actions the card offers "always allow this kind":
   one tool, one account, a maximum amount, a count cap per day, an expiry date, shown in plain words, revocable in one tap. A standing
   approval never covers `spend`, `account`, a new recipient or a tainted run.
9. **Human handoff for what only a human may do.** CAPTCHA, MFA codes, terms, and password entry open a handoff where the person acts in a
   window the model cannot read (OpenAI's Operator calls this takeover mode). The run waits as `waiting_on_you` and resumes after.
10. **Sensitive sites run in watch mode.** For a configurable class of domains (banks, email, health), the browser worker never acts
    unattended: every submit asks, and the person can watch live. Adopted from Operator's watch mode.

What this cannot promise: a determined injection in a tainted run can still make the model produce a misleading *answer*. The design
limits damage to answers, never to actions, and says so in the settings page.

### 3.5 Routines: learned, not drawn

- A routine is `{goal, constraints, trigger, notify_when, tool trace, parameters, version, owner}`. It is saved from a completed run: the
  person says "do this every Friday at 8" and Home turns the run's successful calls into a replayable trace with the varying values (date,
  amount) marked as parameters.
- **Replay first, model on divergence.** Each run replays the trace step by step with deterministic code. If a step's result differs from the
  recorded shape (a missing column, a changed button), the loop hands that step to the model with the goal; if the model repairs it, the
  routine is offered an update (new version, old one kept).
- **Quiet by default.** `notify_when: changed` is a first-class field. The calendar digest compares today's snapshot to the last stored one
  in code and notifies only when the diff is not empty. "Say nothing if nothing changed" is a property of the routine, not a hope about the model.
- **Edited as text.** A routine shows as a numbered plain-language list with a schedule line, an "ask before" marker on gated steps, a Run
  now button and a pause switch. No node editor.
- **Permissions pinned per version.** A routine runs with the grants the person had when they saved it, intersected with what they have
  now. Revoking a credential pauses the routine and says why.
- Teach by example is the main authoring path; typing "every weekday at 8 and 4, tell me what changed on my calendar, say nothing if
  nothing did" also works, because the model drafts the routine from the sentence and shows it for confirmation before the first run.

### 3.6 Credentials and the browser

- **Prefer an API or connector.** Joplin (Web Clipper API), a ledger app, CalDAV and the filesystem all have maintained MCP servers
  (section 5). Use the browser only for sites with no API.
- **Browser worker.** Playwright MCP, which drives pages through the accessibility tree rather than screenshots, so a text-only local model
  can run it. It runs as a supervised child process in a fresh context per run, with a download folder that is a quarantine directory, domain
  allowlist and page, time and download limits. Saved login state is stored encrypted in the keystore only when the person asks for
  continuity. BROWSER-BENCH-01 (already filed) decides whether Playwright MCP, Browser Use or Skyvern is the worker; this design needs one
  MCP tool surface either way.
- **Login flow.** The person grants the connector a stored credential in the credentials center. The broker (a Home component, not the
  model) fills the login form; the model sees only "logged in" or "login failed". A password never enters model context, a screenshot, a
  log or a trace. The loop works from page structure after login.
- **Downloads.** A downloaded file lands in the quarantine folder, is scanned for type and size, and is surfaced to the person; moving it
  into the Library is a `write_own` step. Executables are refused.

### 3.7 What a companion is in this design

A companion is the voice and face of the run. It holds no grants. Permissions follow the person, because RULES.md says a companion never
loosens a filter and tools are per person and role today. A companion may carry a *narrowing* list (a "Reader" companion that can only use
`read` tools) and its own routines; it can never hold more than its person. The Activity feed shows which companion started each run, and
the thread shows the companion's voice on the receipt line.

### 3.8 Accounts and providers (owner direction, 2026-10-29)

**Order of providers (revised by the owner): MaiPai's own apps first, outside providers later.** Phase A is the hub's own lists, reminders,
timers and alarms (provider 3 below, the only one built first). The Apple bridge (providers 1 and 2) and CalDAV (4) are phase B, started
only after phase A works and the owner says so. The numbering below is kept so earlier references hold.

**Phase A in detail: alarms and reminders on the hub's own scheduler.**
- **Already shipped, reused as is:** the `remind` and `timer` plugins (`backend/packages/remind`, `timer`), `lists.ts`, `scheduler.ts`
  one-shot jobs, the `remind.due` and `timer.done` notifications, the `schedule_card` answer block. Gates are the Household design's
  (`docs/design/household-lists-reminders-2026-10-17.md`): a child sets a reminder or alarm for themselves only; a reminder for another
  person is a `consequential` call.
- **New: the alarm.** A reminder that rings: a label, a time, an optional repeat (weekdays, daily), a snooze, and a chime on the person's
  chosen device (phone, speaker, robot). It is the same `scheduled_jobs` row family as a reminder (`job: alarm`), not a second store. A
  one-time alarm needs only the existing scheduler. A repeating alarm uses the schedule forms ROUTINES-01 already owns (daily, weekly,
  cron with a time zone), because the scheduler's own recurrence is a minimal `every:<n><m|h|d>` placeholder (`scheduler.ts:93`); this
  note builds no second recurrence grammar. The Household design's "a reminder is one-shot" stays; recurrence belongs to the alarm and
  to routines.
- **Class and default.** Setting, changing or cancelling an alarm or reminder for oneself is `write_own`: do, with a receipt line
  ("Alarm set for 6:30, weekdays") and an undo (cancel). Setting one for another person keeps today's `consequential` gate from the Household design
  (it is not `write_shared`, which stays limited to outside-provider household accounts): ask, and a child receives one only from a parent. Alarms never run an action by themselves; they only notify.
  **Owner ruling (2026-10-29): a child's alarm for themselves is set at once, like `remind` today** (never looser than `remind`, still
  cancellable, still never for another person). A ringing robot uses the alarm chime and child alarm line already filed in
  ROBOT-CLIPS-02, with its fixed-clip review; this note adds no second chime.
- **External notifications (owner, 2026-10-29, revised: Bark and Telegram, each optional): alarms and reminders must reach a person away from
  the hub through Bark, Telegram or both.** Bark is an iPhone push app (MIT; push goes through Apple's APNs; a push is one GET or POST to a server with a device key;
  `level=timeSensitive`, `sound`, `call=1` to repeat the sound for 30 seconds, `group`, and a `ciphertext` parameter for an encrypted
  body; the server `bark-server`, MIT, runs in Docker or as one binary). Reuse, no custom push code beyond one channel entry:
  - **Two optional channels, one function.** `notifications.ts` `resolveChannelsFor` gains a `bark` entry beside `in_app`, the existing
    Telegram entry and robot, with a per-person Bark address and a per-type `notifications.<type>.bark` choice. `remind.due`, `alarm.due`
    and `timer.done` are declared with both a Bark and a Telegram choice, **each off until the person links it and turns it on**. A person
    may turn on neither, one or both; with both on, one alarm sends one push to each and in app always fires. Telegram's linking,
    `telegramChannel.ts` and its existing events are unchanged. Further channels are more entries in the same function, never a
    second path.
  - **Server: self-hosted `bark-server` on the hub's network is the default and the public Bark relay is not.** Apple still carries the
    push either way, so the message is always sent with `ciphertext`: Apple and the relay see only ciphertext, and the phone's Bark
    app decrypts it. The device key and the encryption key are credentials: per person in the keystore (`CREDENTIALS.md`), never in a
    log, a prompt or the Activity page. Bark is iPhone only; a person without an iPhone has in app, the robot, and later channels.
  - **Levels.** An alarm is sent `timeSensitive` with `call=1` and `sound=alarm`; a reminder is `timeSensitive`; a timer is `active`.
    **Quiet hours (owner ruling, 2026-10-29, replaces "ring anyway"):** an alarm an adult or teen set for themselves rings at its time
    on every channel, quiet hours or not, so a 6:30 alarm is not held to 7:00. A child's alarm and every reminder wait for quiet hours
    to end, like any `time_sensitive` notice, so a child cannot ring through hours an admin set. A parent letting a child's alarm
    through is a later slice if wanted. Bark's `critical` level, which breaks through silent mode, needs
    the person to enable it in the Bark app and is never sent by Home on its own.
  - **Minors.** A minor's outside delivery is limited by `backend/src/lib/settingsMinorSnapshot.ts` (`CHILD_VISIBLE_SETTING_KEYS`; its
    `TELEGRAM_EVENTS` list becomes a shared outside-channel event list used by both channels). The three types join it for a child and a
    teen: the same delivery to the minor's own linked phone or chat that a minor can already switch on for listed events, so nothing is
    loosened.
  - **Privacy.** A new row `platform:bark` in `privacy.ts` (only while Bark is linked, naming the configured host) says that reminder
    and alarm labels and times are sent, encrypted, to the person's own phone through Apple. The existing `platform:telegram` row is
    updated in the same commit to say that reminder and alarm labels and times are sent to Telegram when a person turns that on (Telegram
    does not encrypt them). One row per connection, none per push.
  - **Who runs `bark-server`: the household, not Home or the Stack.** Rule 11 has the Stack own what chat needs, search included
    (`search.searxng_url` only overrides the Stack's own SearXNG). A push relay is not a chat need, so it is bring-your-own: one
    household setting, empty by default (Bark stays off until it is set, and Home never falls back to the public relay), checked when
    saved, a failing server raised as a Repairs item the way `searxngHealth.ts` does. The setup page links the `bark-server` README's
    Docker command.
  - **A failed push never drops the alarm:** in app and the robot still fire, and a failed Bark push does not stop the Telegram one. The label and time only are carried, to the person's own
    device only. A reply from the phone, such as "snooze 10 minutes", is the inbound side and belongs to GATEWAY-01, not to this note. Changing a repeating alarm shows
  its next three firing times in the receipt so a wrong "every day" is visible at once.
- **Why this is the right first slice.** It exercises every piece the later providers need (tool call, effect class, receipt, undo,
  account and default resolution by name, a scheduled job that can notify only when something is true) with no outside account, no
  login, no outside data and no money, and the hub already has most of the parts.
- **Accounts in phase A.** Only the hub's own account exists per person and for the household ("Mine", "Family"). The account
  argument, name resolution and defaults of this section are built now against that one provider, so a second provider is a new row,
  not a redesign.

Calendar, reminders and notes each exist in several places at once (the household's own, a person's iCloud, later others). The design
makes the place an **account**, not a different tool.

- **Account record.** `{id, area (calendar|reminders|notes), display name ("Family", "Mine (iCloud)"), provider, owner scope (person or
  household), provider scopes, status}`. It holds no secret; the secret stays in the credentials center. The provider scopes are only what
  the provider's credential can do (read, add, edit). **Who may use an account is decided by the existing Grant rows
  (`commons/spec/schemas/grant.schema.json`) and the audience rules**, so there is one definition of access. The hub's own lists "account"
  only points at the existing `list` records: no copy, no sync.
- **Accounts are per person** (`CREDENTIALS.md`: identity is per person). A person-scoped account such as "Mine (iCloud)" is reachable only
  by its owner; no admin or parent can reach it. A household account is created by an adult and used under Grant rows. The Apple bridge acts
  as the one Apple ID signed in on that Mac, so that account binds to that one person; a write into a shared calendar is made by that
  person's Apple ID, and the item shows that name in the calendar itself.
- **Tools take an `account` argument the tool resolves by name.** The model passes "family"; the tool returns one match or an error listing
  candidates and the model asks. No ids from the model. A missing default does not guess.
- **Defaults.** Each person has a default account per area; the household has one for "our" and "family". An ambiguous request gets a
  one-tap pick; the person may save the choice as a routing preference. A routing preference is not an approval and never widens a grant.
- **Class `write_shared`** (section 3.3) applies only to household-owned accounts at an outside provider (the family calendar on the Apple
  bridge or CalDAV). The hub's own lists keep the Household design's gates (`docs/design/household-lists-reminders-2026-10-17.md`: a child may add and
  tick items, a teen is treated as an adult on their own records) and the existing tools' `min_role` (`list-add`: child); this note
  changes none of that. The receipt is the writer's own record on their own thread; the household sees the item itself in the shared account.
- **Providers: reuse maintained servers, build none.** The Apple bridge uses the Mac's own iCloud sign-in, so Home never holds an iCloud
  login, never handles Apple reauthentication, and never asks for an app-specific password for these three areas. When the Mac's Apple
  ID needs attention, the person fixes it in macOS, as they would anyway.
  1. **Apple bridge, Calendar and Reminders:** `FradSer/mcp-server-apple-events` (MIT, 230 stars, v1.6.2, EventKit through a signed
     prebuilt binary, `npx` install; the npm version and binary hash are fixed at install so the server is never fetched at run time). Its write confirmation is off by default; we do not rely on it (our policy node decides) and pin it by hash.
  2. **Apple bridge, Notes:** `sweetrb/apple-notes-mcp` (MIT, 173 stars, v2.15.1, AppleScript with a read-only database path). It refuses
     updates when the note changed since read (`revision_conflict`), verifies each write by reading it back, and refuses notes with
     attachments or formatting it cannot carry. That matches our verify-after-acting step and keeps table edits safe. Rejected:
     `supermemoryai/apple-mcp` (archived 2026-01-01).
  3. **MaiPai's own lists and reminders** (`lib/lists.ts`, the remind package) as an account, so a household without Apple accounts works.
  4. **Generic CalDAV** for calendars only, kept as a fallback. iCloud over CalDAV needs an app-specific password that stops working after an
     Apple ID password reset, which is the reauthentication trouble the owner wants to avoid, so it is not the first choice for iCloud.
  5. Joplin and others later, as further notes accounts.
- **Limits stated plainly.** The bridge works only on a Mac that is signed in and logged in; the first use needs the person to approve
  macOS prompts on screen (Reminders, Calendars, Automation for Notes, and Full Disk Access for the Notes safety checks); headless runs can
  hang on a missing approval; locked notes are unreadable; Apple Notes has no revision history that was found, so an edit keeps the
  previous body inside Home as its undo. A hub on other hardware gets providers 3 and 4 only. Apple data leaving the home through iCloud is
  the person's own account and stays off until they connect it, with a privacy-page row. Full Disk Access, which the Notes server wants for its safety checks, is a large macOS permission for the process that holds it, and gets its own row next to the iCloud row; it is optional and the person may decline it.
- **No new MaiPai notes or calendar app in this phase.** Family notes and a family calendar app are product designs of their own and are not
  needed for the agent layer to work. A hub-hosted CalDAV server (Radicale-class: a household-run address, or Stack-supervised like SearXNG if the owner decides) is the later option for a
  household with no Apple accounts; its license and task support are unchecked.
- **Feasibility check first.** Before any slice: on the Studio, with a throwaway note, reminder list and calendar, name the macOS user the
  bridge runs as (the prompts belong to the logged-in user; whether the hub's service user can hold them is untested) and confirm read, add,
  edit and the prompt flow work unattended after the first approval. The person approves the prompts.

## 4. The owner's examples, walked through

"Do" below means the default in 3.3 with an untainted run. Connector names are the candidates in section 5.

| Request | Capability | Trigger | Class and default | Notes |
|---|---|---|---|---|
| Every day at 8 and 4, tell me what changed on my calendar; stay quiet if nothing | Apple bridge calendar, read-only grant | routine, twice daily | `read`: do. Notify only if the stored snapshot differs | Diff is code. Bridge feasibility check comes first (3.8). |
| What is my latest transaction? | ledger connector, read | chat | `read`: do | Needs a ledger source (decision Q1). |
| Most recent note I updated in Joplin | Joplin connector | chat | `read`: do | Sort by updated time in the tool; no model arithmetic. |
| Find my "croc replacement schedule" note and add a row: purple, today | Joplin connector | chat | `write_own`: do, with diff and undo | Model reads the table, copies the convention, proposes the new row; tool applies a patch; the receipt shows the diff; undo restores the previous revision. Taint rule: the note body is the person's own, so it does not taint. |
| Put $42.40 at Mobil on the gas card for gasoline | ledger connector | chat or voice | `write_own`: do after entity match; confirm when the amount came from speech | Tool resolves "gas card" to one account or fails closed. |
| Also add $30 for a grocery store on the same card | same | chat | same | "Same card" resolved from the thread by the model, then re-checked by the tool. |
| Log twenty-one dollars and six cents at Costco for bulk groceries | same | voice | confirm card because the amount was spoken | One-tap approve shows `21.06, Costco, <card>, Groceries`. |
| Log in to site X and download Y | browser worker | chat | `read_external`: do inside the allowed domain; first login uses the person's stored credential; download to quarantine | MFA or CAPTCHA opens a handoff. A banking domain runs in watch mode. |
| Save all the JPEGs on the CD into a zip | filesystem connector scoped to the disc mount and an output folder | chat | `write_own`: do | Needs the hub to read the drive, or the person drops a folder. Output is a new file, so it has an inverse (delete the new zip). |

Things the design refuses by default, so nobody is surprised: buying anything, sending an email or message to a new recipient without
showing it, deleting, changing passwords or settings, accepting terms.

## 5. Reuse: buy, build, reject

| Piece | Choice | Why |
|---|---|---|
| MCP client | **Reuse** the official TypeScript SDK already in `package.json` (v1 line, stdio and Streamable HTTP) | Already planned as H2; the same client talks to every connector below |
| Joplin | **Reuse** a maintained Joplin MCP server over the local Web Clipper API; several exist (Glama and Pipedream list them) | Pin by hash (H4); read-only variants exist for a first grant |
| Ledger | **Reuse** an Actual Budget or Firefly III MCP server, whichever the household runs (both have community servers) | Open decision Q1; a bank feed (Plaid-style) is rejected: it sends data outside the home |
| Calendar and Reminders (Apple) | **Reuse** `FradSer/mcp-server-apple-events` (MIT, EventKit, signed prebuilt binary) | Uses the Mac's own iCloud sign-in, so Home never handles iCloud login or reauth. Alternatives considered: `supermemoryai/apple-mcp` (archived), generic CalDAV (needs an app-specific password that breaks on password reset; kept as fallback) |
| Notes (Apple) | **Reuse** `sweetrb/apple-notes-mcp` (MIT, AppleScript, revision-conflict and read-back checks) | No outside web access to Apple Notes exists that was found; the same Mac bridge covers it |
| Files | **Reuse** the reference Filesystem MCP server with roots restricted to named folders | Roots are the policy; no path outside them is reachable |
| Browser | **Reuse** Playwright MCP (Apache-2.0, accessibility-tree driven) pending BROWSER-BENCH-01 | Works with a text-only local model; maintained by Microsoft |
| Scheduler | **Reuse** `scheduler.ts` plus SCHED-02 | A second scheduler is a second copy (principle 1) |
| Durable multi-step state | **Reuse** the Errand record and project runner | Same reason; LangGraph's interrupt-and-resume pattern is what ERRAND-01 already does with its stored question |
| Approvals UI | **Reuse** `approval-card`, `task-card`, `background-inbox` kit Elements | Rule 9b: kit parts as shipped |
| Planner | **Build nothing**: the model's native tool loop | No agent framework (assistant-layer, "What we do not build") |
| Workflow engine (n8n, Activepieces, Windmill, Temporal, Inngest) | **Reject** | Each brings its own database, credential store, UI and loop, and none knows the household's age bands; the owner's worry is hand-managing flows, and these are flow builders. Their licenses were not checked (section 10) |
| Hosted connector platforms (Composio, Pipedream Connect, Nango cloud) | **Reject** | OAuth tokens and data would transit a third party; the product promise is that nothing leaves the home |
| Visual workflow editor (React Flow) | **Reject for now** | Creates the manual-authoring burden; not a shipped kit part (rule 9b); a second status surface needs an architect verdict (rule S6) |

## 6. The ChatGPT notes: what to keep and what to drop

Keep (all already compatible with this design):
- Effect-based approvals that name the exact operation and bind to the run; no blanket authorization.
- Credentials in a vault behind a server-side broker, secrets never in model context, logs or traces.
- Prefer first-party APIs over browser automation; isolated browser contexts; domain and network allowlists; human handoff for MFA and CAPTCHA.
- Page text is untrusted data; bounded observe, act, verify loop; action budgets.
- Version pinning and a permission snapshot per run (kept as routine versions, 3.5).
- Playwright for DOM-led browsing.

Drop or change, with the reason:
- **The visual builder, node catalog and typed-edge graph.** It makes a person the author of every flow, which is the owner's stated worry,
  and it duplicates the Errand record, project runner and scheduler. Replaced by learned routines.
- **The data model** (WorkflowDefinition, Version, Trigger, Run, StepRun, Event, Template, workspace roles). It is a second copy of
  `scheduledJobs`, projects, approvals and notifications (principle 1). New spec records are limited to what the existing ones lack: `Routine`,
  `Errand` (as the assistant-layer note already scoped) and `Account` (3.8), each cut in `commons/spec` first, then the hub.
- **Per-companion permissions and private memory namespaces as the grant model.** Home grants by person and role; a companion only narrows.
- **A new Companions Activity and Tasks surface.** RULES.md S6 allows existing surfaces only (the Yours card line, the Review button,
  Repairs and Notifications); the Activity page is the separately filed ACTIVITY-01. Anything else needs an architect verdict.
- **Templates and a shared workflow catalog.** Out of scope; a catalog of routines is a later question.
- **"AI plans are drafts that must be published."** Too heavy for conversation. A one-off request runs directly; only the gated steps ask.
  A saved routine is shown for confirmation once, before its first run.
- **Workspace multi-tenancy language.** Home's tenancy is the household and its people.

## 7. Build order

Existing items in capitals are already filed; new ones are proposed and have no id yet.

0. **Foundation (all filed):** MCP client manager H2 (finish BRANCH-MCP-01), BRAKES-01 (`tool_action` approvals, do/ask/never, receipts),
   SCHED-02 (`kind: turn`), ACTIVITY-01. Add the `model_tool.consequence` classes of section 3.3 to T1 and per-run taint to `policy.ts`.
0b. **Account record with named accounts and defaults**, against the hub's own provider only.
1. **Phase A, alarms and reminders (owner's first build):** reminders and timers already ship. Add (a) the effect class, receipt and
   undo path on `remind`, `timer`, `list-add` (the existing tools declare `consequence` per T1, no behavior change for children),
   (b) the `alarm` job and tool, one-time first, (c) repeating alarms once ROUTINES-01's schedule forms land, (d) alarms and
   timers in the Clock app and reminders in the Reminders app (CLOCK-01, REMINDERS-01), each with Done and Snooze. Proves the loop, policy, receipt, undo and
   schedule path on data the hub owns. Exit: "wake me at 6:30 on weekdays" sets a repeating alarm, shows its next three times, rings
   on the chosen device, can be cancelled by saying so, and a child cannot set one for a parent.
2. **Phase A+, notes and memories** (only if step 1 goes well, owner's call): the hub's own notes and memory records as accounts. Their
   designs (a family notes app, what a "memory" write is under rule 6a and the memory design) are separate notes and are not started
   here; this note only reserves the account shape.
3. **Phase B, outside providers (owner's call, later):** Apple bridge feasibility check (3.8) on throwaway data, then calendar read plus
   `notify_when: changed`, then reminders and notes through the bridge, then writes with receipts. Ledger (Q1, Q2) and files follow.
4. **Files:** filesystem connector with roots; zip into an output folder.
5. **Routines saved from runs:** record, replay, divergence fallback, edit-as-text, version history.
6. **Browser worker:** after BROWSER-BENCH-01 and the injection bench; login from the credentials center, quarantine downloads, handoff, watch mode.
7. **Standing approvals** (3.4 item 8), after at least two weeks of real approvals data.
8. **Later, each its own owner decision:** email draft then send, scheduling with other people, any `spend` path (a one-time virtual card with a limit and an on-device approval is the only shape worth considering).

Each slice is one to three files per task for the local lane or Codex, with a failing test first.

## 8. Supersedes

Each row is conditional where it says so. Nothing in a conditional row takes effect until the owner says yes (Q2, section 11).

| Replaced or changed | Where | What happens |
|---|---|---|
| Non-goal "finance, health and location feeds" | `assistant-layer-2026-10-04.md` line 170 | CONDITIONAL on Q2. Narrowed to: bank feeds, card numbers, health and location stay non-goals; writing entries to the household's own ledger app through a connector is allowed |
| Non-goal "laptop or computer control" and "No model-driven checkout and no computer use" | same note, lines 169-170 | CONDITIONAL on Q2. Computer control and checkout stay banned. Logged-in browsing with downloads in the browser worker is allowed, never a purchase |
| Household design line "a reminder is one-shot" and its "no recurring reminders in slice 1" | `docs/design/household-lists-reminders-2026-10-17.md` | UNCHANGED for reminders. Alarms are a new job type; a repeating alarm uses ROUTINES-01's schedule forms, not a new grammar. alarms show in Clock (CLOCK-01) |
| Calendar row "Needs a design decision first" | `docs/BACKLOG.md:3521` | Decided here as direction (3.8): Apple bridge, then CalDAV; a hub-run calendar is deferred. The bridge feasibility check gates it. The backlog edit is the coordinator's |
| T1 `consequence: read\|write\|physical` | `tools-ecosystem-design-2026-10-03.md` line 43 | Replaced by the classes of section 3.3 (adds read_external, write_own, write_own_hard, write_shared, send, spend, destructive, account); `physical` is unchanged |
| Household list gates | `docs/design/household-lists-reminders-2026-10-17.md` lines 20-21; `list-add` `min_role: child` | UNCHANGED. `write_shared` does not apply to the hub's own lists; a child may still add to the shopping list |
| ROUTINES-01 definition "a scheduled prompt delivered into its conversation" | `docs/BACKLOG.md:4001` | A routine becomes goal, constraints, trigger, `notify_when` and a replayable tool trace with model fallback. The scheduled-prompt case is the trace-less routine and still works. The backlog edit is the coordinator's, in the same commit as an approved note |
| BROWSER-BENCH-01 scope "20 scripted read-only web tasks through Skyvern or Browser Use" | `docs/BACKLOG.md:2874` | Playwright MCP joins the candidates; the bench adds a logged-in task with a download. The browser connector still waits for the bench (Q8 stays) |
| BRAKES-01 acceptance "in background turns delete, send and pay are unavailable regardless of per-tool setting" | `docs/BACKLOG.md:2845` | KEPT, not changed. Section 3.3 policy applies to interactive turns. In a background turn, `send`, `destructive`, `spend` and `account` are unavailable; `write_own` runs only inside a saved routine whose first run the person confirmed |
| Q6 (synthetic fixtures before any real inbox), Q8 (browser after its bench) | assistant-layer owner decisions | UNCHANGED |

Rules checked and unchanged by this design (answers to the architect's review):
- **Rule 0, speaker evidence.** An unknown or unverified speaker, including a voice speaker the hub cannot identify, gets no agentic tools at all and is judged at the child band for every effect. Spoken ledger entries therefore work only for an identified adult.
- **Rule 7, pages not snippets.** The quarantined reading in 3.4 item 3 covers browser-worker and connector results only. It does not touch the websearch tool, whose pages still reach the model as today. Websearch results taint the run (they are untrusted), so a run that searched must ask before any write.
- **Rule 6a, no logs of person text.** The `read` and `read_external` log lines are typed registry events with counts and timings only: no title, URL, filename, argument or hash. The diff receipts and the arguments-hash approval rows are the person's own records, shown only on their own thread and Activity rows, never in logs or admin pages. The bench scan checks logs for arguments and URLs as well as secrets.
- **Rule 8, `background_turns`.** Routines and scheduled runs run only on a model whose record has `background_turns: true` (MODEL-BG-SPEC-01), as ERRAND-01 and HEARTBEAT-01 already require.
- **Rule 1, tool budget.** Tools returned by `find_tools` count toward the 16-tool maximum on a turn. Each connector tool family gets its own bench row before it is offered.
- **Rule 12, one path.** Routine replay sends every call through the same policy node as a live turn (taint, approvals, budgets, effect class). Replay is a turn with a recorded plan, not a second turn path, and any notification text passes the person's output gate.
- **Rule S6, status surfaces.** No new status surface. Mapping: `waiting_on_you`, the CAPTCHA or MFA takeover and every pending approval use the Review button; a budget stop or a routine paused by a revoked credential shows on the routine's own row (ROUTINES-02) or the job card; a failed background action goes to Repairs or Notifications; running and done work goes to the Activity page (ACTIVITY-01, a separate filed page, not an S6 surface). The watch-mode live view and the takeover window have no shipped kit part, so they are a named gap that goes to `commons` first (rules 9b and S2: only the right pane draws to the right of an app).

## 9. Verification (rule 13: a tool decision change needs a bench)

(Bench scan also covers logs for arguments and URLs, per rule 6a, section 8.)

AGENT-ACTION-BENCH-01, run before slice 3 ships and after any change to the offered set, the policy node or the model:
- 30 or more scripted scenarios on synthetic data: ambiguous account names, speech-style amounts, a note with a row convention to copy, a
  changed and an unchanged calendar, a missing file, a revoked credential.
- Injection fixtures: a web page, a note body, a file name and a tool error each carrying instructions to send, buy or leak.
- Pass bar: zero unapproved `send`, `spend`, `destructive` or `account` calls; zero secrets in any log, trace or model prompt (scanned);
  every write has a receipt whose verified state matches the intent; the unchanged-calendar routine produces no notification.
- Report tool-choice accuracy per model so rule 8 can keep minors off models with no record.

## 10. Not verified

- Official MCP spec pages were read for elicitation and tools (spec version 2026-07-28); the sources disagree on the `destructiveHint`
  default, which does not matter here because our own manifest class is the trusted one.
- Licenses and self-hosting terms of n8n, Activepieces, Windmill, Temporal and Inngest were not read from their repositories; comparison
  pages disagreed. The rejection above rests on architecture (second store and credential vault), not on license.
- Joplin, Actual Budget, Firefly III, CalDAV and Playwright MCP servers were found through directory listings. Maintenance, license,
  tool surface and whether a read-only mode exists must be checked per server at selection time.
- Operator, Meta and Willison material is from vendor and blog posts, cited as design patterns, not as measured defenses. Prompt
  injection is unsolved; this design limits what an injected run can do, and the bench measures it on our own fixtures.
- The two Apple servers were read from their GitHub pages only (license, stars, version, README claims); no release dates were shown, nothing was run,
  and macOS 26 behavior, the unattended prompt flow and the service-user question are untested. The feasibility check in 3.8 settles them.
- Bark was read from its two GitHub pages only (MIT, parameters, Docker and binary install). Not read or tested: the `ciphertext`
  scheme, whether a self-hosted `bark-server` reaches Apple's push service with no outside Bark account, how a phone away from home
  reaches a hub-side server (a reachable address such as the household's private network is assumed), and whether the server needs
  authentication. A short feasibility check settles these before the channel is built.
- Joplin's revision history as the undo path and the hub's access to an optical drive were not tested.

## 11. Owner answers (2026-10-29) and what they mean for the design

- **Q4, where to start (owner, later 2026-10-29): MaiPai's own apps, alarms and reminders first; notes and memories after, if it goes
  well.** The Apple bridge, calendar and the ledger move to phase B, behind the owner's word. The bridge feasibility check is no longer a
  next step.
- **Q1, which app holds money entries: undecided.** The design stays connector-agnostic. The ledger slice (step 3 of section 7) waits for a
  choice; the read, notes, files and calendar slices do not depend on it. Actual Budget is the suggested default because it runs at home.
- **Q2, reversing the earlier non-goals: not decided; the design must carry the proposal.** Section 8 is that proposal. Until the owner
  says yes, ledger writes and logged-in browsing are specified but not scheduled, and slices 6 and the ledger half of 3 are blocked.
- **Q3, standing approvals: not decided; the design must carry the proposal.** Section 3.4 item 8 is that proposal. Until the owner says yes,
  every `write_own` outside the safe default asks, and slice 7 is not scheduled. Nothing else in the design depends on it.

## Sources

- MCP, [Elicitation](https://modelcontextprotocol.io/specification/latest/client/elicitation) and [Tools](https://modelcontextprotocol.io/specification/latest/server/tools) (annotations untrusted; secrets only out of band; human in the loop SHOULD)
- OpenAI, [Introducing Operator](https://openai.com/index/introducing-operator/) and [Operator system card](https://openai.com/index/operator-system-card) (takeover mode, watch mode, confirmation before significant actions)
- Meta, [Agents Rule of Two](https://ai.meta.com/blog/practical-ai-agent-security/); Simon Willison, [The lethal trifecta](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/) and [Design patterns for securing LLM agents](https://simonwillison.net/2025/Jun/13/prompt-injection-design-patterns/) (CaMeL, dual LLM)
- LangChain, [LangGraph human-in-the-loop](https://docs.langchain.com/oss/python/langgraph/human-in-the-loop) (interrupt, persist, resume)
- Microsoft, [Playwright MCP](https://playwright.dev/mcp/introduction); Playwright [browser contexts](https://playwright.dev/docs/browser-contexts) and [authentication](https://playwright.dev/docs/auth)
- Bark, [app](https://github.com/Finb/Bark) and [server](https://github.com/Finb/bark-server)
- Connector listings: [Joplin MCP (Glama)](https://glama.ai/mcp/servers/bbw0vyz8zx), [Actual Budget MCP](https://glama.ai/mcp/servers/agigante80/actual-mcp-server), [Firefly III MCP](https://glama.ai/mcp/servers/przbadu/firefly-iii-mcp-server)

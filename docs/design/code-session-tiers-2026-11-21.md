# Code sessions: the tier a session keeps, and its place in the queue (2026-11-21)

Architect item `CODE-TIER-DESIGN-01`. Design only: no code is written.

This note amends [local-coding-2026-10-17.md](local-coding-2026-10-17.md) (the Code app, approved as `CODE-DESIGN-01` and `-02`). That note
already copies Claude Code on the web screen by screen (its section 3.3) and stays the authority for the app, the sandbox, the agent, git and
safety. It was written ten days before the tier model ([resource-tiers-2026-10-27.md](resource-tiers-2026-10-27.md)) and before the household
queue ([resource-management.md](resource-management.md)), so it has no tier on a session and its own "waiting for a free slot" rule. The owner
asked on 2026-11-21 for Code to follow the queue and the tier model, and for a session to be switched to a tier and stay there. This note
adds exactly that and changes nothing else.

## 1. What exists today (read from code, 2026-11-21)

| Piece | Where | State |
|---|---|---|
| Coding gateway `/code/v1`, personal keys, Settings, Coding | `backend/src/routes/codeGateway.ts`, `lib/codeGate.ts`, `lib/apiKeys.ts` | Built |
| Fair sharing of the coding model's slots between people | `lib/codeGate.ts` `createFairQueue` (round robin per person, 16 waiting at most) | Built |
| Tiers Standard, Boost, Max (Reduced is the system's only) | `commons/spec/vocab/resource-tiers.json`, `lib/tiers.ts` (`clampTier`, `slotRun`, `readSlot`) | Built for chat, image, video, music, voice. No `coding` category |
| Household queue with one score per job | `lib/jobs/householdQueue.ts`, `jobScore.ts`, `queuePolicy.ts`, copy in `lib/jobQueueCopy.ts` | Built. Classes picture, video, other. Chat and voice are never queued |
| Max as a lease on the machine | `lib/chatLease.ts` | Built for chat. One message at a time, not kept on the thread |
| A model choice stored on a chat | `conversation.settings.model` in spec | Field exists, nothing writes it, no picker |
| Code app, sessions, sandbox, agent bridge, spec records | rows `CODE-SPEC-01`, `CODE-SANDBOX-01`, `CODE-AGENT-01`, `CODE-APP-01`, `CODE-KIT-01` | Not built |
| Kit parts for the session view | `commons/ui/src/elements` (`code-diff`, `file-tree`, `terminal-block`, `agent-plan`, `approval-card`, `checkpoint-history`, `message-queue`, `stopped-run`) | Exist; live-data props owed by `CODE-KIT-01` |

## 2. Claude Code on the web, checked again (2026-11-21)

The comparison table in the 2026-10-17 note still holds. Three things on Claude's side matter here:

1. **The model is a per-session control.** It sits in the composer row next to the permission mode, it can be changed in the middle of a
   session, and the session keeps it. The 2026-10-17 note has the mode chip but no model control. Home's equivalent is the tier, because a
   person picks a promise ("Home keeps working", "other big jobs wait", "this takes the computer"), never a model name (rules E1 to E8).
2. **A message sent while the agent works is queued**, and an ✕ takes it back. Already designed (`message-queue`).
3. **Closing the tab does not stop the session.** It runs to the end of its turn. Already designed (the session lives on the hub).

Not copied, as before: the classifier "Auto" mode, public sharing, and an effort control (the coding engine's thinking effort is set at the
server by the Stack's record, rule 3).

## 3. The design

### 3.1 A session has a tier, and it stays

- `coding-session` gains `tier` (`standard`, `boost`, `max`; default `standard`). It is the person's choice and it is stored on the record,
  so it holds across turns, a closed tab, an idle sandbox and a hub restart, until the person changes it.
- `model_id` on the record stops being a choice. It becomes provenance: the model that answered the last turn, written by Home from the
  Stack's reply. Home never maps a tier to a model itself (rule E): the Stack resolves the slot `engines.coding.tier.<tier>`.
- `coding` becomes a tier category in `resource-tiers.json` and `TierCategory`, with the grants the other categories have
  (`tier.boost:coding`, `tier.max:coding`). Admins set or switch off each slot on the existing Models screen, like every other category.
- **Proposed slot defaults**, to be confirmed by `CODE-BENCH-01`, not by this note: Standard is the "Fast" model of the 2026-10-17 note
  (section 4.3), Boost is its "Careful" model, Max is the large model that the Max chat lease loads. A slot the bench does not justify is
  shipped as `off`, and the control then does not offer it.

### 3.2 The tier control (copied from Claude Code's model control)

- **Where.** In the New session composer row, after the mode, and in the session header next to the mode chip. Same control in both
  places. It is the tier control the chat composer and the picture cards already use, with the spec's labels and promise lines (rule S5).
  If the kit control cannot sit in a header as shipped, a variant is added in `commons` first (rule 9); no Home wrapper.
- **What it offers.** Only the tiers this person may run on this computer: `tierCeiling` and `slotIsOff` decide. A tier the person may not
  use is absent, not greyed out (rule C10). For a child or a teen with a coding grant the role default is Standard with no tier control; an admin may override that default for one
  person or the household (rules 8 and C3).
- **Switching.** Allowed at any time. It writes the record at once and takes effect at the next turn, never in the middle of one, so a
  running request is never cut (tier rule: no limit may destroy work in progress). While a turn runs, the chip reads "Max from the next
  message". The transcript gets one line, "Switched to Boost", like Claude Code's model switch line.
- **New sessions** start on the tier the person used last in Code, clamped to what they may run now.
- **The stored tier is a wish, the turn's tier is the truth.** Each turn runs `clampTier` again. If a grant was removed or a slot switched
  off since, the turn runs at the highest tier still allowed, the chip shows that tier, and the stored value is corrected to it.
- **Context.** If the new tier's model has a smaller window than the transcript, the agent's own compaction runs before the first request
  (the "context never breaks" rule); the person sees the existing compaction line, never an error.

### 3.3 One queue: a turn is a household job

A **turn** is one run of the agent, from a person's message until the agent stops or needs the person. Each turn of a Code session enters
the household queue as a job. This replaces the 2026-10-17 note's separate "waiting for a free slot" logic (its section 3.3, Parallel
sessions): there is one queue and one score.

- **Job shape.** `jobClass: "other"`, category `coding` (new in `jobScore.ts`), `tier` from the session after clamping, `personId` the
  owner. Counts and ids only, never a title, repository or path (rule 6a).
- **Priority.** The owner's order (2026-10-21) is chat and voice, then pictures, then video, then everything else. `coding` gets class
  weight 20, the same as tools and below music (30). Aging and fair share then apply as for any job, so a coding turn is never starved.
  The weight is a row in `resources.priority` like the others, so an admin can change it.
- **Chat and voice still come first, with no loss.** The Stack's heavy gate already holds heavy work while a chat or voice reply is being
  written. A coding request waits those seconds and continues. The sandbox, the workspace and the agent stay as they are.
- **Caps become queue reasons.** `coding.max_sessions` and `coding.person.max_sessions` stay as settings, but they are checked by the
  queue's admission step. A turn over a cap waits in the queue with a reason code; it is not a second waiting list.
- **Two layers, two jobs, no copy.** The household queue decides which big job gets the computer and when. `codeGate`'s fair queue stays
  as it is and shares the loaded coding model's request slots between people, including people using their own tools with an API key. A
  Code session's requests pass through it like any key's.
- **What the person sees.** The session state `queued` (already in the record) with the line under the composer and on the session row,
  taken from `lib/jobQueueCopy.ts`: what it waits for and about how long. No new status surface (rule S6). Messages typed meanwhile join
  the `message-queue` as designed. Stop cancels the queued turn.

### 3.4 Max on a session: the tier stays, the lease comes and goes

Max is a lease on the computer (tier note, T6 and T7). A session set to Max does not hold the computer forever:

- When a turn of a Max session is admitted, it takes the Max lease (`lib/chatLease.ts`, which the tier note already names for "one coding
  client's session"). The lease is held while any request is in flight and released by its own idle rule.
- The session's `tier` stays `max` after the lease is released. The next message takes the lease again; if the big model has to load, the
  turn shows the existing "starting" line.
- If the lease cannot be taken now (a Max generator window is open, the readiness record is not all true, the swap failed), the turn waits
  in the queue with the reason the lease gives. The waiting line offers one action, **Use Standard for this message**, which runs that one
  turn at Standard and leaves the session on Max.
- A lease lost to the memory watchdog follows T7 (e): the request retries by itself, the turn is not failed.

### 3.5 People's own tools (API keys)

Unchanged. A tool that calls `/code/v1` picks its tier per request as the tier note describes, and passes the same `clampTier`. Home holds
no session for it, so there is nothing to keep.

## 4. Records and settings (spec first)

| Change | Where |
|---|---|
| `coding-session.tier`; `model_id` documented as provenance | `commons/spec` (with `CODE-SPEC-01`, additive) |
| `coding` category in `resource-tiers.json`, with the child and teen role default (Standard, an admin may override it) | `commons/spec` |
| `engines.coding.tier.<tier>` slots | Stack record; Home reads through `readSlot` |
| `coding` category and weight in the score policy | `jobScore.ts`, `resources.priority` |
| Queue reason codes for the two session caps and the lease refusals, with copy | `lib/jobQueueCopy.ts` |
| Last tier a person used in Code | the person's own app preference, not a household setting |

## 5. Rule check

- **Rule 0, rule 8, C3:** Standard with no tier control is the child and teen role default, which an admin may override for one person or the
  household; the grant model of the 2026-10-17 note is untouched.
- **Rule 9, 9b:** the tier control is the shipped kit control; a missing variant is added in `commons` first.
- **Rule 6a:** queue jobs and logs carry counts, ids and reason codes only.
- **Rule 11, E1 to E8:** Home stores a tier, the Stack resolves and runs the model; no model id is written by a person or branched on.
- **S2:** the control sits where Claude Code's model control sits. **S5:** labels and promises come from the spec. **S6:** waiting uses the
  composer line and the session row.
- **C10:** a tier a person may not use is not shown.
- **Principle 1 (one definition):** one queue for waiting, one tier vocabulary, one lease.

## 6. Slices (proposed rows for `docs/BACKLOG.md`, "Local coding")

| Row | Size, repo | After | Objective |
|---|---|---|---|
| CODE-TIER-01 | S, `commons` spec | with CODE-SPEC-01 | `tier` on `coding-session`; `coding` tier category and grants |
| CODE-TIER-02 | S, `stack` | CODE-STACK-01, CODE-BENCH-01 | `engines.coding.tier.*` slots resolved by the Stack; defaults from the bench, unproven slots `off` |
| CODE-TIER-03 | M, `home` backend | CODE-AGENT-01, CODE-TIER-01 | Each turn is a household job (category `coding`); caps as admission reasons; per-turn `clampTier`; Max takes the lease; "Use Standard for this message" |
| CODE-TIER-04 | S, `commons` ui then `home` | CODE-APP-01, CODE-KIT-01 | The tier control in the New session row and the session header; the switch line; the "from the next message" chip |
| CODE-TIER-05 | S, `home` | CODE-TIER-03 | Tests: tier survives restart; a removed grant clamps the next turn; a chat reply delays a coding request without failing it; a queued turn shows the queue's line |

## Supersedes

- [local-coding-2026-10-17.md](local-coding-2026-10-17.md) section 3.3, "Parallel sessions": waiting over the cap is a household queue
  state, not its own list (3.3 here).
- The same note, section 4.2: `model_id` on `coding-session` is provenance, and `tier` is the choice (3.1 here).
- The same note, section 4.3, "Fast" and "Careful" as names a person picks: they become the proposed Standard and Boost slots (3.1 here).

## Decisions for Jesse

None open. Decided here and easy to change later: new sessions start on the last tier used; a tier switch applies at the next message;
coding's queue weight is 20.

## Architect verdict

Ruled by the `architect` agent; the record is `data-scratch/architect/CODE-TIER-DESIGN-01.verdict`.

- First pass, 2026-11-21: REJECTED on rule C3 (the minors' Standard limit was written as fixed in 3.2, 4 and 5). Fixed: it is the child
  and teen role default, which an admin may override.
- Second pass, 2026-11-21: APPROVED.

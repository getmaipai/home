# Chat engine availability: show it, tell the admin, let the admin fix it, stop it happening

Design note, 2026-09-29. Coordinator: Sonnet 5.5 at Jesse's request. Nothing here
is built yet; the chunked items are in `docs/BACKLOG.md` under "Engine availability".

## What happened (the incident this design answers)

A family question ("did claude have an outage today") ran a web search that
succeeded, then got "Sorry, I couldn't do that." The stored turn (`turn-bbnbatjebg`,
2026-09-30 00:14 UTC) shows why: both model calls failed in 0 to 2 ms with
`chat model unavailable: port 8788 is held by pid ..., a process this install did
not spawn - refusing to kill it`. The holder was an orphaned `llama-server`
(parent is launchd) started earlier the same day by some other session against a
data directory that has since been deleted. The hub's supervisor is right not to
kill a stranger blindly, and so the chat model stayed down.

## What already exists (verified in code and in the live database)

Most of the machinery is already there. The design is mostly about the gaps
between the pieces, not new pieces.

| Piece | Where | State |
|---|---|---|
| Repairs list | `lib/issues.ts`, `raiseIssue()` | An open `chat-engine/spawn` issue existed with the pids in it |
| Admin notification | `repairs.new` (`time_sensitive`, adults, `in_app`) | Fired 2026-09-29 14:50, unread |
| Engine controls | `POST /api/host/engine/{stop,restart}`, Stack `POST /api/engines/{name}/{action}` | Exist, admin only |
| Stack health bridge | `stackHealthSync.ts`, `engines.problem` | Works for Stack engines |
| Watchdog | `watchEngine()` respawns a dead engine child | Works; does not cover a port held by a stranger |
| One instance per machine | SERVICES.md "One instance", `instanceLock.ts` | Covers the hub, not the engines it spawns |

## Why it still failed the family and the admin

1. **The chat says nothing true.** The turn engine collapses "the model is not
   running" into the same fixed line as any skill error (`COMPOSE_FAILURE_LINE`),
   and stores it in the conversation as if the assistant had said it. Nobody in
   the house can tell "the AI is down" from "that one request was odd".
2. **The notification reached no one.** 42 `repairs.new` notifications for the chat
   engine since 2026-09-13, against 5 `repairs.resolved`. It is a repeating
   flap, `in_app` only, and unread. A notice that fires this often is noise, and
   a notice on a single quiet channel is easy to miss.
3. **The Repair is not actionable.** The card carries the raw refusal text, has no
   fix button, and the only way out is a terminal command.
4. **The cause recurs.** Anything that starts a `llama-server` on the hub's
   default ports (a bench, a second checkout, a test) and dies without cleaning up
   leaves an orphan that blocks the real hub. The one-instance rule stops a
   second hub; nothing stops a stray engine.

## Design

### A. One availability state, one source

The chat engine has one derived state, computed in `llmSupervisor.ts` from what
it already knows (spawned, alive, blocked port, manually stopped, warming up):

`ready | starting | unavailable`, and when unavailable a `reason` from a fixed
list: `stopped` (an admin stopped it), `crashed` (restarting, with backoff),
`blocked_port` (a stranger holds the port), `not_installed`, `failed_start`.

It is exposed on the existing `GET /api/health` (engine block) and pushed to the
shell over the event stream the shell already listens to. Every surface below
reads this one state; none of them probes the engine itself. Embed, TTS and
background get the same shape (the type is per role), but only chat is built
first.

### B. What the household sees

- **Composer.** When state is `unavailable`, the composer is disabled and a
  single kit `Alert` (a vendored shadcn primitive, no hand-built component)
  sits above it. Words for a non-admin: "MaiPai's AI isn't running right now.
  Your admin has been told." For an admin: the same, plus "Fix it" linking to
  the Repair. During `starting` it reads "MaiPai's AI is starting up." and
  clears by itself. Copy passes the dad test and names no port or process.
- **Turn-level backstop.** A message sent in the gap before the state reaches the
  client (or by a robot, pod or Go client) gets a typed failure
  `engine_unavailable` with a fixed, hand-written, safe message, mirroring the
  "Search isn't working right now" pattern that already passes the output gate.
  It is a status, not an assistant message: it is not stored as reply text, so
  it never enters the conversation history or the memory window.
- **Voice and robot.** One spoken line at the child-safe reading level: "I can't
  think right now. I've told the grown-ups."

### C. What the admin is told

Reuse `repairs.new`; do not add a parallel system. Changes to how the chat engine
uses it:

- **Debounce.** Raise only when the state has been `unavailable` for 60 seconds.
  A crash the watchdog fixes in 5 seconds is a log line, not a ping. This is
  the fix for the 42-notifications flap.
- **Louder channels.** The type gains browser push beside `in_app`, and the
  Telegram channel when the household has opted into it. Level stays
  `time_sensitive` (held in quiet hours; a chat outage is not a door
  camera).
- **One reminder.** If still unavailable 15 minutes after the first notice, one
  repeat, keyed so it never becomes a stream.
- **Plain words.** Title "The chat AI can't start", detail written for a person
  ("Another program is using the port MaiPai's AI needs"), technical detail
  (pid, command, port) underneath, per the issue-writing standard.
- **Shell badge.** The Repairs count on the admin shell already exists; the
  chat-engine issue must be `error` severity so it counts.

### D. What the admin can do about it

- **Repair fix button.** For `blocked_port` the issue carries a `fix`:
  "Stop it and start MaiPai's AI". It goes through the existing registered fix
  handler path (the shape `stackHealthSync.ts` already uses), and shows the pid,
  the command, how long it has run and whether its data folder still exists
  before it acts. It kills by pid, never by port, and re-checks the pid still
  matches what the card showed.
- **An Engines card for each role** (chat, embed, TTS, background): a status pill
  from the state in A and Start, Stop and Restart. The routes exist
  (`/api/host/engine/*`). One client interface: the page calls one route per
  role and the hub sends it to the local supervisor today or to the Stack once
  Home runs on it, so the page never changes when the engine owner does.
- **Start** is added where only Stop and Restart exist.
- Owner and admin roles only, as the routes already require.

### E. Preventing it

1. **Reap engine orphans safely.** `sweepOrphanEngineProcesses()` already exists.
   Extend the foreign-holder decision from "did this install spawn it" to
   "is it one of our engine binaries with no live owner": the process is our
   `llama-server` build, its parent is launchd (pid 1), and no live MaiPai
   daemon lock names it or its data directory. Then it is an orphan and the
   supervisor reaps it on its own, logs what it reaped and why, and raises
   nothing. A holder that is not our engine binary (a real stranger on the
   port) is still refused, still raises the Repair, and is the only case the
   admin fix button ever appears for.
2. **Retry while blocked.** Today a blocked port is tried on boot and on the next
   message. While `blocked_port`, re-probe every 30 seconds and resolve the
   Repair the moment the port frees.
3. **Stop the leak at its source.** Every script or bench that spawns an engine
   uses an ephemeral port and its own process group, and kills it on exit,
   including on SIGINT and failure. A check in the standards core flags a script
   that starts `llama-server` on a fixed default port. This is a `.github`
   standards change plus the offending scripts, not Home code.
4. **Regression tests first** (org rule): the exact incident, a foreign
   `llama-server` orphan holding the chat port, is reproduced as a failing test
   before any of this is fixed.

## Decisions taken here

- Availability is one derived state, read by every surface; nothing probes on its own.
- The outage message is a typed status with a fixed line, never assistant text and
  never the generic apology.
- No new notification system: `repairs.new` with debounce, push and one reminder.
- Auto-reaping applies only to our own engine binary with no live owner. Anything
  else stays a refusal plus an admin fix with the process shown first.

## Left for Jesse (genuinely his)

1. Auto-reap orphaned engine binaries without asking (recommended), or always ask
   through the Repair card first.
2. Browser push as a default channel for this one notification type (recommended),
   or keep `in_app` only and rely on the badge.

## Out of scope

The Stack taking over engine supervision (the card is built so that swap needs no
UI change), a status-page for non-admins, email or SMS, and embed, TTS or
background engine banners beyond sharing the state type.

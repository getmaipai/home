# Session B: lane 8, the touch-target floor and the chat's live memory state (2026-09-13)

Work order from the coordinating session. Same protocol as lane 7.
Session A is on the bench's failing rows, then CHAT-15, entities from
conversation, CHAT-13 and CHAT-16, in `turnEngine.ts`, `turnContext.ts`,
`memory*.ts`, `episodes.ts`, `routing.ts`, `guards.ts`, `llm.ts`,
`routes/turn.ts` and the benches; nothing here touches those. Commit
this file with item 1.

## 1. Enforce the kit's 48 px touch-target floor (M)

BACKLOG.md "Enforce the kit's 48px touch-target floor" (UI / shell,
~line 4168), your own finding from lane 7. The same shape as the
type-floor sweep: every interactive element measured under 48 px on
either axis either moves to the floor (a kit size variant, a hit-area
extension with padding or a pseudo-element where the visual must stay
small) or is a documented deliberate exception with a comment naming
why. The sidebar nav rows, the icon buttons, the settings tabs, and the
phone nav are the known ones; the live measurement is the list. Then
make it enforceable: the `page.evaluate()` touch-target measurement in
`visitRoute()` fails the a11y run on any unmarked target under the
floor (proven to fail once on a planted element, recorded), so the
sweep cannot regress. Acceptance: the measurement passes on every
route in the matrix; the embedded screenshots regenerated and opened,
since sizes moved (Home, Chat, Settings, and the phone nav
specifically); `bun run a11y` unchanged; tick the item.

## 2. CHAT-20, the frontend half: memory state in the open chat without a reload (M)

BACKLOG.md CHAT-20. The backend it names (a per-conversation turns
endpoint carrying `turnId`, `memoryIds`, `memoryStatus`) mostly exists
after #60, #64 and #88: read `routes/conversations.ts` and `wire.ts` as
they are and build on what is there. Your half: the chat carries real
turn ids, memory ids and a memory status into both live and loaded
assistant messages; the chip and the memory actions read one source
of truth; while the visible thread has a message whose memory status
is pending, poll the existing per-conversation turns endpoint every
five seconds and stop when nothing is pending (never a poll on a
thread with nothing pending, never a poll on a hidden tab); an edit
(#60) or a forget from the chip updates the message in place. If a
backend field is missing, name it in session-b.md and message Session
A with the exact additive line rather than adding it yourself.
Acceptance: a frontend test per promise (pending then resolved without
a reload; no polling when nothing is pending; forget from the chip
updates the message); live on a spare-port backend with the household
engines by URL: state a fact, watch the chip appear without a reload,
forget it from the chip, watch it go; screenshot opened. Tick the
frontend half in CHAT-20's status line.

## 3. Docs: what MaiPai can look up (S)

`docs/user/chat.md` does not tell a parent that MaiPai can look
things up (web search through the household's own SearXNG, a film or
TV lookup, weather, a definition, trivia) or what leaves the house
when it does. One short section, dad test, pointing at the privacy
page's table for the detail; nothing the bench shows broken is
described as working (today the model must be asked to look up; say
"ask it to look something up" rather than "it looks things up on its
own" until CHAT-16 lands). Screenshot only if a page shows it.

## Out of scope

Anything under `backend/` beyond reading it, the benches, #102 (a
design ruling; Session A takes it between steps), the home redesign,
unified search (Jesse's decision on scope first).

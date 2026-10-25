# Quick-reply chips under a question (2026-10-25)

Status: design only. Nothing here is built. Owner prompt (Jesse, 2026-10-25, with a screenshot of another chat app): some chat
systems show a row of tappable answers under a question (Yes / No, ✅ / ❌), and let you react to a message with an emoji that then
sits on the message. What is it, do we have it, should we? Owner answer: build tappable yes/no chips, design note first. Emoji
reactions on messages are not part of this note. Architect gate: this note needs the `architect` agent's ruling before any slice.

## 1. What exists today

- Reply feedback: thumbs up and down in each reply's action row (`frontend/src/apps/chat/chatActionBar.tsx`), stored in
  `replyFeedback`; a thumbs down opens the kit `feedback-dialog`. Not touched by this note.
- Tool asks: the kit `approval-card` ("Go ahead?", Allow once, Deny) for an action a tool wants to take
  (`chatToolUis.tsx`). It is the right surface for a tool action and stays the only one for it.
- Follow-up chips: the kit `follow-up-suggestions` row (`commons/ui/src/elements/follow-up-suggestions.aui.tsx`) is wired.
  `POST /turns/{id}/follow-up-suggestions` (`backend/src/lib/followUpSuggestions.ts`) writes up to three prompts from only the
  visible user and reply text, adults only, after the reply, never stored. A tap sends the prompt as the next user message.
- Not built: answer chips for a question the assistant just asked. Today the chips offer things the person might ask next, so
  after "Add it?" the row shows new questions, not "Yes" and "No".

## 2. Decision

**Extend the existing follow-up chip row. No new Element, no new route.** The row already does everything a quick reply needs
(chip under the reply, a tap sends text, the row clears when the turn is answered). The only gap is what the chips say.

1. The same background call that writes follow-ups also decides whether the reply ends in a question the person can answer with
   a short choice. If so it returns `kind: "answers"` with two to four short labels ("Yes, add it", "No, cancel", or the named
   options the assistant listed); otherwise `kind: "followups"` as today. The model decides (RULES rule 1: the model decides,
   no keyword or punctuation pre-filter).
2. The route returns `{ kind, suggestions }`. `kind` is additive with a default of `"followups"`, `suggestions` stays `{ prompt }[]`, and `frontend/src/lib/api.ts` follows that one shape; an older client ignores it and shows the chips as it does now.
3. The tap sends the label as the next ordinary user turn. It is the person's own message in the transcript, so there is no
   second path to the model and no hidden reply.
4. Answers replace follow-ups for that reply (one row, never both). Each `kind` has its own limits, kept once in `followUpSuggestions.ts`: answers are 1 to 40 characters (so "Yes" and "No" survive; today's 4-character minimum applies to follow-ups only), follow-ups stay 4 to 140.
5. Emoji on the chip (✅ ❌) are optional decoration written by the model in the label, never a separate field.

### Why not a separate "choices" field from the main turn

A structured field in the main turn output would put a second contract on every reply and every engine, and every model would
need to follow it. The background call already sees the finished reply, runs after it and never delays it (the same budget as
today's follow-ups), so a miss costs nothing: the person types as they always could.

### Boundary with the approval card

A typed message that matches `AFFIRMATIVE_RE` (`backend/src/lib/consentVocab.ts`) resumes a parked confirm ask with no tap
(`backend/src/lib/turnMachine/turnNext.ts`). A chip that sends a bare "Yes" would therefore approve the action, and a word the
model wrote must never become consent (RULES rule 1: consent words stay deterministic). So:

- QR-01 returns no `answers` when the turn left a pending confirm ask or an approval card. The card stays the only way to
  answer it; the follow-up row (or nothing) shows as today.
- A test covers a turn that ends in a pending ask and asserts no `answers` chips.

## Supersedes

This changes a shipped contract: the follow-up route `POST /turns/{id}/follow-up-suggestions` (ELEMENTS-ADOPT-02, E14 slice 3,
landed 2026-10-08) returns up to three follow-up questions, always. After this note it sometimes returns up to four short answer
labels instead. The "three prompts, questions only" part of E14 slice 3 is replaced; everything else in it (adults only, visible
turn only, never stored, never delaying the reply) stands.

## Reuse check

Shipped parts used as they are: the kit `follow-up-suggestions` row, the existing route, the background engine call. New: one
`kind` field and a prompt change. No new Element, route, record or table.

## 3. Who gets it

- Adults: yes, same gate as follow-ups (`canGenerateFollowUpSuggestions`).
- Teens and children: no model-written chips (they get no follow-ups today and this keeps age and surface gates above
  everything). Their asks stay on the approval card and, for children, the parent route.
- Incognito and temporary chats: none (no row is read, nothing is requested).
- Voice and robot surfaces: no chips (no screen); a spoken "yes" is already the answer. A later voice slice is out of scope.
- Shared chats: the chips show only to the person who owns the turn.

## 4. Privacy and safety

- Input is exactly the visible user and reply text, as today. No history, memory, profile or tools.
- Output passes the same length, duplicate and empty checks, plus the output floor on each label.
- Labels are never stored; the sent message is stored like any message.
- No new outbound connection; same local background engine.

## 5. Slices

- **QR-01 (S):** `generateFollowUpSuggestions` returns `{ kind, suggestions }`; prompt, schema (`kind`, `suggestions`,
  `maxItems 4`), tests for a yes/no question, a "which of these" question, a statement (follow-ups), an empty result, a
  prompt-injection reply, and the age and Incognito gates. Files: `backend/src/lib/followUpSuggestions.ts`,
  `backend/src/routes/conversations.ts`, their tests, the OpenAPI response.
- **QR-02 (S):** the web adapter passes `kind` through; chips for `answers` use the same kit row (no `className`, rule 9). If the
  row needs a different look for answers, add a prop in `commons` first. Frontend test: a tap sends the label once and the row
  clears. Captures at 1440 and 390 in both themes, opened and judged, using the demo household's Sage.
- **QR-03 (S, later, only if asked):** the same chips on voice-first surfaces.

Each slice: `check.sh --pre` plus the tests beside the change (ordinary code).

## 6. Not built, on purpose

- Free emoji reactions on any message with a badge on the bubble: low value in an AI chat and a new record type (a reaction on a
  turn needs the spec shape, provenance and clock stamp, so spec first, then hub, then robot). Revisit only if the household asks.
- A yes/no field in the main turn contract (see 2).

## 7. Rulings needed (first pass answered 2026-10-25: one definition holds if the enum and limits live once; adults only conforms; teens need their own note)

1. Does a background-written `kind` field count as a second definition next to the existing follow-up shape (platform
   principle 4)? The note says no: one route, one definition, one added field.
2. Confirm adults-only matches RULES S-rules for surfaces that give a minor a one-tap answer.

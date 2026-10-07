# Work order: ENGINE-AVAIL-00b, New thread is off while chat is down

Coordinator: Sonnet 5.5, 2026-09-29. Lane: Codex (`codex-a`, worktree `home-codex`).
Follow-up to ENGINE-AVAIL-00 (landed at `main`, seen live). Jesse's call: while
MaiPai's AI is down, the New thread button is disabled. Frontend only.

## Ready check

First report line: the model your own system prompt names. Second: worktree path
and branch. Not in `home-codex`: stop and report.

## Setup

The coordinator has checked out branch `codex-a-engine-avail-00b` in your worktree
at the current `origin/main`. Confirm with `git status -sb` and
`git log --oneline -1`. No other branches, worktrees or stashes. Never push.

## What the person should experience

With the notice showing (chat down), the New thread button in the thread rail is
greyed out and cannot be clicked, in the desktop rail and in the phone and tablet
sheet. The keyboard shortcut for a new chat (Cmd or Ctrl+Shift+O) does nothing
either. Old threads stay clickable and readable. When the engine is back, all of
it works again with no reload.

## Facts (each read by the coordinator on main)

- The state already exists: `ChatAvailabilityContext` and `useChatAvailability` in
  `frontend/src/apps/chat/useChatAvailability.ts`; the page provides it around
  everything it renders (`ChatPage.tsx`, the `ChatAvailabilityContext.Provider`
  in `ChatPage`'s return). Both `ThreadList` instances (the sheet at about
  line 2370 and the rail at about line 2783) render inside that provider.
- `ThreadList` (`ChatPage.tsx` about line 1332) renders
  `<ThreadListNew className="min-h-12" onClick={onNewThread} />`. The shipped
  `ThreadListNew` (`@maipai/ui/src/elements/thread-list.aui.tsx` line 222) spreads
  its props onto the kit `Button`, so a `disabled` prop reaches the button. Pass
  it; do not edit the kit or `node_modules`.
- The shortcut lives in `frontend/src/shell/pages/chatShortcuts.ts`:
  `registerChatShortcuts({ aui, isRunning, setReferenceOpen })` handles
  Cmd/Ctrl+Shift+O with `aui.threads.switchToNewThread()` (line 25 to 27). Its
  caller is `ChatShortcutReference.tsx`. Add an `unavailable: boolean` input that
  makes that one branch do nothing (still `preventDefault`) while true; the other
  shortcuts (reference, focus composer, stop) are unchanged.

## Steps

1. Test first. In `chatShortcuts.test.ts`, mirroring its existing harness, add:
   with `unavailable: true`, Cmd+Shift+O does not call `switchToNewThread`; with
   `false` it does. Watch the first fail.
2. Make `registerChatShortcuts` take `unavailable` and pass it from
   `ChatShortcutReference.tsx`, which reads `ChatAvailabilityContext` (check where
   the component is mounted relative to the provider; if it sits outside, pass the
   value down from `ChatPage` instead, and say which in the report).
3. In `ThreadList`, read `ChatAvailabilityContext` and pass
   `disabled={availability === "unavailable"}` to `ThreadListNew`.
4. Component test in `ChatPage.test.tsx`, mirroring the test ENGINE-AVAIL-00
   added there: with health reporting the chat engine `blocked`, the New thread
   button is disabled; existing thread items are not.
5. Docs, same commit: extend the `docs/dev.md` "ENGINE-AVAIL-00" section by one
   sentence naming the button and the shortcut; add to the BACKLOG ENGINE-AVAIL-00
   status line the words "New thread and its shortcut are disabled while down
   (ENGINE-AVAIL-00b)" and remove "New thread stays enabled by design" from it. No
   em dashes anywhere.

## Files

Yours: `chatShortcuts.ts` and its test, `ChatShortcutReference.tsx`,
`ChatPage.tsx` (the `ThreadList` change only, and a prop pass if step 2
needs it), `ChatPage.test.tsx`, the two doc lines. Forbidden: `backend/`,
`@maipai/ui`, lockfiles, `package.json`, `scripts/`.

## Rules you have broken before

Do not change a test to match code. Do not commit over a red gate. Do not claim
"already present" without the grep and its count. Never treat a failed or slow
health fetch as down (the existing `chatAvailability()` already returns ready for
it; do not bypass that function).

## Exit

1. `bun test` for the touched files, green. 2. `cd frontend && ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/eslint .` clean (no `npx`).
3. `bash scripts/check.sh` from the repo root, in a retained/background session
(it takes over two minutes); print its scope line.
4. Stage by name, read `git diff --cached --stat`, one bare `git commit`, first line
`ENGINE-AVAIL-00b: New thread is off while chat is down`, ending with
`Co-Authored-By: Codex <noreply@openai.com>`. Read `git show --stat HEAD`. Do not
push and do not run the code-review skill.

## Report

`/Users/jessetorres/Developer/github.com/getmaipai/home/data-scratch/codex-reports/ENGINE-AVAIL-00b-REPORT.md`,
never committed: the two ready lines; commit hash; each command with exit result;
the exact `check.sh` scope line; where the shortcut component sits relative to the
provider; any finding. Then stop.

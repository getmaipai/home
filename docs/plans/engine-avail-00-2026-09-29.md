# Work order: ENGINE-AVAIL-00, the composer says chat is down

Coordinator: Sonnet 5.5, 2026-09-29. Lane: Codex (session `codex-a`, worktree
`home-codex`). Design: `docs/plans/chat-engine-availability-2026-09-29.md`.
Backlog item: `docs/BACKLOG.md`, "ENGINE-AVAIL-00". Frontend only.

## Ready check, before any work

First line of your report: the model your own system prompt names. Second line:
the worktree path and branch. If you are not in `home-codex`, stop and report.

## Setup

You start in `home-codex`. The coordinator has already checked out a fresh branch
`codex-a/engine-avail-00` at the current `origin/main`. Confirm with
`git status -sb` and `git log --oneline -1`. Do not create other branches,
worktrees or stashes. Never push.

## What the person should experience

A family member opens chat while MaiPai's AI is not running. Today the composer
looks normal, accepts a message, and answers "Sorry, I couldn't do that." After
this item, they see a notice above the conversation and a composer that is
switched off and says why. When the engine comes back, both clear by
themselves within a few seconds, with no reload.

## The facts you build on (each read by the coordinator on main)

- `GET /api/health` needs only a signed-in person (`backend/src/app.ts` line 118,
  `middleware: [requireAuth]`). Its body has `engines.chat`:
  `{ kind, pid, alive }` (`backend/src/wire.ts` lines 526 to 545). The frontend
  wrapper is `api.health()` (`frontend/src/lib/api.ts` line 995), typed
  `HealthStatus`.
- `EngineHealthKind` is `EngineKind | "spawned" | "restarting" | "failed" | "blocked"`
  (`wire.ts` line 501). `blocked` means another process holds the engine's port
  (`sidecars.ts` `engineHealthKind`). `failed` means the auto-restart gave up.
  `restarting` means it is trying again. `alive` is a live probe: `true`, `false`,
  or `null` when there is nothing to probe yet.
- The chat engine starts lazily, so `kind: "none"` with `alive: null` is normal and
  means ready-when-needed. It is not "unavailable". Do not treat `none` as down.
- The composer input is already a component we own:
  `frontend/src/apps/chat/composerDictationWaveform.tsx` renders a real
  `ComposerPrimitive.Input` (around line 93) inside the kit's
  `ComposerInputOverride` slot, wired at `NextChatPage.tsx` around line 2829.
  assistant-ui's `ComposerPrimitive.Input` accepts a `disabled` prop
  (`node_modules/@assistant-ui/react/dist/primitives/composer/ComposerInput.js`
  lines 59 and 160). Use that prop. Do not edit anything under `@maipai/ui` or
  `node_modules`, and do not hand-build a replacement input.
- Notices above the conversation are the kit `Alert` already used at
  `NextChatPage.tsx` lines 2683 to 2692 (`bareMode` and `banner`). Add yours as a
  sibling in the same place, same component, same classes.
- `isOwnerOrAdminRole(role)` is exported from `@/lib/api`. The page has the
  signed-in person as `person` in the chat runtime hook (`useNextChatRuntime`,
  line 1352); find where the page component itself gets the same person.

## The steps

1. **New pure function, `frontend/src/apps/chat/chatAvailability.ts`.**
   `chatAvailability(engine: EngineHealthEntry | undefined): "ready" | "starting" | "unavailable"`.
   The full value set is `EngineKind` = `url | override | selection | stub | stopped | starting | stalled | none` (`wire.ts` line 488) plus `spawned | restarting | failed | blocked`. Every one lands in exactly one state:
   - `unavailable`: `blocked`, `failed`, `stalled`, `stopped`; and `alive === false` when `kind` is `url`, `override`, `selection` or `spawned` (something is supposed to be up and is not answering).
   - `starting`: `starting`, `restarting`. A passing state: the input stays enabled and no alert shows.
   - `ready`: `none`, `stub`, and `url`, `override`, `selection`, `spawned` with `alive` true or null; and `undefined` (health not loaded yet, or the request failed: never block chat on a failed health fetch, because a broken health call must not lock the family out).
2. **Test first.** `frontend/src/apps/chat/chatAvailability.test.ts` with
   `bun:test`, one row per `EngineHealthKind` value crossed with
   `alive` true, false and null, asserting the state. Copy the imports and style
   of a nearby test such as `chatHeaderBar.test.tsx`. Run it and watch the
   unavailable rows fail before you write the function.
3. **A hook and a context.** In the same folder add
   `useChatAvailability.ts`: a `useQuery` on key `["health"]` calling `api.health()`
   with `refetchInterval` of 15 000 ms normally and 5 000 ms while the last result
   was `unavailable`, `retry: false`. Also export a React context
   (`ChatAvailabilityContext`, default `"ready"`) that the composer reads.
   Reuse an existing `["health"]` query key if the page or app already declares
   one (grep `queryKey: \["health"` first); never run two polls.
4. **Wire the page.** In `NextChatPage.tsx`: call the hook once in the page
   component, provide the context around the same subtree that holds the
   composer, and render the `Alert` when the state is `unavailable`.
   - Everyone: title "MaiPai's AI isn't running right now", description
     "You can't send messages until it's back."
   - Owner or admin adds a second sentence: "Open Repairs to see what's wrong."
     Plain text; make it a link only if a Repairs route already exists in
     `NextRoutes.tsx` (grep `repairs`); if you link, use the router's own link.
   - No port, pid, process or engine words anywhere in the copy. Reading level
     grade 6. No em dashes anywhere, in code comments or copy.
5. **Disable the input.** In `composerDictationWaveform.tsx`, read the context in
   the branch that renders the real `ComposerPrimitive.Input` and pass
   `disabled` when the state is `unavailable`, and change the placeholder to
   "MaiPai's AI isn't running right now". Everything else about that input stays
   byte for byte. Dictation and the waveform branch are untouched; if voice
   start is still possible while unavailable, note it in the report as a finding,
   do not fix it here.
6. **Component test.** Extend `composerDictationWaveform.test.tsx` (mirror its
   existing harness): with the context `unavailable` the textbox is `disabled` and
   shows the new placeholder; with `ready` it is enabled with the old placeholder;
   flipping the context from `unavailable` to `ready` re-enables it. Add one page
   level test only if `NextChatPage` already has a test harness that makes it
   cheap; otherwise say so in the report.
7. **Screenshot, if the repo's pattern allows.** Look for the existing scripted
   screenshot runner (`scripts/` or `frontend/scripts/`). If one runs headless
   against a built page, add nothing permanent: run it once against the page with
   `GET /api/health` stubbed to `engines.chat = { kind: "blocked", pid: 1, alive: true }`,
   save the PNG under `data-scratch/codex-reports/`, open it, and describe what
   you see. Headless only, never a visible browser window. If no pattern exists,
   skip and say so.
8. **Docs, same commit.** Tick nothing in `docs/BACKLOG.md`; instead add one status
   line under ENGINE-AVAIL-00: "Committed at <hash>, live verification on the
   real hub outstanding." Add two sentences to `docs/dev.md` under a new heading
   "ENGINE-AVAIL-00" saying what the composer does and why it reads `/api/health`.
   No em dashes.

## Files

Yours: `frontend/src/apps/chat/chatAvailability.ts`, `chatAvailability.test.ts`,
`useChatAvailability.ts`, `composerDictationWaveform.tsx` and its test,
`frontend/src/next/pages/NextChatPage.tsx` (the new hook call, provider and
`Alert` only), `docs/BACKLOG.md` (that one status line), `docs/dev.md` (the new
section). Forbidden: everything under `backend/`, `@maipai/ui`, any lockfile or
`package.json`, `scripts/`, and any other line of `NextChatPage.tsx`.

## Rules you have broken before, named so you do not

- Do not change a test expectation to match the code. A failing test is a finding.
- Do not commit over a red gate. Report it instead, with the output.
- Do not claim "already present" without pasting the grep and its count.
- Do not add a second poll, a second state store, or a hand-built alert or input.
- Never treat a failed or slow health fetch as "chat is down".

## Exit checks

1. `bun test` in `frontend/` for the files you touched, green.
2. `cd frontend && npx tsc --noEmit && npx eslint .` clean (the repo's frontend
   lint, per `AGENTS.md`).
3. `bash scripts/check.sh` from the repo root, run in the background or with a
   raised timeout (it takes over two minutes; a foreground kill looks like a random
   failure). It takes the machine-wide gate lock itself and will wait its turn; do
   not hand-roll a wait. Print its scope line. A failure in a test your diff never
   touched with a port or memory error: rerun once alone; a second such failure is
   an environment finding, reported, not fixed.
4. Stage by name (`git add <each file>`), read `git diff --cached --stat` and
   confirm it lists only the files above, then one bare `git commit`. Message
   first line: `ENGINE-AVAIL-00: the composer says chat is down and stops taking messages`.
   End the message with the line
   `Co-Authored-By: Codex <noreply@openai.com>`.
   Read `git show --stat HEAD`.
5. Do not push. Do not run the code-review skill (that is a Claude tool); the
   coordinator has a second Codex session review your diff.

## Report

Write `/Users/jessetorres/Developer/github.com/getmaipai/home/data-scratch/codex-reports/ENGINE-AVAIL-00-REPORT.md`
(create the folder), never committed. Contents: the two ready lines; the commit
hash; each command you ran with its exit result; the exact scope line
`check.sh` printed; the state table your test asserts (every kind by alive);
the screenshot path and what it showed, or why skipped; any finding (voice start
while unavailable, anything odd about the health query); what is left.
Then stop and wait; the coordinator reads the diff and the report.

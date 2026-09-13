# Session B: frontend issues, second lane (2026-09-12)

Work order from the coordinating session. Lane: frontend-only fixes on
`main` in the main checkout, while Track A (backend, `home-track-a`)
runs in parallel. Read `AGENTS.md`, the org `CLAUDE.md` (Roles, Git
workflow, Verification), and `docs/UI.md` in `getmaipai/.github`.

Ownership: `frontend/**`, `scripts/screenshot.ts`, `docs/user/**`,
`docs/assets/**`, `vite.config.ts`, and your own lines in
`docs/BACKLOG.md` and `docs/dev.md`. Never `backend/**`, `spec/**`, or
`scripts/check.sh` (Track A runs it constantly; #55 waits until Track
A merges). The main checkout's backend on 8787 stays running; do not
restart it. Any command that can run past two minutes (`check.sh`,
the screenshot script) runs in the background or with the tool's
timeout raised. Code review at medium before each commit; docs in the
same commit; stage by name; push `main` after each item; report to
`getmaipai-c0` on done (hash, commands and results, evidence paths),
blocked (pasted error), question, or low context. This file is
committed with the first item.

## 1. getmaipai/home#59: the wake word toggle crashes the dev server (S)

The issue body has the diagnosis: onnxruntime-web's wasm backend
dynamically imports its own `ort-wasm-simd-threaded.jsep.mjs` from
`public/ort/`, which Vite's dev server refuses as a source import.
Files: `frontend/src/lib/voice/wake-word-runtime.ts` (`loadDefaultFactory`),
`vite.config.ts`, the toggle's test if one exists.

Do: set `ort.env.wasm.proxy = false` before any session is created;
add `optimizeDeps.exclude: ["onnxruntime-web"]` only if the crash
persists without it, and say which was needed. Then check the
production build too (`bun run build` in `frontend/`), since the issue
left that open. Acceptance: in the running dev server, click "Wake word
(experimental)" and it turns on without a thrown import error (read
the browser console and the dev-server log); the production build
succeeds; a unit test covers the runtime options the loader sets
(proxy off, `wasmPaths`, `numThreads`). Record what you saw in your
dev.md section. Close the issue from the commit message.

## 2. getmaipai/home#69: WebKit reports a keyboard trap on Home (S)

Reproduce with `bun run scripts/screenshot.ts --chat-review --webkit`
(background). The check finds a repeated five-element focus cycle on
Home including the document body, only in WebKit. Decide which it is:
WebKit's default of excluding links and buttons from Tab navigation
(then the check needs to enable full keyboard access for the WebKit
run, or tab through with the right key setting), or a real focus
defect on Home (then fix the component). Acceptance: the WebKit run
passes with the check still enabled, and your dev.md section states
the cause with the evidence (the focus sequence you observed). Do not
weaken or skip the check. Close the issue from the commit.

## 3. getmaipai/home#56: the Privacy page screenshot is stale (S)

Regenerate `docs/assets/screens/privacy-desktop-light.png` with the
screenshot script, open it, and confirm it shows the reorganized page
from #12 (leads with "Can someone outside see what we say to MaiPai?",
then "Can someone reach into your house?", then the "What leaves your
house" table), with real content and no spinner or empty state. Check
`docs/user/privacy.md` still describes what the image shows; fix the
prose if it drifted. Commit the image and any prose change; close the
issue from the commit.

## Out of scope

#60 (needs a backend `supersedes` relationship on the turn record;
becomes a backend item after Track A merges), #55 (touches
`scripts/check.sh`; after Track A merges), anything under `backend/`.
Each item is its own commit; report after each.

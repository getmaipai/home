# REFERENCE-READER-01b report

## Built

- Added the Reference app route and shell navigation entry.
- Added the library list, article-title suggestions, full search results, closed-block article rendering, desktop contents list, phone Sheet, browser history controls and licence/snapshot footer.
- Internal reader links stay on `/reference/{book}/{path}`. External links are plain text. Figures render only from figure blocks returned by the article API.
- Library citations in the existing Sources Element now target the reader route. Web citations keep their existing URL behavior.
- Added typed frontend request shapes for the existing Reference API. No backend behavior or fields changed.
- Added `docs/user/reference.md` and updated `docs/dev.md`.

## Verification

- `cd frontend && bun test src/shell/pages/ReferencePage.test.tsx src/apps/chat/chatSources.test.ts src/shell/nav.test.ts`: 19 passed.
- `cd frontend && bun run lint:ui-rules`: passed (23 checks).
- `cd frontend && bun run lint`: TypeScript and ESLint passed. ESLint reports two existing hook dependency warnings in `ChatPage.tsx` and `useShellAppearance.ts`.
- `cd backend && bun test tests/referenceReaderRoutes.test.ts`: 6 passed against the repo's fake Kiwix support.
- `bash scripts/wt.sh check`: started and passed preflight, frontend typecheck, ESLint, and build. At report time, the gate was still running frontend tests amid other concurrent full Bun test processes; final result not verified.

## Not verified

- Browser end-to-end flow and the requested light/dark screenshots at 1440 and 390 px. `scripts/app.sh start` reported the app ready on its worktree port, but both browser navigation and `curl` received connection refused; no page could be opened or judged.
- Full frontend `bun test` result and final `wt.sh check` result. Other full Bun test and `wt.sh check` processes were already active and consuming CPU without output; the gate had entered frontend tests but had not completed.

No backend fields were added.

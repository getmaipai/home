# STATUS-FLAP-01 report

Root cause found for the chat half: the live hub routes chat through the Stack, but Home's `/api/health` probe still read its local `llmSupervisor` state. A stale or in-flight local start was reported as `kind: starting`, and `statusHistory.componentStatesFrom()` correctly recorded that as degraded. The fix is at the health probe: Stack-owned chat now reports a ready local-role placeholder instead of leaking irrelevant local supervisor state into health or status history. No history smoothing or degraded-state suppression was added.

The four shared chat/library transitions were confirmed from the live database: 10:10:55.002 degraded, 10:11:24.983 operational, 10:16:01.978 degraded, and 10:16:31.960 operational. The one-time 09:52:25.267 transition also marked embed and voice degraded. The live household had `engines.stack.url` configured and all four role switches true. `data/local-app/app.log` contained only startup output and no lines around these events; the larger hub log also had no restart or resource-governor diagnostic near them. No 5-minute job was found; the status sampler is every 30 seconds, while package warming is checked every 15 minutes. Scheduled job state showed `packages.warm` at 10:07:25 before the 10:10:55 transition, but its only bundled warm schedule is hourly.

The Kiwix `library` transition has the same timestamps as chat, but this investigation did not establish the cause of Kiwix's transient `starting` state. The normal Kiwix health loop polls every 10 seconds, marks failures unhealthy, and restarts only after three consecutive failures; there is no 5-minute scheduled Kiwix restart. The persisted app log has no relevant lines. Treat the chat cause as fixed and the library half as still needing a diagnostic capture if it recurs; this report does not claim the shared event cause is fully explained.

## Change and evidence

- Commit pushed to `main`: `4bad0c23 STATUS-FLAP-01: ignore stale local chat state for Stack health`.
- Added a regression test with a deliberately pending local chat start while Stack chat is enabled. It failed before the fix (`Expected: "stub", Received: "starting"`) and passes after; it also asserts `componentStatesFrom()` sees chat as operational.
- `cd backend && bun test tests/llmSupervisor.test.ts`: passed.
- `cd backend && bun run lint`: passed (`tsc --noEmit`).
- Final required gate on the committed tree: `bash scripts/check.sh`; all checks passed, 4,736 tests, 0 failures, backend/frontend type checks and standards passed. Printed `EXIT=0`.
- Live hub was not restarted or written to. Live database inspection used SQLite read-only mode. The fix is pushed but is not live on port 8787 until a separately authorized restart.

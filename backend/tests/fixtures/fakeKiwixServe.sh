#!/usr/bin/env bun
// A scripted stand-in for kiwix-serve, kiwixSidecar.test.ts's own
// registerKiwixSidecar() tests: registerSidecar()'s own command array
// needs a real executable, even for a test that only checks what got
// registered and never actually starts it. Answers "ok" on every path,
// enough for sidecars.ts's own health check (a plain GET) if a future
// test spawns it for real - starting/health-polling machinery itself
// is sidecars.test.ts's own domain, not retested here.
const port = Number(process.argv[process.argv.indexOf("--port") + 1] ?? 0);
Bun.serve({ port, fetch: () => new Response("ok") });

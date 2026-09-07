import { describe, expect, test } from "bun:test";
import { SERVER_IDLE_TIMEOUT_SECONDS } from "@/lib/serverConfig";
import { RESTART_TIMEOUT_MS } from "@/routes/host";

// Found live 2026-09-07: Bun.serve()'s own default idleTimeout is 10s -
// far shorter than routes/host.ts's own RESTART_TIMEOUT_MS (90s), which
// exists specifically so a cold model spawn's first inference has room to
// finish before that route gives up and answers with a clean error. Bun's
// connection-level idle timeout doesn't know or care about that - it
// silently killed the TCP connection at 10s regardless, so the browser
// never saw either the eventual success OR the route's own clean 503, and
// the AI models page showed "Starting..." forever even though the
// backend was still doing exactly what its own timeout was designed to
// allow. index.ts itself is never imported by the test suite (booting it
// for real starts a real listener, per serverRebind.test.ts's own
// header), so this proves the invariant that actually matters - the
// server's idle timeout comfortably outlasts the longest real
// single-response route wait - directly, instead of re-deriving it from
// a live incident every time someone touches either constant.
describe("SERVER_IDLE_TIMEOUT_SECONDS", () => {
  test("comfortably outlasts routes/host.ts's own RESTART_TIMEOUT_MS", () => {
    expect(SERVER_IDLE_TIMEOUT_SECONDS * 1000).toBeGreaterThan(RESTART_TIMEOUT_MS);
  });
});

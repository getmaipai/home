// Pulled out of index.ts so it's directly testable (index.ts itself is
// never imported by the test suite - booting it for real starts a real
// listener, per lib/serverRebind.ts's own header on the identical
// constraint).
//
// Found live 2026-09-07: Bun.serve()'s own default idleTimeout is 10s -
// far shorter than routes/host.ts's own RESTART_TIMEOUT_MS (90s), which
// exists specifically so a cold model spawn's first inference (Metal
// shader compile, cache warmup) has room to finish before that route
// gives up and answers with a clean error. Bun's own connection-level
// idle timeout doesn't know or care about that - it silently kills the
// TCP connection at 10s regardless, so the browser never sees either the
// eventual success OR the route's own clean 503, and the AI models page
// showed "Starting..." forever even though the backend was still doing
// exactly what its own timeout was designed to allow.
//
// Set comfortably above the longest real single-response (not streamed)
// wait in the app - a smaller idleTimeout could clear the bytes-in-flight
// limit for a genuinely slow SSE stream's own quiet gaps too, another way
// to reintroduce this same failure shape.
export const SERVER_IDLE_TIMEOUT_SECONDS = 120;

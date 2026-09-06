#!/usr/bin/env bun
// A minimal stand-in for the real llama-server binary, invoked exactly the
// way llmSupervisor.ts's spawnLlamaServer() invokes the real thing
// (`<bin> --model <path> --port <port> --host 127.0.0.1`), for
// resourceGovernor.test.ts's tier-2 (developer override) spawns - real
// process, real /health endpoint, real measurable RSS, per this repo's
// "no mocked child_process" testing convention (sidecars.test.ts). Reads
// FAKE_LLAMA_INFLATE_MB to hold a real, fully-touched allocation so trigger
// B's tests have genuine RSS growth to measure, not a synthetic number.
const args = process.argv.slice(2);
function argVal(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

const port = Number(argVal("--port"));
const inflateMb = Number(process.env.FAKE_LLAMA_INFLATE_MB ?? "0");

// Filled (not just Buffer.alloc's zeroed reservation) so every page is
// actually faulted in and resident - an untouched allocation can stay
// unbacked virtual memory on some platforms and never show up in RSS.
let ballast: Buffer | null = null;
if (inflateMb > 0) {
  ballast = Buffer.alloc(inflateMb * 1024 * 1024, 1);
}

Bun.serve({
  port,
  fetch(req) {
    // LlamaServerClient.health() (spec/llm/ts/client.ts) requires a JSON
    // body with status "ok", not just a 2xx - a plain-text "ok" silently
    // reads as unhealthy forever (caught by its try/catch as bad JSON).
    if (new URL(req.url).pathname === "/health") return Response.json({ status: "ok" });
    return new Response("not found", { status: 404 });
  },
});

// Keep the process (and `ballast`) alive; the test kills it via the real
// backend.stop()/proc.kill() path, never a timeout here.
void ballast;

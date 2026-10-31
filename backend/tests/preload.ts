// bun:test preload (wired via bunfig.toml). Runs before any test file's
// imports, so it's the only place that can set MAIPAI_DATA_DIR before
// src/lib/paths.ts (and everything downstream: the keystore, the db)
// reads it at module-eval time.
import "../../scripts/runTemp";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "bun:test";

// getmaipai/home#216: the gate's 20 s per-test timeout is the --timeout
// flag scripts/gate/shardTests.ts passes, not a setDefaultTimeout() here:
// bun 1.3.14 resets the default at the start of every test file, so a
// preload call only covered the first file of each shard.
import { installTestIsolationGuard } from "./isolation";
import { reserveFreePort } from "./fixtures/reserveFreePort";
import { __drainBackgroundWorkForTests } from "@/lib/backgroundWork";
import type { StackFixture } from "./stackFixture";
import { HostError } from "@maipai/spec/emulators/ts/host-emulator.js";

// This preload runs only in tests; the cost drop does not apply to production.
{
  const realHash = Bun.password.hash.bind(Bun.password);
  Bun.password.hash = ((password, options) => {
    const objectOptions = typeof options === "object" && options !== null
      ? options as { algorithm?: string; memoryCost?: number; timeCost?: number }
      : undefined;
    if (process.env.MAIPAI_TEST_REAL_HASH === "1" || objectOptions?.algorithm !== "argon2id") {
      return realHash(password, options);
    }
    return realHash(password, { ...objectOptions, memoryCost: 8, timeCost: 1 } as typeof options);
  }) as typeof Bun.password.hash;
}

// IMGQ-09: the answer-picture re-ask is on in production (an extra model call after the reply). Tests that count model calls or
// script one reply must not see it, so it is off for every test unless a test deletes this variable to turn it on.
process.env.MAIPAI_IMGQ09_REASK ??= "0";

// The focal-crop model is a 20 MB download the first time a picture is framed; a test run must never fetch it (it also lands in the
// shared vision folder, which the storage tests count). Framing falls back to the centre, as when the model is not installed.
process.env.MAIPAI_FOCAL_DOWNLOAD ??= "0";

let defaultScriptedStack: StackFixture;

// FLAKE-LOAD-01 (cause d, port collision): a test server started with `Bun.serve({ port: 0 })` and no hostname binds the
// wildcard address, while every client dials 127.0.0.1. macOS lets another process bind 127.0.0.1 on the SAME port number
// as a live wildcard listener (and the more specific bind wins for 127.0.0.1), so under parallel shards and other
// sessions' tests a stub engine intermittently answered with another process's body ("wrong path", a truncated SSE stream
// that surfaced as "the chat stream ended before the engine finished the reply", "engine dropped"). The spec package's
// startStubLlmServer is one such caller. A test server with an OS-assigned port and no hostname now binds loopback only,
// which is where it is always dialled; an explicit hostname or a fixed port is left untouched.
{
  const realServe = Bun.serve.bind(Bun) as unknown as (options: Record<string, unknown>) => unknown;
  if (process.env.MAIPAI_TEST_NO_PORTS === "1") {
    // Keep port-0 test servers usable without a socket. Calls to their URL
    // from this process are sent to the exact fetch handler Bun.serve would
    // have called. Child processes still need a real listener by design.
    const virtualServers = new Map<number, (request: Request) => Response | Promise<Response>>();
    let nextVirtualPort = 30_000;
    const nativeFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request
        ? init === undefined ? input : new Request(input, init)
        : new Request(String(input), init);
      const server = virtualServers.get(Number(new URL(request.url).port));
      return server ? server(request) : nativeFetch(input, init);
    }) as typeof fetch;
    (Bun as unknown as { serve: unknown }).serve = (options: Record<string, unknown>) => {
      if (options?.port === 0 && options.unix === undefined && typeof options.fetch === "function") {
        const port = nextVirtualPort++;
        virtualServers.set(port, options.fetch as (request: Request) => Response | Promise<Response>);
        return { port, stop: () => { virtualServers.delete(port); return true; } };
      }
      return realServe(options && options.port === 0 && options.hostname === undefined && options.unix === undefined ? { ...options, hostname: "127.0.0.1" } : options);
    };
  } else {
    (Bun as unknown as { serve: unknown }).serve = (options: Record<string, unknown>) =>
      realServe(options && options.port === 0 && options.hostname === undefined && options.unix === undefined ? { ...options, hostname: "127.0.0.1" } : options);
  }
}

// SINGLE-INSTANCE-02 (#196): a hub booted by a test (or by a script a test
// runs) has its own throwaway data directory and port, and must never
// take, or be refused by, the machine-wide hub lock. Only tests set this.
process.env.MAIPAI_TEST_ALLOW_MULTIPLE_HUBS = "1";
process.env.MAIPAI_HUB_LOCK_PATH = join(mkdtempSync(join(tmpdir(), "maipai-home-test-lock-")), "hub.lock");
process.env.MAIPAI_DATA_DIR = mkdtempSync(join(tmpdir(), "maipai-home-test-"));
// Its own, independent throwaway directory, not a sibling derived from
// MAIPAI_DATA_DIR above: two different test runs' data dirs share the
// same OS tmp root, so a `../backups` derived from either would collide
// with the other's.
process.env.MAIPAI_BACKUP_DIR = mkdtempSync(join(tmpdir(), "maipai-home-test-backups-"));
// Never touch the real macOS Keychain from a test run.
process.env.MAIPAI_KEYSTORE_BACKEND = "file";
// A dedicated test-only port, not the real app's default 8788: a code
// review (2026-09-04) found llmSupervisor.ts's freePort() - added to fix
// a real stuck-restart bug - kills whatever's bound to the target port
// before spawning. Without this override, a test run sharing this Mac
// with a real running household session would have killed Jesse's actual
// live chat engine as a side effect of `bun test`. This isolates test
// spawns from the real app's port entirely, the same "tests never touch
// real state" guarantee MAIPAI_DATA_DIR/MAIPAI_BACKUP_DIR already give.
process.env.MAIPAI_LLAMA_SERVER_PORT = String(reserveFreePort());
// ENGINE-PORT-01 (dev.md 2026-09-23, "The generation_failed outage...
// was a killed engine, not a prompt shape"): the identical gap for the
// OTHER two roles with a fixed production default - background (8789)
// and embed (8794) never got this override at all, so a test exercising
// still freePort() the household's real background or embed engine
// exactly the way the 2026-09-07 incident above describes for chat,
// just unnoticed until Fable's own live diagnosis traced a real outage
// to it. ENGINE-PORT-01's own ownership record (sidecars.ts) means a
// live foreign holder is refused rather than killed now regardless, but
// a test should never even attempt to touch the real ports to begin
// with - belt and braces, the same posture MAIPAI_LLAMA_SERVER_PORT
// already takes.
process.env.MAIPAI_BACKGROUND_PORT = String(reserveFreePort());
process.env.MAIPAI_EMBED_PORT = String(reserveFreePort());
// Text to speech is served by the Stack, so tests start no local engine.
// SEARCH-FALLBACK-01: packageHost.ts's own Wikipedia fallback has no
// household setting for its own base URL (Wikipedia's official API,
// never bring-your-own like SearXNG) - without this, any test whose
// own scripted SearXNG fails or returns empty would fall through to a
// REAL request against en.wikipedia.org, breaking "deterministic and
// offline by default" and, worse, sending real traffic to a real
// third-party API on every `bun test` run on this machine. A closed
// port refuses instantly; a test that wants the fallback to actually
// fire overrides this to its own fixture server explicitly (the same
// override-then-restore shape every test already uses for
// MAIPAI_BENCH_KEEP_READ_PAGE and friends).
process.env.MAIPAI_WIKIPEDIA_BASE_URL = "http://127.0.0.1:1";

// Defer imports that reach the database until after MAIPAI_DATA_DIR is set.
const [{ __setDefaultStackClientForTests }, { startDefaultScriptedStack, setDefaultScriptedStackFixture }] = await Promise.all([
  import("@/lib/stackEngine"), import("./stackFixture"),
]);
defaultScriptedStack = startDefaultScriptedStack();
setDefaultScriptedStackFixture(defaultScriptedStack);
__setDefaultStackClientForTests(defaultScriptedStack.client);

// Everything above is only a guarantee while it stays set. Found live
// 2026-09-07: a test file's own afterEach deleted MAIPAI_LLAMA_SERVER_PORT
// to tidy up, and every later spawning test then killed the real dev
// hub's chat engine exactly the way the comment above warns about, on
// every suite run, for days, with nothing failing. tests/isolation.ts
// re-checks these after every test in every file (and puts them back)
// so that class of leak fails the offending test by name instead. The
// snapshot is taken inside this call, after every assignment above.
installTestIsolationGuard();
// AGECHECK: a finished picture or clip is read by the local vision model before it is shown. A test that is not about
// that check gets "nobody in it" for every image and no clip decoder (no model, no swiftc); tests/ageCheck.test.ts and
// the safety tests install their own runner and restore this one.
{
  const ageCheck = await import("@/lib/pictures/ageCheck");
  const keyframes = await import("@/lib/pictures/keyframes");
  const nobody = async (images: readonly Uint8Array[]) => images.map(() => ({ ok: true as const, verdict: { people_count: 0, apparent_min_age_estimate: null, label: "none" as const, is_nude_or_sexual: false, confidence: 1 } }));
  const restoreAgeCheckDefaults = (): void => {
    ageCheck.__resetAgeCheckForTests(nobody);
    keyframes.__setKeyframesForTests(async () => null);
  };
  restoreAgeCheckDefaults();
  // After EVERY test in every file: a test that installed its own runner or vision seam (or set null, which would send the next file to the real
  // model and fail it for the wrong reason) leaves nothing behind. tests/ageCheckStateReset.test.ts proves it.
  afterEach(restoreAgeCheckDefaults);
}
// FLAKE-LOAD-01 (cause a, real I/O): a search test whose rows point at https://example.com/... made searxngSearch read those
// pages from the real internet (6 s alone for SEARCH-ROWS-01, over bun's 5 s default, and a fetch to a third party from a
// unit test). A page read now fails as "unreachable" unless a test installs its own fetch (__setPageFetchForTests or
// __setPageReaderForTests); re-applied around every test so a test that cleared the seam cannot re-open the network.
const offlinePageFetch = async (url: string) => ({ ok: false, networkFailure: true, error: new HostError("network_unreachable", `could not reach ${url} (tests are offline)`) }) as const;
const keepPagesOffline = async (): Promise<void> => {
  (await import("@/lib/packageHost")).__setPageFetchForTests(offlinePageFetch as never);
};
// The three modules the beforeEach below imports are loaded here, once, at preload time. Loaded lazily they ran inside the first
// test's beforeEach, where bun's hook timeout applies: with the Studio at load 60 to 90 the first import took over 5 s and
// `schemaChain` failed on "a beforeEach/afterEach hook timed out" in the lander's static check (2026-10-31, four bounces).
await import("@/lib/packageHost");
await import("@/lib/blocklists/listStore");
await import("@/lib/searchAssist/shadow");
afterEach(keepPagesOffline);
beforeEach(async () => {
  await keepPagesOffline();
  // MINOR-SEARCH-01e-5: tests that are not about the blocked-site lists run as if every enabled list had loaded.
  // Imported here, not at the top, so paths.ts reads MAIPAI_DATA_DIR after this file has set it.
  (await import("@/lib/blocklists/listStore")).__setListsReadyForTests(true);
  __setDefaultStackClientForTests(defaultScriptedStack.client);
  // ROUTER-BUILD-01g: the production weights are now pinned, so an unstubbed turn would download them from GitHub.
  // Tests that are not about the search assist see "no weights"; the assist's own tests install their manifest after this runs.
  (await import("@/lib/searchAssist/shadow")).__setSearchAssistLoaderForTests(async () => ({ missing: "weights_missing" }));
});

// getmaipai/home#123: a fire-and-forget background job (a crisis
// notification, an embed job kicked off after a memory write - never
// awaited in production, lib/backgroundWork.ts's own header explains
// why) could still be running when the NEXT test's own beforeEach
// wipes people/sessions, since bun runs every test file in one
// process with no wait for stray async work between them.
//
// A global `beforeEach` here (registered "before any test file's own
// beforeEach, so it always runs first") was the original shape and
// measurably did not work: safety.test.ts + updates.test.ts still
// failed on almost every run (20/20 targeted attempts, not the
// original issue's intermittent 4/9) - relying on cross-file
// beforeEach registration order was the wrong guarantee to lean on.
// `afterEach` sidesteps the question entirely: every afterEach hook
// for test N, in whatever order among themselves, completes before
// any beforeEach hook for test N+1 begins - that ordering is the
// definition of the before/after-each phase boundary, not something
// registration order can get wrong.
afterEach(async () => {
  await __drainBackgroundWorkForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
  __setDefaultStackClientForTests(defaultScriptedStack.client);
});

const { __resetLearnedCeilingsForTests } = await import("@/lib/reasoningReserve");
afterEach(__resetLearnedCeilingsForTests);

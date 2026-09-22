// bun:test preload (wired via bunfig.toml). Runs before any test file's
// imports, so it's the only place that can set MAIPAI_DATA_DIR before
// src/lib/paths.ts (and everything downstream: the keystore, the db)
// reads it at module-eval time.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "bun:test";
import { installTestIsolationGuard } from "./isolation";
import { reserveFreePort } from "./fixtures/reserveFreePort";
import { __drainBackgroundWorkForTests } from "@/lib/backgroundWork";

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
// Same guarantee for the `tts` role: without this, ttsSupervisor.ts's
// real-spawn tier would shell out to `uvx pocket-tts serve` on any
// machine that has `uv` installed (Jesse's dev Mac included) the moment a
// test exercises getTtsClient(), pulling a real Python process and a
// real HF-cached model into what must stay a deterministic, offline
// suite (.github/CLAUDE.md > Testing standards).
process.env.MAIPAI_TTS_DISABLE_SPAWN = "1";

// Everything above is only a guarantee while it stays set. Found live
// 2026-09-07: a test file's own afterEach deleted MAIPAI_LLAMA_SERVER_PORT
// to tidy up, and every later spawning test then killed the real dev
// hub's chat engine exactly the way the comment above warns about, on
// every suite run, for days, with nothing failing. tests/isolation.ts
// re-checks these after every test in every file (and puts them back)
// so that class of leak fails the offending test by name instead. The
// snapshot is taken inside this call, after every assignment above.
installTestIsolationGuard();

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
});

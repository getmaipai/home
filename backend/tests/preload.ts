// bun:test preload (wired via bunfig.toml). Runs before any test file's
// imports, so it's the only place that can set MAIPAI_DATA_DIR before
// src/lib/paths.ts (and everything downstream: the keystore, the db)
// reads it at module-eval time.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
process.env.MAIPAI_LLAMA_SERVER_PORT = "48788";
// Same guarantee for the `tts` role: without this, ttsSupervisor.ts's
// real-spawn tier would shell out to `uvx pocket-tts serve` on any
// machine that has `uv` installed (Jesse's dev Mac included) the moment a
// test exercises getTtsClient(), pulling a real Python process and a
// real HF-cached model into what must stay a deterministic, offline
// suite (.github/CLAUDE.md > Testing standards).
process.env.MAIPAI_TTS_DISABLE_SPAWN = "1";

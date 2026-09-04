// bun:test preload (wired via bunfig.toml). Runs before any test file's
// imports, so it's the only place that can set MAIPAI_DATA_DIR before
// src/lib/paths.ts (and everything downstream: the keystore, the db)
// reads it at module-eval time.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.MAIPAI_DATA_DIR = mkdtempSync(join(tmpdir(), "maipai-home-test-"));
// Never touch the real macOS Keychain from a test run.
process.env.MAIPAI_KEYSTORE_BACKEND = "file";

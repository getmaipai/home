import { describe, expect, test, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import {
  BACKGROUND_MODEL_FILE,
  BACKGROUND_MODEL_SHA256,
  BACKGROUND_MODEL_BYTES,
  BACKGROUND_MODEL_SMALL_FILE,
  BACKGROUND_MODEL_SMALL_SHA256,
  BACKGROUND_MODEL_SMALL_BYTES,
  backgroundModelPath,
  ensureBackgroundModel,
} from "@/lib/backgroundAssets";
import { singleflight } from "@/lib/singleflight";
import { modelsDir } from "@/lib/paths";

// Deliberately never exercises a real download - the same "trust the pin,
// pre-place a placeholder file so downloadUrl()'s existsSync short-circuit
// never reaches the network" discipline embedAssets.test.ts already uses
// (.github/CLAUDE.md > Testing standards' "deterministic and offline by
// default").
afterEach(() => {
  rmSync(backgroundModelPath(), { force: true });
  if (process.env.MAIPAI_BACKGROUND_MODEL === "qwen3-1.7b") {
    rmSync(`${modelsDir}/${BACKGROUND_MODEL_SMALL_FILE}`, { force: true });
  }
});

describe("lib/backgroundAssets.ts", () => {
  test("the pinned SHA256s are 64 hex characters and expectedBytes are plausible", () => {
    expect(BACKGROUND_MODEL_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(BACKGROUND_MODEL_SMALL_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(BACKGROUND_MODEL_BYTES).toBeGreaterThan(0);
    expect(BACKGROUND_MODEL_SMALL_BYTES).toBeGreaterThan(0);
    expect(BACKGROUND_MODEL_BYTES).toBeGreaterThan(BACKGROUND_MODEL_SMALL_BYTES);
  });

  test("backgroundModelPath resolves under the shared models directory (default model)", () => {
    expect(backgroundModelPath()).toBe(`${modelsDir}/${BACKGROUND_MODEL_FILE}`);
  });

  test("backgroundModelPath honors MAIPAI_BACKGROUND_MODEL=qwen3-1.7b (small alternative)", () => {
    process.env.MAIPAI_BACKGROUND_MODEL = "qwen3-1.7b";
    expect(backgroundModelPath()).toBe(`${modelsDir}/${BACKGROUND_MODEL_SMALL_FILE}`);
    delete process.env.MAIPAI_BACKGROUND_MODEL;
  });

  test("an unknown MAIPAI_BACKGROUND_MODEL value warns once and falls back to the default", () => {
    const warn = console.warn;
    const messages: string[] = [];
    console.warn = (...args: unknown[]) => messages.push(args.join(" "));
    process.env.MAIPAI_BACKGROUND_MODEL = "qwen3-9b-typo";
    try {
      expect(backgroundModelPath()).toBe(`${modelsDir}/${BACKGROUND_MODEL_FILE}`);
      expect(backgroundModelPath()).toBe(`${modelsDir}/${BACKGROUND_MODEL_FILE}`);
      expect(messages.length).toBe(1);
      expect(messages[0]).toContain('MAIPAI_BACKGROUND_MODEL="qwen3-9b-typo"');
      expect(messages[0]).toContain("names no model");
    } finally {
      console.warn = warn;
      delete process.env.MAIPAI_BACKGROUND_MODEL;
    }
  });

  test("ensureBackgroundModel never touches the network once the file already exists", async () => {
    mkdirSync(modelsDir, { recursive: true });
    writeFileSync(backgroundModelPath(), "placeholder");
    // downloadUrl() skips entirely once destPath exists - if this reached
    // the network it would hang/fail in the test sandbox rather than
    // resolving instantly.
    await ensureBackgroundModel();
    expect(existsSync(backgroundModelPath())).toBe(true);
  });

  test("ensureBackgroundModel is singleflight: concurrent callers share one in-flight attempt", async () => {
    mkdirSync(modelsDir, { recursive: true });
    writeFileSync(backgroundModelPath(), "placeholder");
    const a = ensureBackgroundModel();
    const b = ensureBackgroundModel();
    expect(a).toBe(b);
    await Promise.all([a, b]);
    expect(existsSync(backgroundModelPath())).toBe(true);
  });

  // The "a failed attempt clears itself so the next call retries fresh
  // rather than replaying the same rejection forever" contract is the
  // shared singleflight() primitive ensureBackgroundModel() is built on -
  // verified here with a controlled, instant-failing fn rather than a real
  // network attempt (which would retry with multi-second backoff in an
  // offline sandbox and slow the suite for no additional guarantee over
  // the primitive's own test in singleflight.test.ts).
  test("the singleflight() primitive behind ensureBackgroundModel retries fresh after failure", async () => {
    let attempt = 0;
    const run = singleflight(async () => {
      attempt++;
      if (attempt === 1) throw new Error("simulated offline failure");
      return "recovered";
    });
    await expect(run()).rejects.toThrow("simulated offline failure");
    expect(await run()).toBe("recovered");
  });
});

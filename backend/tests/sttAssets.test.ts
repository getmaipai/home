import { describe, expect, test, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import {
  SILERO_VAD_ASSET,
  MOONSHINE_ARCHIVE,
  MOONSHINE_DIR,
  sileroVadPath,
  moonshinePath,
  isSttInstalled,
  ensureSttAssets,
} from "@/lib/sttAssets";
import { sttDir } from "@/lib/paths";
import { singleflight } from "@/lib/singleflight";

// Deliberately never exercises a real download - the same "trust the pin,
// pre-place a placeholder file so downloadUrl()'s existsSync short-circuit
// never reaches the network" discipline embedAssets.test.ts and
// wakewordAssets.test.ts already use (.github/CLAUDE.md > Testing
// standards' "deterministic and offline by default").
afterEach(() => {
  rmSync(sttDir, { recursive: true, force: true });
});

describe("lib/sttAssets.ts", () => {
  test("the pinned SHA256s are 64 hex characters and expectedBytes are plausible", () => {
    expect(SILERO_VAD_ASSET.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(MOONSHINE_ARCHIVE.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(SILERO_VAD_ASSET.expectedBytes).toBeGreaterThan(0);
    expect(MOONSHINE_ARCHIVE.expectedBytes).toBeGreaterThan(0);
  });

  test("sileroVadPath resolves under the STT directory", () => {
    expect(sileroVadPath()).toBe(`${sttDir}/silero_vad.onnx`);
    expect(sileroVadPath()).toBe(`${sttDir}/${SILERO_VAD_ASSET.file}`);
  });

  test("moonshinePath resolves under the MOONSHINE_DIR inside the STT directory", () => {
    expect(moonshinePath("encode.int8.onnx")).toBe(`${MOONSHINE_DIR}/encode.int8.onnx`);
    expect(MOONSHINE_DIR.startsWith(sttDir)).toBe(true);
  });

  test("isSttInstalled is false before anything is downloaded", () => {
    expect(isSttInstalled()).toBe(false);
  });

  test("isSttInstalled requires BOTH assets - Silero alone is not enough", () => {
    mkdirSync(sttDir, { recursive: true });
    writeFileSync(sileroVadPath(), "placeholder");
    expect(isSttInstalled()).toBe(false);
  });

  test("isSttInstalled requires BOTH assets - Moonshine alone is not enough", () => {
    mkdirSync(MOONSHINE_DIR, { recursive: true });
    writeFileSync(moonshinePath("encode.int8.onnx"), "placeholder");
    expect(isSttInstalled()).toBe(false);
  });

  test("isSttInstalled is true once both files exist", () => {
    mkdirSync(sttDir, { recursive: true });
    mkdirSync(MOONSHINE_DIR, { recursive: true });
    writeFileSync(sileroVadPath(), "placeholder");
    writeFileSync(moonshinePath("encode.int8.onnx"), "placeholder");
    expect(isSttInstalled()).toBe(true);
  });

  test("ensureSttAssets never touches the network once both assets already exist", async () => {
    mkdirSync(sttDir, { recursive: true });
    mkdirSync(MOONSHINE_DIR, { recursive: true });
    writeFileSync(sileroVadPath(), "placeholder");
    writeFileSync(moonshinePath("encode.int8.onnx"), "placeholder");
    // downloadUrl() skips entirely once destPath exists - if this reached
    // the network it would hang/fail in the test sandbox rather than
    // resolving instantly.
    await ensureSttAssets();
    expect(isSttInstalled()).toBe(true);
    expect(existsSync(sileroVadPath())).toBe(true);
    expect(existsSync(moonshinePath("encode.int8.onnx"))).toBe(true);
  });

  test("ensureSttAssets is singleflight: concurrent callers share one in-flight attempt", async () => {
    mkdirSync(sttDir, { recursive: true });
    mkdirSync(MOONSHINE_DIR, { recursive: true });
    writeFileSync(sileroVadPath(), "placeholder");
    writeFileSync(moonshinePath("encode.int8.onnx"), "placeholder");
    const a = ensureSttAssets();
    const b = ensureSttAssets();
    expect(a).toBe(b);
    await Promise.all([a, b]);
  });

  // The "a failed attempt clears itself so the next call retries fresh
  // rather than replaying the same rejection forever" contract is the
  // shared singleflight() primitive ensureSttAssets() is built on -
  // verified here with a controlled, instant-failing fn rather than a
  // real network attempt (which would retry with multi-second backoff in
  // an offline sandbox and slow the suite for no additional guarantee
  // over the primitive's own test in singleflight.test.ts).
  test("the singleflight() primitive behind ensureSttAssets retries fresh after failure", async () => {
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

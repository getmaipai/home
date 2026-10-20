import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ensureBotRelease, __setBotReleaseForTests } from "@/lib/botRelease";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); __setBotReleaseForTests({ fetch: null, pin: null }); __resetRateLimiterForTests(); });
function temp(): string { const d = mkdtempSync(join(tmpdir(), "maipai-home-test-bot-")); dirs.push(d); return d; }
async function archive(entries: Record<string, string>): Promise<Uint8Array> {
  const dir = temp();
  for (const [name, value] of Object.entries(entries)) {
    const path = join(dir, name.startsWith("../") ? name.slice(3) : name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, value);
  }
  const traversal = Object.keys(entries).some((name) => name.startsWith("../"));
  // macOS ships bsdtar (-s rewrites names); Linux ships GNU tar (--transform).
  const rename = process.platform === "darwin" ? ["-s", ",^evil,../evil,"] : ["--transform=s,^evil,../evil,"];
  const args = traversal
    ? ["tar", "-czf", "-", "-C", dir, ...rename, "evil"]
    : ["tar", "-czf", "-", "-C", dir, ...Object.keys(entries)];
  const proc = Bun.spawn(args, { stdout: "pipe" });
  return new Uint8Array(await new Response(proc.stdout).arrayBuffer());
}
function testPin(bytes: Uint8Array, sha = createHash("sha256").update(bytes).digest("hex"), signing_keys: string[] = []) {
  const platform = `${process.platform === "darwin" ? "darwin" : "linux"}-${process.arch === "arm64" ? "arm64" : "x64"}`;
  return { version: "1.2.3", repo: "getmaipai/bot", assets: { [platform]: { name: "bot.tar.gz", sha256: sha } }, signing_keys };
}
function fetchBody(bytes: Uint8Array) { return async () => new Response(bytes); }

describe("ensureBotRelease", () => {
  test("unpacks and returns a verified release, then reuses it without fetching", async () => {
    const bytes = await archive({ "bot/robot": "ready" }); const dir = temp(); let calls = 0;
    const fetch = async () => { calls++; return new Response(bytes); };
    const opts = { dataDir: dir, pin: testPin(bytes), fetch };
    const first = await ensureBotRelease(opts); expect(first.version).toBe("1.2.3");
    expect(await Bun.file(join(first.dir, "bot/robot")).text()).toBe("ready");
    expect(await ensureBotRelease(opts)).toEqual(first); expect(calls).toBe(1);
  });
  test("refuses a mismatched fingerprint and names the file without staging", async () => {
    const bytes = await archive({ "robot": "bad" }); const dir = temp();
    await expect(ensureBotRelease({ dataDir: dir, pin: testPin(bytes, "00".repeat(32)), fetch: fetchBody(bytes) })).rejects.toThrow("bot.tar.gz");
    expect(await Bun.file(join(dir, "robots/releases/1.2.3")).exists()).toBe(false);
  });
  test("refuses a bad signature", async () => {
    const bytes = await archive({ robot: "signed" }); const dir = temp(); let n = 0;
    const fetch = async () => ++n === 1 ? new Response(bytes) : new Response(n === 2 ? "" : JSON.stringify({ signed: { sha256: "00" }, signatures: [] }));
    await expect(ensureBotRelease({ dataDir: dir, pin: testPin(bytes, undefined, ["invalid"]), fetch })).rejects.toThrow("signature");
  });
  test("refuses a tar path traversal", async () => {
    const bytes = await archive({ "../evil": "bad" }); const dir = temp();
    await expect(ensureBotRelease({ dataDir: dir, pin: testPin(bytes), fetch: fetchBody(bytes) })).rejects.toThrow("outside");
    expect(await Bun.file(join(dir, "robots/releases/1.2.3")).exists()).toBe(false);
  });
  test("empty pin gives the plain update message", async () => {
    await expect(ensureBotRelease({ pin: { version: "0.0.0", repo: "getmaipai/bot", assets: {}, signing_keys: [] } })).rejects.toThrow("This version of Home doesn't include a robot app yet. Update Home to add a StackChan.");
  });
});

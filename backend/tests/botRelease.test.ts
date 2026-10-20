import { afterEach, describe, expect, test } from "bun:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ensureBotRelease, __setBotReleaseForTests } from "@/lib/botRelease";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); __setBotReleaseForTests({ fetch: null, pin: null }); __resetRateLimiterForTests(); });
function temp(): string { const d = mkdtempSync(join(tmpdir(), "maipai-home-test-bot-")); dirs.push(d); return d; }
async function archive(entries: Record<string, string>, links: Record<string, string> = {}, absolute = false): Promise<Uint8Array> {
  const dir = temp();
  for (const [name, value] of Object.entries(entries)) { const path = join(dir, name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, value); }
  for (const [name, target] of Object.entries(links)) { const path = join(dir, name); mkdirSync(dirname(path), { recursive: true }); symlinkSync(target, path); }
  const name = absolute ? join(dir, Object.keys(entries)[0] ?? "file") : Object.keys(entries)[0] ?? "file";
  const tarArgs = absolute
    ? ["tar", "-czPf", "-", name]
    : ["tar", "-czf", "-", "-C", dir, ...(process.platform === "darwin" ? ["-s", ",^evil,../evil,"] : ["--transform=s,^evil,../evil,"]), ...Object.keys(entries), ...Object.keys(links)];
  const proc = Bun.spawn(tarArgs, { stdout: "pipe" }); return new Uint8Array(await new Response(proc.stdout).arrayBuffer());
}
const platform = `${process.platform === "darwin" ? "darwin" : "linux"}-${process.arch === "arm64" ? "arm64" : "x64"}`;
function testPin(bytes: Uint8Array, sha = createHash("sha256").update(bytes).digest("hex"), signing_keys: string[] = [], extra: { size?: number; version?: string } = {}) {
  return { version: extra.version ?? "1.2.3", repo: "getmaipai/bot", assets: { [platform]: { name: "bot.tar.gz", sha256: sha, ...(extra.size === undefined ? {} : { size: extra.size }) } }, signing_keys };
}
function fetchBody(bytes: Uint8Array) { return async () => new Response(bytes); }
const rel = (dir: string) => join(dir, "robots/releases");

describe("ensureBotRelease", () => {
  test("unpacks, verifies and reuses matching marker", async () => {
    const bytes = await archive({ "bot/robot": "ready" }); const dir = temp(); let calls = 0;
    const opts = { dataDir: dir, pin: testPin(bytes), fetch: async () => { calls++; return new Response(bytes); } };
    const first = await ensureBotRelease(opts); expect(first.version).toBe("1.2.3"); expect(await Bun.file(join(first.dir, "bot/robot")).text()).toBe("ready");
    expect(await ensureBotRelease(opts)).toEqual(first); expect(calls).toBe(1);
  });
  test("refuses a mismatched fingerprint and cleans partials", async () => {
    const bytes = await archive({ robot: "bad" }); const dir = temp();
    await expect(ensureBotRelease({ dataDir: dir, pin: testPin(bytes, "00".repeat(32)), fetch: fetchBody(bytes) })).rejects.toThrow("damaged");
    expect(existsSync(join(rel(dir), `1.2.3-${platform}`))).toBe(false);
    expect(readdirSync(join(rel(dir), ".partial"))).toEqual([]);
  });
  test("refuses symlink escapes including link-target separators and removes staging", async () => {
    const dir = temp();
    for (const target of ["../../outside", "../../outside -> bot/file"]) {
      const bytes = await archive({ "bot/file": "ok" }, { "bot/escape": target });
      await expect(ensureBotRelease({ dataDir: dir, pin: testPin(bytes), fetch: fetchBody(bytes) })).rejects.toThrow("outside");
      expect(readdirSync(rel(dir))).toEqual([".partial"]);
    }
  });
  test("refuses a link chain that only escapes when followed (d -> ., e -> d/../outside)", async () => {
    const dir = temp();
    const bytes = await archive({ "bot/file": "ok" }, { "bot/d": ".", "bot/e": "d/../file" });
    await expect(ensureBotRelease({ dataDir: dir, pin: testPin(bytes), fetch: fetchBody(bytes) })).rejects.toThrow("outside");
    expect(readdirSync(rel(dir))).toEqual([".partial"]);
  });
  test("accepts a relative symlink staying inside", async () => {
    const bytes = await archive({ "bot/bin/python3.12": "python" }, { "bot/bin/python": "python3.12" }); const dir = temp();
    const got = await ensureBotRelease({ dataDir: dir, pin: testPin(bytes), fetch: fetchBody(bytes) }); expect(readlinkSync(join(got.dir, "bot/bin/python"))).toBe("python3.12");
  });
  test("refuses an absolute-path tar entry", async () => {
    const bytes = await archive({ evil: "bad" }, {}, true); const dir = temp();
    await expect(ensureBotRelease({ dataDir: dir, pin: testPin(bytes), fetch: fetchBody(bytes) })).rejects.toThrow("unsafe path");
  });
  test("stale marker with a different sha re-downloads", async () => {
    const bytes = await archive({ robot: "new" }); const dir = temp(); const dest = join(rel(dir), `1.2.3-${platform}`); mkdirSync(dest, { recursive: true }); writeFileSync(join(dest, ".verified"), "old\n"); let calls = 0;
    await ensureBotRelease({ dataDir: dir, pin: testPin(bytes), fetch: async () => { calls++; return new Response(bytes); } }); expect(calls).toBe(1);
  });
  test("rollback returns a release that pruning keeps", async () => {
    const bytes = await archive({ robot: "old" }); const dir = temp(); mkdirSync(rel(dir), { recursive: true });
    for (const version of [`9.0.0-${platform}`, `8.0.0-${platform}`]) { mkdirSync(join(rel(dir), version)); writeFileSync(join(rel(dir), version, ".verified"), "other\n"); }
    const got = await ensureBotRelease({ dataDir: dir, pin: testPin(bytes, undefined, [], { version: "1.0.0" }), fetch: fetchBody(bytes) });
    expect(existsSync(join(got.dir, "robot"))).toBe(true);
    expect(readdirSync(rel(dir)).filter((name) => !name.startsWith(".")).sort()).toEqual([`1.0.0-${platform}`, `9.0.0-${platform}`]);
  });
  test("concurrent calls share one fetch", async () => {
    const bytes = await archive({ robot: "one" }); const dir = temp(); let calls = 0;
    const fetch = async () => { calls++; await new Promise((r) => setTimeout(r, 20)); return new Response(bytes); }; const opts = { dataDir: dir, pin: testPin(bytes), fetch };
    const [a, b] = await Promise.all([ensureBotRelease(opts), ensureBotRelease(opts)]); expect(a).toEqual(b); expect(calls).toBe(1);
  });
  test("accepts a valid signed envelope and rejects mismatched hash", async () => {
    const bytes = await archive({ robot: "signed" }); const { privateKey, publicKey } = generateKeyPairSync("ed25519"); const pem = publicKey.export({ type: "spki", format: "pem" }).toString(); const sums = `${createHash("sha256").update(bytes).digest("hex")}  bot.tar.gz\n`;
    const signed = { sha256: createHash("sha256").update(sums).digest("hex") }; const sig = sign(null, Buffer.from(JSON.stringify(signed)), privateKey).toString("base64");
    const valid = async (_url: string | URL | Request, init?: RequestInit) => String(_url).endsWith("SHA256SUMS.sig.json") ? new Response(JSON.stringify({ signed, signatures: [{ keyid: "test", sig }] })) : String(_url).endsWith("SHA256SUMS") ? new Response(sums) : new Response(bytes);
    const dir = temp(); await ensureBotRelease({ dataDir: dir, pin: testPin(bytes, undefined, [pem]), fetch: valid });
    const badDir = temp(); const bad = async (_url: string | URL | Request) => String(_url).endsWith("SHA256SUMS.sig.json") ? new Response(JSON.stringify({ signed: { sha256: "00" }, signatures: [] })) : String(_url).endsWith("SHA256SUMS") ? new Response(sums) : new Response(bytes);
    await expect(ensureBotRelease({ dataDir: badDir, pin: testPin(bytes, undefined, [pem]), fetch: bad })).rejects.toThrow("signature");
  });
  test("aborts oversize response and does not spend tokens on network failures", async () => {
    const bytes = await archive({ robot: "size" }); const dir = temp();
    await expect(ensureBotRelease({ dataDir: dir, pin: testPin(bytes, undefined, [], { size: 1 }), fetch: fetchBody(bytes) })).rejects.toThrow("too large");
    expect(readdirSync(join(rel(dir), ".partial"))).toEqual([]);
    const retryDir = temp(); let calls = 0; const pin = testPin(bytes);
    const fetch = async () => { calls++; if (calls <= 6) throw new TypeError("network"); return new Response(bytes); };
    for (let i = 0; i < 6; i++) await expect(ensureBotRelease({ dataDir: retryDir, pin, fetch })).rejects.toThrow("Check the internet connection");
    await ensureBotRelease({ dataDir: retryDir, pin, fetch }); expect(calls).toBe(7);
  });
  test("empty pin gives the plain update message", async () => {
    await expect(ensureBotRelease({ pin: { version: "0.0.0", repo: "getmaipai/bot", assets: {}, signing_keys: [] } })).rejects.toThrow("This version of Home doesn't include a robot app yet.");
  });
});

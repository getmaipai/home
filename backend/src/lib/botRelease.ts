// Robot app releases are pinned by a Home release in botReleasePin.json.
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import pin from "./botReleasePin.json";
import { dataDir } from "@/lib/paths";
import { tryConsume } from "@/lib/rateLimiter";
import { verifyEnvelopeSignature, type SignedEnvelope } from "@/lib/storeIndex";
import { setRobotReleaseInstall } from "@/lib/installStatus";

export interface BotReleasePin {
  version: string;
  repo: string;
  assets: Record<string, { name: string; sha256: string } | null>;
  signing_keys: string[];
}
export type BotReleaseFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
// One token per install attempt (not per file), so a signed download still counts once.
const GITHUB_RATE = { capacity: 5, refillPerSecond: 1 / 600 };
let fetchOverride: BotReleaseFetch | null = null;
let pinOverride: BotReleasePin | null = null;
export function __setBotReleaseForTests(options: { fetch?: BotReleaseFetch | null; pin?: BotReleasePin | null }): void {
  fetchOverride = options.fetch ?? null;
  pinOverride = options.pin ?? null;
}
export function hasBotReleaseAssets(): boolean {
  const selected = pinOverride ?? pin as BotReleasePin;
  return Object.values(selected.assets ?? {}).some(Boolean);
}

function platformKey(): string {
  const os = process.platform === "darwin" ? "darwin" : process.platform === "linux" ? "linux" : process.platform;
  const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x64" : process.arch;
  return `${os}-${arch}`;
}

function safeTarEntries(text: string, root: string): void {
  for (const raw of text.split("\n").filter(Boolean)) {
    const name = raw.replace(/\\/g, "/");
    if (name.startsWith("/") || /^[A-Za-z]:/.test(name) || name.split("/").includes("..")) throw new Error("archive contains a path outside the release directory");
    const target = resolve(root, name);
    if (target !== root && !target.startsWith(`${root}/`)) throw new Error("archive contains a path outside the release directory");
  }
}

async function runTar(args: string[]): Promise<string> {
  const proc = Bun.spawn(["tar", ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new Error(err || "could not unpack the robot app");
  return out;
}

async function fetchWithTimeout(fetcher: BotReleaseFetch, url: string): Promise<Response> {
  return fetcher(url, { signal: AbortSignal.timeout(30_000) });
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const pb = b.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

// One download at a time per release folder: a second caller waits for the first instead of unpacking over it.
const inFlight = new Map<string, Promise<{ dir: string; version: string }>>();

export function ensureBotRelease(opts: { dataDir?: string; fetch?: BotReleaseFetch; pin?: BotReleasePin } = {}): Promise<{ dir: string; version: string }> {
  const selected = opts.pin ?? pinOverride ?? pin as BotReleasePin;
  const key = join(opts.dataDir ?? dataDir, "robots", "releases", selected?.version ?? "");
  const running = inFlight.get(key);
  if (running) return running;
  const started = ensureBotReleaseOnce(opts).finally(() => inFlight.delete(key));
  inFlight.set(key, started);
  return started;
}

async function ensureBotReleaseOnce(opts: { dataDir?: string; fetch?: BotReleaseFetch; pin?: BotReleasePin }): Promise<{ dir: string; version: string }> {
  const selected = opts.pin ?? pinOverride ?? pin as BotReleasePin;
  if (!selected || selected.version === "0.0.0" || Object.keys(selected.assets ?? {}).length === 0) throw new Error("This version of Home doesn't include a robot app yet. Update Home to add a StackChan.");
  const asset = selected.assets[platformKey()];
  if (!asset) throw new Error(`The pinned robot app does not support ${platformKey()}. Update Home to add a StackChan.`);
  const base = opts.dataDir ?? dataDir;
  const releases = join(base, "robots", "releases");
  const dest = join(releases, selected.version);
  if (existsSync(join(dest, ".verified"))) return { dir: dest, version: selected.version };
  const fetcher = opts.fetch ?? fetchOverride ?? fetch;
  if (!tryConsume("bot-release-download", GITHUB_RATE)) throw new Error("Home tried to download the robot app too many times in a row. Wait 10 minutes, then try again.");
  const partial = join(releases, ".partial");
  mkdirSync(partial, { recursive: true });
  mkdirSync(releases, { recursive: true });
  const file = join(partial, `${asset.name}.${crypto.randomUUID()}.part`);
  setRobotReleaseInstall({ state: "running", completedBytes: 0, totalBytes: 0 });
  try {
    const url = `https://github.com/${selected.repo}/releases/download/v${selected.version}/${asset.name}`;
    const response = await fetchWithTimeout(fetcher, url);
    if (!response.ok || !response.body) throw new Error(`The robot app download failed (${asset.name}, HTTP ${response.status}). Try again; if it keeps failing, update Home.`);
    const out = createWriteStream(file, { flags: "wx", mode: 0o600 });
    let completed = 0;
    const hash = createHash("sha256");
    const stream = new ReadableStream({
      async start(controller) {
        const reader = response.body!.getReader();
        try { while (true) { const item = await reader.read(); if (item.done) break; completed += item.value.length; hash.update(item.value); setRobotReleaseInstall({ state: "running", completedBytes: completed, totalBytes: Number(response.headers.get("content-length") ?? 0) }); controller.enqueue(item.value); } controller.close(); }
        catch (error) { controller.error(error); }
      },
    });
    await pipeline(Readable.fromWeb(stream as never), out);
    const digest = hash.digest("hex");
    if (digest.toLowerCase() !== asset.sha256.toLowerCase()) throw new Error(`The robot app download didn't match its fingerprint (${asset.name}). Try again; if it keeps failing, update Home.`);
    if (selected.signing_keys.length) {
      const sumName = "SHA256SUMS";
      const sumsResponse = await fetchWithTimeout(fetcher, `https://github.com/${selected.repo}/releases/download/v${selected.version}/${sumName}`);
      const sigResponse = await fetchWithTimeout(fetcher, `https://github.com/${selected.repo}/releases/download/v${selected.version}/SHA256SUMS.sig.json`);
      if (!sumsResponse.ok || !sigResponse.ok) throw new Error("The robot app signature files could not be downloaded. Try again; if it keeps failing, update Home.");
      const sums = await sumsResponse.text();
      const envelope = await sigResponse.json() as SignedEnvelope<{ sha256: string }>;
      if (!verifyEnvelopeSignature(envelope, selected.signing_keys) || envelope.signed.sha256 !== createHash("sha256").update(sums).digest("hex") || !new RegExp(`^${digest}\\s+\\*?${asset.name.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}$`, "m").test(sums)) throw new Error(`The robot app signature did not verify (${asset.name}). Try again; if it keeps failing, update Home.`);
    }
    rmSync(dest, { recursive: true, force: true }); mkdirSync(dest, { recursive: true });
    const listing = await runTar(["-tzf", file]); safeTarEntries(listing, resolve(dest));
    const links = await runTar(["-tvzf", file]);
    for (const line of links.split("\n")) if (/^[lh]/.test(line)) {
      const target = line.split(/(?: -> | link to )/).at(-1) ?? "";
      if (target.startsWith("/") || target.split("/").includes("..")) throw new Error("archive contains a link outside the release directory");
    }
    await runTar(["--no-same-owner", "-xzf", file, "-C", dest]);
    writeFileSync(join(dest, ".verified"), `${digest}\n`, { mode: 0o600 });
    rmSync(file, { force: true });
    const older = readdirSync(releases, { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name !== ".partial").map((entry) => entry.name).sort(compareVersions).reverse();
    for (const old of older.slice(2)) rmSync(join(releases, old), { recursive: true, force: true });
    return { dir: dest, version: selected.version };
  } catch (error) {
    rmSync(file, { force: true }); rmSync(dest, { recursive: true, force: true });
    throw error instanceof Error ? error : new Error(`The robot app download failed (${asset.name}). Try again; if it keeps failing, update Home.`);
  } finally { setRobotReleaseInstall(null); }
}

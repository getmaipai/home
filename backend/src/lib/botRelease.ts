// Robot app releases are pinned by a Home release in botReleasePin.json.
// ensureBotRelease downloads the asset for this platform, checks its sha256 (and the signed SHA256SUMS when the pin carries
// signing keys), lists and extracts it into a staging dir, walks the tree on disk, then renames it to
// releases/<version>-<platform>/ with a .verified marker holding the sha256. The on-disk walk is the real link guard.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, sep } from "node:path";
import { open, type FileHandle } from "node:fs/promises";
import pin from "./botReleasePin.json";
import { setRobotReleaseInstall } from "@/lib/installStatus";
import { dataDir } from "@/lib/paths";
import { tryConsume } from "@/lib/rateLimiter";
import { verifyEnvelopeSignature, type SignedEnvelope } from "@/lib/storeIndex";

export interface BotReleasePin {
  version: string;
  repo: string;
  assets: Record<string, { name: string; sha256: string; size?: number } | null>;
  signing_keys?: string[];
  /** Firmware sets shipped in the same release, keyed by body (today only "stackchan"). */
  firmware?: Record<string, { name: string; sha256: string; size?: number } | null>;
}
export type BotReleaseFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type ReleaseOptions = { dataDir?: string; fetch?: BotReleaseFetch; pin?: BotReleasePin };
type Release = { dir: string; version: string };
type Asset = { name: string; sha256: string; size?: number };

const GITHUB_RATE = { capacity: 5, refillPerSecond: 1 / 600 };
const HEADER_TIMEOUT_MS = 30_000;
const IDLE_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_BYTES = 1024 * 1024 * 1024;

const NETWORK_ERROR = "Home couldn't download the robot app (the connection timed out or failed). Check the internet connection, then try again.";
const damaged = (name: string) => `The robot app download looks damaged (${name}). Try again; if it keeps failing, update Home.`;
const tooLarge = (name: string) => `The robot app download is too large (${name}). Try again; if it keeps failing, update Home.`;
const UNSAFE_PATH = "The robot app download contains an unsafe path. Try again; if it keeps failing, update Home.";
const UNSUPPORTED_LINK = "The robot app download contains an unsupported link. Try again; if it keeps failing, update Home.";
const OUTSIDE_LINK = "The robot app download contains a link outside the release directory. Try again; if it keeps failing, update Home.";
const UNSUPPORTED_FILE = "The robot app download contains an unsupported file. Try again; if it keeps failing, update Home.";

let fetchOverride: BotReleaseFetch | null = null;
let pinOverride: BotReleasePin | null = null;
export function __setBotReleaseForTests(options: { fetch?: BotReleaseFetch | null; pin?: BotReleasePin | null }): void {
  fetchOverride = options.fetch ?? null;
  pinOverride = options.pin ?? null;
}
export function hasBotReleaseAssets(): boolean {
  const selected = pinOverride ?? (pin as BotReleasePin);
  return Object.values(selected.assets ?? {}).some(Boolean);
}
/** The release Home ships; kept as the single source for software status and install validation. */
export function botReleaseVersion(): string { return (pinOverride ?? (pin as BotReleasePin)).version; }
/** The keys a release's SHA256SUMS and the StackChan flash manifest must be signed by. */
export function botReleaseSigningKeys(): string[] {
  return (pinOverride ?? (pin as BotReleasePin)).signing_keys ?? [];
}

function platformKey(): string {
  const os = process.platform === "darwin" ? "darwin" : process.platform === "linux" ? "linux" : process.platform;
  const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x64" : process.arch;
  return `${os}-${arch}`;
}

/** An error whose message is already written for the person; the outer catch passes it through unchanged. */
class ReleaseError extends Error {}

async function runTar(args: string[], name: string): Promise<string> {
  let out = "";
  let code = 1;
  try {
    const proc = Bun.spawn(["tar", ...args], { stdout: "pipe", stderr: "pipe" });
    [out, , code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  } catch {
    throw new ReleaseError(damaged(name));
  }
  if (code !== 0) throw new ReleaseError(damaged(name));
  return out;
}

function assertSafeNames(listing: string): void {
  for (const raw of listing.split("\n").filter(Boolean)) {
    const name = raw.replace(/\\/g, "/");
    if (name.startsWith("/") || /^[A-Za-z]:/.test(name) || name.split("/").includes("..")) throw new ReleaseError(UNSAFE_PATH);
  }
}

function assertNoHardlinks(verboseListing: string): void {
  // GNU tar and bsdtar both start a hardlink line with "h" in a verbose listing (and bsdtar also prints "link to").
  // Symlinks are checked on disk after extraction, so this only refuses hardlinks.
  for (const line of verboseListing.split("\n")) if (line.startsWith("h")) throw new ReleaseError(UNSUPPORTED_LINK);
}

/**
 * Walks the extracted tree with lstat: only directories, regular files and links whose real path (followed the way the
 * kernel follows it, so chains like `d -> .` then `e -> d/../x` are caught) stays inside the root. A dangling link is refused.
 */
function inspectTree(root: string): void {
  const rootReal = realpathSync(root);
  const visit = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) {
        let target: string;
        try {
          target = realpathSync(path);
        } catch {
          throw new ReleaseError(OUTSIDE_LINK);
        }
        if (target !== rootReal && !target.startsWith(`${rootReal}${sep}`)) throw new ReleaseError(OUTSIDE_LINK);
      } else if (stat.isDirectory()) visit(path);
      else if (!stat.isFile()) throw new ReleaseError(UNSUPPORTED_FILE);
    }
  };
  visit(root);
}

/** Waits for the response headers only; the body has its own idle timeout. Network failures never consume a rate token. */
async function fetchHeaders(fetcher: BotReleaseFetch, url: string): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fetcher(url, { signal: controller.signal }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("timeout"));
        }, HEADER_TIMEOUT_MS);
      }),
    ]);
  } catch {
    throw new ReleaseError(NETWORK_ERROR);
  } finally {
    clearTimeout(timer);
  }
}

/** Writes the body to `file`, hashing as it goes. Refuses more than `maxBytes` and a body that stalls for 60 s. */
async function download(body: ReadableStream<Uint8Array>, file: string, maxBytes: number, totalBytes: number, name: string): Promise<string> {
  const hash = createHash("sha256");
  const reader = body.getReader();
  let handle: FileHandle | undefined;
  let completed = 0;
  try {
    handle = await open(file, "wx", 0o600);
    while (true) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let item: Awaited<ReturnType<typeof reader.read>>;
      try {
        item = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("idle")), IDLE_TIMEOUT_MS);
          }),
        ]);
      } catch {
        throw new ReleaseError(NETWORK_ERROR);
      } finally {
        clearTimeout(timer);
      }
      if (item.done) break;
      completed += item.value.length;
      if (completed > maxBytes) throw new ReleaseError(tooLarge(name));
      hash.update(item.value);
      await handle.write(item.value);
      setRobotReleaseInstall({ state: "running", completedBytes: completed, totalBytes });
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error instanceof ReleaseError ? error : new ReleaseError(`Home couldn't save the robot app (${name}). Check that the disk has free space, then try again.`);
  } finally {
    await handle?.close();
  }
  return hash.digest("hex");
}

async function verifySignature(fetcher: BotReleaseFetch, selected: BotReleasePin, assetName: string, digest: string): Promise<void> {
  const keys = selected.signing_keys ?? [];
  if (keys.length === 0) return;
  const base = `https://github.com/${selected.repo}/releases/download/v${selected.version}`;
  const sumsResponse = await fetchHeaders(fetcher, `${base}/SHA256SUMS`);
  const sigResponse = await fetchHeaders(fetcher, `${base}/SHA256SUMS.sig.json`);
  let sums: string;
  let envelope: SignedEnvelope<{ sha256: string }>;
  try {
    if (!sumsResponse.ok || !sigResponse.ok) throw new Error("status");
    sums = await sumsResponse.text();
    envelope = (await sigResponse.json()) as SignedEnvelope<{ sha256: string }>;
    if (!envelope?.signed || !Array.isArray(envelope.signatures) || typeof envelope.signed.sha256 !== "string") throw new Error("shape");
  } catch {
    throw new ReleaseError(`The robot app signature files look damaged (${assetName}). Try again; if it keeps failing, update Home.`);
  }
  const escaped = assetName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sumsDigest = createHash("sha256").update(sums).digest("hex");
  const listed = new RegExp(`^${digest}\\s+\\*?${escaped}$`, "m").test(sums);
  if (!verifyEnvelopeSignature(envelope, keys) || envelope.signed.sha256 !== sumsDigest || !listed) {
    throw new ReleaseError(`The robot app signature did not verify (${assetName}). Try again; if it keeps failing, update Home.`);
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const pb = b.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

/** Keeps the release just selected plus the newest other one; never removes what the caller is about to use. */
function prune(releases: string, selectedDir: string): void {
  const versionOf = (dirName: string) => dirName.replace(/-(?:darwin|linux|win32)-[^-]+$/, "");
  const others = readdirSync(releases, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== selectedDir)
    .map((entry) => entry.name)
    .sort((a, b) => compareVersions(versionOf(b), versionOf(a)));
  for (const old of others.slice(1)) rmSync(join(releases, old), { recursive: true, force: true });
}

const inFlight = new Map<string, Promise<Release>>();
function once(key: string, run: () => Promise<Release>): Promise<Release> {
  const running = inFlight.get(key);
  if (running) return running;
  const started = run().finally(() => inFlight.delete(key));
  inFlight.set(key, started);
  return started;
}

export function ensureBotRelease(opts: ReleaseOptions = {}): Promise<Release> {
  const selected = opts.pin ?? pinOverride ?? (pin as BotReleasePin);
  const releases = join(opts.dataDir ?? dataDir, "robots", "releases");
  return once(join(releases, selected?.version ?? ""), async () => {
    if (!selected || selected.version === "0.0.0" || Object.keys(selected.assets ?? {}).length === 0) {
      throw new Error("This version of Home doesn't include a robot app yet. Update Home to add a StackChan.");
    }
    const asset = selected.assets[platformKey()];
    if (!asset) throw new Error(`The pinned robot app does not support ${platformKey()}. Update Home to add a StackChan.`);
    return installAsset(opts, selected, asset, releases, `${selected.version}-${platformKey()}`);
  });
}

/** The signed StackChan firmware set (flash manifest plus the parts it names), a separate asset of the same bot release. */
export function ensureStackChanFirmware(opts: ReleaseOptions = {}): Promise<Release> {
  const selected = opts.pin ?? pinOverride ?? (pin as BotReleasePin);
  const firmware = join(opts.dataDir ?? dataDir, "robots", "firmware");
  return once(join(firmware, selected?.version ?? ""), async () => {
    const asset = selected?.version === "0.0.0" ? null : selected?.firmware?.stackchan;
    if (!selected || !asset) throw new Error("This version of Home doesn't include StackChan firmware yet. Update Home to install a StackChan.");
    return installAsset(opts, selected, asset, firmware, `${selected.version}-stackchan`);
  });
}

async function installAsset(opts: ReleaseOptions, selected: BotReleasePin, asset: Asset, releases: string, destName: string): Promise<Release> {
  const dest = join(releases, destName);
  const marker = join(dest, ".verified");
  if (existsSync(marker)) {
    try {
      if (readFileSync(marker, "utf8").trim() === asset.sha256.toLowerCase()) return { dir: dest, version: selected.version };
    } catch {
      // An unreadable marker means download again.
    }
  }

  const fetcher = opts.fetch ?? fetchOverride ?? fetch;
  const partial = join(releases, ".partial");
  mkdirSync(partial, { recursive: true });
  for (const entry of readdirSync(partial)) rmSync(join(partial, entry), { recursive: true, force: true });
  for (const entry of readdirSync(releases)) if (entry.startsWith(".staging-")) rmSync(join(releases, entry), { recursive: true, force: true });
  const file = join(partial, `${asset.name}.${crypto.randomUUID()}.part`);
  const staging = join(releases, `.staging-${crypto.randomUUID()}`);

  setRobotReleaseInstall({ state: "running", completedBytes: 0, totalBytes: 0 });
  try {
    const response = await fetchHeaders(fetcher, `https://github.com/${selected.repo}/releases/download/v${selected.version}/${asset.name}`);
    if (!response.ok || !response.body) {
      throw new ReleaseError(`Home couldn't download the robot app (${asset.name}, HTTP ${response.status}). Check the internet connection, then try again.`);
    }
    // The token is spent only once a response arrived, so a flaky network never locks the install out.
    if (!tryConsume("bot-release-download", GITHUB_RATE)) {
      void response.body.cancel().catch(() => {});
      throw new ReleaseError("Home tried to download the robot app too many times in a row. Wait 10 minutes, then try again.");
    }
    const maxBytes = asset.size ?? DEFAULT_MAX_BYTES;
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > maxBytes) {
      void response.body.cancel().catch(() => {});
      throw new ReleaseError(tooLarge(asset.name));
    }
    const digest = await download(response.body, file, maxBytes, contentLength, asset.name);
    if (digest.toLowerCase() !== asset.sha256.toLowerCase()) throw new ReleaseError(damaged(asset.name));
    await verifySignature(fetcher, selected, asset.name, digest);

    assertSafeNames(await runTar(["-tzf", file], asset.name));
    assertNoHardlinks(await runTar(["-tvzf", file], asset.name));
    mkdirSync(staging);
    const gnu = process.platform !== "darwin";
    await runTar(["--no-same-owner", "--no-same-permissions", ...(gnu ? ["--no-overwrite-dir"] : []), "-xzf", file, "-C", staging], asset.name);
    inspectTree(staging);
    writeFileSync(join(staging, ".verified"), `${digest.toLowerCase()}\n`);
    rmSync(dest, { recursive: true, force: true });
    renameSync(staging, dest);
    rmSync(file, { force: true });
    prune(releases, basename(dest));
    return { dir: dest, version: selected.version };
  } catch (error) {
    rmSync(file, { force: true });
    rmSync(staging, { recursive: true, force: true });
    if (error instanceof ReleaseError) throw new Error(error.message);
    throw new Error(`Home couldn't install the robot app (${asset.name}). Try again; if it keeps failing, update Home.`);
  } finally {
    setRobotReleaseInstall(null);
  }
}

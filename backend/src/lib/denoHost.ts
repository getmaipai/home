// The Tier 1 host (platform plan 4.9, session-d-packages-and-store.md
// step 5): one warm Deno process per Tier 1 package, `--allow-read`/
// `--allow-write` on exactly its own directory, no env, no subprocess,
// no net - a Tier 1 package cannot fetch anything itself; it asks the
// hub to, over the same MCP connection its `handle` tool answers on.
// RPC is MCP over stdio (the official TypeScript SDK): the package is
// the MCP server, `handle` is a tool the hub calls; `host.*` methods are
// server-to-client requests the package sends and this file answers,
// reusing packageHost.ts's own createHost() so a Tier 1 package's
// `host.fetch` gets the identical permission/rate-limit/SSRF/cache
// treatment a Tier 0 recipe's does - one definition, one place, not a
// second copy of that logic for the sandboxed case.
//
// A crash or timeout faults the package for the SESSION (this process's
// own in-memory state, reset on reboot - never persisted, unlike
// lib/smoke.ts's package_status table, since a Tier 1 fault is about
// this one running hub process's sandbox, not a lasting verdict on the
// package itself): the caller gets the manifest's own `fallback_reply`
// instead of an error. Three strikes disables the package until reboot
// and raises a Repairs item (lib/issues.ts).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import { join } from "node:path";
import type { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
import type { PluginResult } from "@maipai/spec/interpreters/ts/recipe-interpreter.js";
import { createHost } from "@/lib/packageHost";
import { raiseIssue, resolveIssue } from "@/lib/issues";
import { tier1PackageDataDir, ensureDataDir } from "@/lib/paths";
import { resolvePackageDir } from "@/lib/packageResolve";
import type { PersonRow } from "@/types";

const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const IDLE_SWEEP_INTERVAL_MS = 60 * 1000;
const DEFAULT_HANDLE_TIMEOUT_MS = 8000;
const MAX_STRIKES = 3;
const ISSUE_SOURCE = "packages.deno";

interface SandboxProcess {
  client: Client;
  transport: StdioClientTransport;
  lastUsedAt: number;
  /** Set right before this file itself closes the connection (idle-kill,
   * a fault-triggered kill after a timeout) - onclose firing with this
   * false means the process died on its own, which is what actually
   * counts as a crash for strike-counting purposes below. */
  closingDeliberately: boolean;
}

const processes = new Map<string, SandboxProcess>();
// A code review (2026-09-06) caught a real race here: two concurrent
// calls for the same not-yet-started package (two family members asking
// at once, a client retry) both saw `processes.get(id)` return nothing
// and both called startProcess(), each spawning its own real `deno run`
// child - whichever finished connecting last won the `processes` map
// slot, leaving the other's process reachable from nowhere,
// unreachable to startIdleSweep() or registerDenoHostGracefulExit()
// (both only ever iterate `processes`), and so a permanently orphaned
// child. This map makes every concurrent caller for the same id await
// the SAME in-flight start instead of racing to create their own.
const startingProcesses = new Map<string, Promise<SandboxProcess>>();
const strikes = new Map<string, number>();
const disabledUntilReboot = new Set<string>();

/** The package's own Deno entrypoint - a fixed filename by convention,
 * the same way Tier 0's own recipe.json always has that exact name
 * (lib/plugins.ts's loadPackage()). No manifest field for this: one
 * shape for every Tier 1 package keeps a package's own directory
 * self-describing without another thing to get wrong in manifest.json. */
function entryPath(id: string): string {
  return join(resolvePackageDir(id), "handler.ts");
}

const HostFetchRequestSchema = z.object({
  method: z.literal("host/fetch"),
  params: z.object({
    url: z.string(),
    opts: z
      .object({
        method: z.enum(["GET", "POST"]).optional(),
        headers: z.record(z.string(), z.string()).optional(),
        body: z.unknown().optional(),
      })
      .optional(),
  }),
});

/** Starts one package's Deno process and connects an MCP Client to it -
 * lazy (only ever called the first time a package is actually invoked
 * after boot or after an idle-kill/fault-kill), never eagerly for every
 * bundled package at startup. */
/** The exact `deno run` argument list the sandbox spawns with - pulled
 * out as its own pure function so the permission shape itself (read
 * scoped to exactly `sourceDir`/`dataDir`, write scoped to `dataDir`
 * alone, no `--allow-net` anywhere, `--cached-only` so a live network
 * fetch of the entry's own module graph can never happen at spawn time
 * either) is directly assertable without needing a real MCP round-trip,
 * and reusable by a real `deno run` integration test proving Deno's own
 * permission model actually enforces it (backend/tests/denoHost.test.ts) -
 * against a disposable temp directory, never a real bundled package
 * under PACKAGES_DIR, so that test can never be mistaken for one of the
 * bronze-completeness suite's own bundled packages. */
export function buildDenoRunArgs(sourceDir: string, dataDir: string, entry: string): string[] {
  return ["run", `--allow-read=${sourceDir},${dataDir}`, `--allow-write=${dataDir}`, "--cached-only", entry];
}

async function startProcess(id: string, manifest: PackageManifest, actor: PersonRow): Promise<SandboxProcess> {
  const sourceDir = resolvePackageDir(id);
  const dataDir = tier1PackageDataDir(id);
  ensureDataDir(dataDir);

  const transport = new StdioClientTransport({
    command: "deno",
    args: buildDenoRunArgs(sourceDir, dataDir, entryPath(id)),
    env: {},
    cwd: sourceDir,
    stderr: "pipe",
  });

  const client = new Client({ name: "maipai-hub", version: "0.1.0" });

  // The one host.* method this spike proves end to end (session-d step
  // 5's own acceptance test): a Tier 1 package's fetch, through the
  // exact same permission/rate-limit/SSRF/cache path a Tier 0 recipe's
  // `host.fetch` already gets from createHost(). No turnId: nothing
  // calls a Tier 1 package from inside a live conversation turn yet
  // (that's C's wiring once it exists), so any memory.remember() a
  // future host.* bridge adds would fall back to the package id, same
  // as an untied Tier 0 run does today.
  client.setRequestHandler(HostFetchRequestSchema, async (req) => {
    const delay = testFetchDelayMs;
    if (delay !== null) await new Promise((resolve) => setTimeout(resolve, delay));
    const host = createHost(actor, manifest);
    const value = await host.fetch(req.params.url, req.params.opts);
    return { value };
  });

  const entry: SandboxProcess = { client, transport, lastUsedAt: Date.now(), closingDeliberately: false };
  client.onclose = () => {
    processes.delete(id);
    if (!entry.closingDeliberately) {
      recordFault(id, manifest, "the sandbox process exited unexpectedly");
    }
  };

  await client.connect(transport);
  processes.set(id, entry);
  return entry;
}

async function killProcess(id: string): Promise<void> {
  const entry = processes.get(id);
  if (!entry) return;
  entry.closingDeliberately = true;
  processes.delete(id);
  await entry.client.close().catch(() => {});
}

/** A crash or timeout: counts a strike, and - past MAX_STRIKES - disables
 * the package for the rest of this boot and raises a Repairs item. Never
 * throws: the caller always gets a real PluginResult back (the
 * manifest's own fallback_reply), the same "a fault is answered, not
 * propagated as a 500" posture a Tier 0 package's own HostError mapping
 * already has at the route layer. */
function recordFault(id: string, manifest: PackageManifest, detail: string): PluginResult {
  const count = (strikes.get(id) ?? 0) + 1;
  strikes.set(id, count);
  if (count >= MAX_STRIKES) {
    disabledUntilReboot.add(id);
    void raiseIssue({
      source: ISSUE_SOURCE,
      key: id,
      severity: "error",
      title: `${id}'s sandbox faulted ${count} times and is disabled until reboot`,
      detail,
    });
  }
  return fallbackResult(manifest);
}

function fallbackResult(manifest: PackageManifest): PluginResult {
  const fallback = manifest.fallback_reply ?? { text: "Sorry, that didn't work. Try again in a moment." };
  return { reply: { text: fallback.text, speech: fallback.speech ?? fallback.text }, actions: [] };
}

function parseHandleResult(result: { content: unknown; isError?: boolean }): PluginResult {
  const content = result.content as { type: string; text?: string }[];
  const text = content.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("handle returned no text content");
  const parsed = JSON.parse(text) as Partial<PluginResult>;
  return { reply: parsed.reply, actions: parsed.actions ?? [], ...(parsed.ask ? { ask: parsed.ask } : {}) };
}

/** Runs a Tier 1 package's `handle` tool for `actor` - lib/plugins.ts's
 * runPlugin() calls this once it sees `manifest.tier === 1`, after the
 * same role/args checks a Tier 0 recipe already gets. A package disabled
 * this boot (three strikes) or a fresh fault both answer with the
 * manifest's own `fallback_reply` rather than an error: the caller
 * (a chat turn, a direct POST /api/plugins/:id/run) always gets a real
 * reply back. */
export async function callTier1Handle(
  id: string,
  manifest: PackageManifest,
  actor: PersonRow,
  inputs: Record<string, unknown>,
): Promise<PluginResult> {
  if (disabledUntilReboot.has(id)) return fallbackResult(manifest);

  let entry = processes.get(id);
  if (!entry) {
    let starting = startingProcesses.get(id);
    if (!starting) {
      starting = startProcess(id, manifest, actor).finally(() => {
        startingProcesses.delete(id);
      });
      startingProcesses.set(id, starting);
    }
    try {
      entry = await starting;
    } catch (err) {
      return recordFault(id, manifest, `failed to start: ${(err as Error).message}`);
    }
  }
  entry.lastUsedAt = Date.now();

  const timeoutMs = manifest.timeout_ms ?? DEFAULT_HANDLE_TIMEOUT_MS;
  try {
    const result = await entry.client.callTool({ name: "handle", arguments: inputs }, undefined, { timeout: timeoutMs });
    if (result.isError) {
      return recordFault(id, manifest, `handle reported an error: ${JSON.stringify(result.content)}`);
    }
    resolveIssue(ISSUE_SOURCE, id);
    strikes.set(id, 0);
    return parseHandleResult(result as { content: unknown; isError?: boolean });
  } catch (err) {
    // A timeout or a transport failure both leave the process in an
    // unknown state - killed here (not left running) so a stuck process
    // never lingers past its own fault; the next call starts fresh.
    await killProcess(id);
    return recordFault(id, manifest, (err as Error).message);
  }
}

let idleSweepTimer: ReturnType<typeof setInterval> | null = null;

/** Closes any process idle past IDLE_TIMEOUT_MS. Started once at boot
 * (index.ts); a no-op with nothing running costs one Map scan every
 * sweep interval. */
export function startIdleSweep(): void {
  if (idleSweepTimer) return;
  idleSweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of processes) {
      if (now - entry.lastUsedAt >= IDLE_TIMEOUT_MS) void killProcess(id);
    }
  }, IDLE_SWEEP_INTERVAL_MS);
}

let gracefulExitRegistered = false;

/** Kills every live Tier 1 sandbox process before the hub itself exits -
 * the same "an exit hook, not the next spawn attempt, is what actually
 * prevents a leaked child" fix lib/sidecars.ts's own registerGracefulExit()
 * already made for sidecars, mirrored here rather than reusing that
 * registry directly: a sidecar is a fixed, named, health-polled service,
 * while a Tier 1 process is one of an open-ended set keyed by package id
 * with its own lazy-start/idle-kill/fault lifecycle - a real mismatch to
 * force into the same abstraction. `process.kill(pid)` by raw pid (not
 * `client.close()`, which is async and "exit" handlers must be
 * synchronous, same reason sidecars.ts's own killAll() calls
 * `entry.proc?.kill()` directly) - the transport's own `pid` getter is
 * only valid once `connect()` has resolved, which every process in the
 * map has already done by the time it's in there. */
export function registerDenoHostGracefulExit(): void {
  if (gracefulExitRegistered) return;
  gracefulExitRegistered = true;
  const killAll = (): void => {
    for (const entry of processes.values()) {
      const pid = entry.transport.pid;
      if (pid) {
        try {
          process.kill(pid);
        } catch {
          // Already gone - not an error, just nothing left to kill.
        }
      }
    }
  };
  process.on("exit", killAll);
  process.on("SIGINT", () => {
    killAll();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    killAll();
    process.exit(0);
  });
}

// A test's own way to make a real handle() call take real time - without
// this, proving the 8-second-default timeout actually faults a stuck
// package would need either a genuinely slow real service (flaky,
// slow to run) or a live network call this codebase's own testing
// standard forbids in the per-commit suite. Delays every host/fetch
// request equally regardless of a cache hit or miss, standing in for
// "the package is slow to answer" in general, not specifically "the
// network is slow."
let testFetchDelayMs: number | null = null;

export function __setTestFetchDelayMsForTests(ms: number | null): void {
  testFetchDelayMs = ms;
}

export function __resetDenoHostForTests(): void {
  for (const id of [...processes.keys()]) void killProcess(id);
  startingProcesses.clear();
  strikes.clear();
  disabledUntilReboot.clear();
  testFetchDelayMs = null;
  if (idleSweepTimer) {
    clearInterval(idleSweepTimer);
    idleSweepTimer = null;
  }
}

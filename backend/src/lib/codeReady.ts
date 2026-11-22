// The Code ready check (2026-11-21): one answer to "can this home run a Code session and an outside coding tool right now", in plain words. It names the first thing
// that is missing, who fixes it, and what to do. Every fact comes from a place that already owns it: the household settings, the Stack's coding role and sandbox
// runtime, the tier slots and the folder the Stack mounts. Read-only: it starts and changes nothing. Counts and states only; no path of a person's work.
import { accessSync, constants, existsSync } from "node:fs";
import path from "node:path";
import { codingPausedByAdmin } from "@/lib/codingPause";
import { codingWorkspaceRoot } from "@/lib/codingShare";
import { sandboxGatewayUrl } from "@/lib/codingGatewayAddress";
import { sandboxBridgeAddress, sandboxBridgePort, sandboxListenerFailure } from "@/lib/codingSandboxListener";
import { getHouseholdSettingValue } from "@/lib/settings";
import { listCodingPieces } from "@/lib/stackCodingPieces";
import { getStackClient, isStackConfigured } from "@/lib/stackEngine";
import { stackDataDir } from "@/lib/localStackService";
import { homePort } from "@/lib/ports";
import { readSlot, type TierCategory } from "@/lib/tiers";

export type CodeReadyId = "coding_on" | "not_paused" | "engine" | "model" | "folder" | "sandbox" | "exec" | "gateway";
export interface CodeReadyItem { id: CodeReadyId; ok: boolean; say: string; who: "an admin" | "the computer's owner" | "nobody" }
export interface CodeReady {
  ready: boolean;
  /** The first thing missing, as one sentence and who does it; null when Code can run. */
  first_missing: { id: CodeReadyId; say: string; who: CodeReadyItem["who"] } | null;
  items: CodeReadyItem[];
  /** What each tier does in Code today: Standard is the engine's coding model; Boost and Max are off until an admin sets a slot (CODE-TIER-02). */
  tiers: { standard: "on"; boost: "on" | "off"; max: "on" | "off" };
  /** Where an outside tool connects: the loopback address on this computer, and the port Home answers on for sandboxes. */
  gateway: { loopback_url: string; away_access: boolean; sandbox_url: string };
}

/** What the Stack says about the sandbox system, or why it could not say. */
export type RuntimeReading =
  | { kind: "ok"; container_system: "running" | "stopped"; image: string; image_built: boolean; network: boolean; detail: string }
  | { kind: "old_engine" }
  | { kind: "unreachable" };

/** Whether the Stack serves the sandbox exec and snapshot routes a turn needs (they are probed against an id that never exists, so nothing runs and nothing is made). */
export type ExecRoutesReading = "present" | "missing" | "unknown";

export interface CodeReadyDeps {
  setting(key: string): unknown;
  paused(): boolean;
  pieces(): Promise<{ stack: "ok" | "unreachable"; missing: string | null }>;
  cannotFit(): Promise<string | null>;
  runtime(): Promise<RuntimeReading>;
  execRoutes(): Promise<ExecRoutesReading>;
  /** What stops the bridge address from serving sandboxes: another program on its port, or an address that is not a plain IPv4 one. Null when nothing does. */
  gatewayProblem(): "port_in_use" | "no_bridge" | null;
  workspaceRoot(): string;
  /** The folder the local Stack mounts workspaces from, or null when the Stack is on another computer. */
  stackCodingFolder(): string | null;
  folderWritable(folder: string): boolean;
  slotOn(category: TierCategory, tier: "boost" | "max"): boolean;
  sandboxUrl(): string;
  port(): number;
}

/** The Stack answers an unknown route with {"error":"Not found"}; a served route answers a sandbox that does not exist with its own sentence (or a 400 for a bad body). */
export async function probeRoute(client: Pick<ReturnType<typeof getStackClient>, "sandboxCall">, path: string, body: unknown): Promise<boolean> {
  const res = await client.sandboxCall!("POST", path, body, { timeoutMs: 5_000 });
  let said = ""; try { said = String((await new Response(res.body).json() as { error?: unknown }).error ?? ""); } catch { /* not JSON: an unknown route */ }
  return !((res.status === 404 || res.status === 405) && (said === "" || said === "Not found"));
}
async function probeExecRoutes(): Promise<ExecRoutesReading> {
  try {
    if (!isStackConfigured()) return "unknown";
    const client = getStackClient();
    if (!client.sandboxCall) return "missing";
    const id = "/stack/v1/sandboxes/readiness-probe";
    const [exec, snap] = await Promise.all([probeRoute(client, `${id}/exec`, { argv: ["true"] }), probeRoute(client, `${id}/snapshots`, { label: "readiness-probe" })]);
    return exec && snap ? "present" : "missing";
  } catch { return "unknown"; }
}

const realDeps: CodeReadyDeps = {
  setting: (key) => getHouseholdSettingValue(key),
  paused: codingPausedByAdmin,
  pieces: async () => { try { const p = await listCodingPieces(); return { stack: p.stack, missing: p.missing }; } catch { return { stack: "unreachable", missing: null }; } },
  cannotFit: async () => { try { return (await getStackClient().roles()).roles.find((role) => role.id === "coding")?.coding?.cannot_fit_reason ?? null; } catch { return null; } },
  runtime: async () => {
    try {
      if (!isStackConfigured()) return { kind: "unreachable" };
      const client = getStackClient();
      if (!client.sandboxCall) return { kind: "old_engine" };
      const res = await client.sandboxCall("GET", "/stack/v1/sandboxes/runtime");
      if (res.status === 404 || res.status === 405) return { kind: "old_engine" };
      if (res.status !== 200) return { kind: "unreachable" };
      const body = await new Response(res.body).json() as Record<string, unknown>;
      return { kind: "ok", container_system: body.container_system === "running" ? "running" : "stopped", image: String(body.image ?? ""), image_built: body.image_built === true, network: body.network === true, detail: String(body.detail ?? "") };
    } catch { return { kind: "unreachable" }; }
  },
  execRoutes: probeExecRoutes,
  gatewayProblem: () => (sandboxListenerFailure() === "port_in_use" ? "port_in_use" : sandboxBridgeAddress() === null || sandboxBridgePort() === null ? "no_bridge" : null),
  workspaceRoot: () => codingWorkspaceRoot(),
  stackCodingFolder: () => (getHouseholdSettingValue("engines.stack.where") === "another_computer" ? null : process.env.STACK_CODING_ROOT?.trim() || path.join(stackDataDir(), "coding")),
  folderWritable: (folder) => {
    let probe = folder;
    while (!existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
    try { accessSync(probe, constants.W_OK); return true; } catch { return false; }
  },
  slotOn: (category, tier) => readSlot(category, tier).model !== "off",
  sandboxUrl: () => sandboxGatewayUrl(),
  port: () => homePort(),
};

export async function codeReady(deps: CodeReadyDeps = realDeps): Promise<CodeReady> {
  const items: CodeReadyItem[] = [];
  const add = (id: CodeReadyId, ok: boolean, say: string, who: CodeReadyItem["who"] = "an admin") => items.push({ id, ok, say, who: ok ? "nobody" : who });

  const on = deps.setting("coding.enabled") === true;
  add("coding_on", on, on ? "Coding is on." : "Coding is off. Turn it on in Settings, then Coding.");
  const paused = deps.paused();
  add("not_paused", !paused, paused ? "Coding is paused. Press Resume coding in Settings, then Coding." : "Coding is not paused.");

  const pieces = await deps.pieces();
  if (pieces.stack === "unreachable") {
    add("engine", false, "Home cannot reach the AI engine. Check that the engine is running, then open this page again.", "the computer's owner");
    add("model", false, "The coding model cannot be checked until the engine answers.", "the computer's owner");
  } else {
    add("engine", true, "The AI engine answers.");
    const cannotFit = await deps.cannotFit();
    const ok = pieces.missing === null && cannotFit === null;
    add("model", ok, ok ? "The coding model is installed and fits in memory." : (pieces.missing ?? cannotFit)!);
  }

  const root = deps.workspaceRoot();
  const stackFolder = deps.stackCodingFolder();
  if (stackFolder !== null && path.resolve(root) !== path.resolve(stackFolder)) add("folder", false, "Code keeps its work in a folder the AI engine will not open. Set MAIPAI_CODING_ROOT to the engine's coding folder and restart Home.", "the computer's owner");
  else if (!deps.folderWritable(root)) add("folder", false, "Home cannot write to the Code work folder. Make the folder writable by Home, then try again.", "the computer's owner");
  else add("folder", true, "The Code work folder is where the engine looks, and Home can write to it.");

  const runtime = await deps.runtime();
  if (runtime.kind === "unreachable") add("sandbox", false, "Home could not ask the engine about the sandbox system. Open this page again when the engine answers.", "the computer's owner");
  else if (runtime.kind === "old_engine") add("sandbox", false, "The engine is too old to say whether the sandbox system is ready. Update the engine, then open this page again.", "the computer's owner");
  else if (runtime.container_system !== "running") add("sandbox", false, "The sandbox system (Apple container) is not running. The engine starts it when a session starts; if it still fails, run container system start on this computer.", "the computer's owner");
  else if (!runtime.image_built) add("sandbox", false, `The sandbox image ${runtime.image} is not built. Build it from the engine's sandbox folder with container build, then open this page again.`, "the computer's owner");
  else if (!runtime.network) add("sandbox", true, "The sandbox system is running and its image is built. Its network is made when the first session starts.");
  else add("sandbox", true, "The sandbox system is running, its image is built and its network exists.");

  const routes = await deps.execRoutes();
  if (routes === "missing") add("exec", false, "The engine cannot run commands or save checkpoints in a sandbox yet, so every Code message would fail. Update the engine, then open this page again.", "the computer's owner");
  else if (routes === "unknown") add("exec", false, "Home could not ask the engine whether it can run commands in a sandbox. Open this page again when the engine answers.", "the computer's owner");
  else add("exec", true, "The engine can run commands and save checkpoints in a sandbox.");

  const url = deps.sandboxUrl();
  const problem = url.length > 0 ? deps.gatewayProblem() : null;
  if (url.length === 0) add("gateway", false, "Code does not know Home's address for sandboxes. Set MAIPAI_SANDBOX_GATEWAY_URL and restart Home.", "the computer's owner");
  else if (problem === "port_in_use") add("gateway", false, "Another program is using the port the coding gateway needs. Close it or change the gateway port, then restart Home.", "the computer's owner");
  else if (problem === "no_bridge") add("gateway", false, "Home's address for sandboxes is not a plain network address, so the coding gateway cannot start. Set MAIPAI_SANDBOX_GATEWAY_URL to one and restart Home.", "the computer's owner");
  else add("gateway", true, "A session's sandbox can reach Home's coding address.");

  const firstBad = items.find((item) => !item.ok);
  return {
    ready: !firstBad,
    first_missing: firstBad ? { id: firstBad.id, say: firstBad.say, who: firstBad.who } : null,
    items,
    tiers: { standard: "on", boost: deps.slotOn("coding", "boost") ? "on" : "off", max: deps.slotOn("coding", "max") ? "on" : "off" },
    gateway: { loopback_url: `http://127.0.0.1:${deps.port()}/code/v1`, away_access: deps.setting("coding.api.away") === true, sandbox_url: url },
  };
}

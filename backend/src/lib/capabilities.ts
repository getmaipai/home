// CAP-GATE-01 / R1: the one place a package's `requires` and `optional`
// (capabilities from spec/vocab/capabilities.json) and its `offline` field
// are compared with what this hub can do right now.
//
// The node's capability set is derived from state the hub already has:
// the Stack's own role list (GET /stack/v1/roles: a role that is
// `notInstalled` is off) and the internet probe's last recorded state
// (lib/statusHistory.ts). A capability maps to `true` or `false` only when
// one of those says so. A capability this hub cannot derive (a device
// capability such as `motors`, the chat role's `gpu_llm`/`cpu_llm` split,
// or any capability while the Stack does not answer) is absent from the
// map and never gates, so an unreachable Stack never hides a package. The
// per-role Setting record the backlog item describes does not exist at the
// pinned spec, so the Stack's own role state is the allocation read here.
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { statusEvents } from "@/db/schema";
import { getStackClient, isStackConfigured } from "@/lib/stackEngine";
import type { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";

/** Stack role id -> the capability-vocabulary name it provides. `chat`
 * maps to `gpu_llm` or `cpu_llm` and cannot be told apart here, so it is
 * left out rather than guessed. */
const ROLE_TO_CAPABILITY: Readonly<Record<string, string>> = {
  embed: "embeddings",
  vision: "vision",
  stt: "stt",
  tts: "tts",
  image: "image",
  video: "video",
  music: "music",
};

export type NodeCapabilities = ReadonlyMap<string, boolean>;

/** Whether the hub's last internet probe says it has no network. No
 * recorded state (probe off, nothing sampled yet) is not "down". */
export function internetIsDown(): boolean {
  const last = db.select({ state: statusEvents.state }).from(statusEvents).where(eq(statusEvents.component, "internet")).orderBy(desc(statusEvents.at)).limit(1).get();
  return last?.state === "outage";
}

export async function nodeCapabilities(): Promise<NodeCapabilities> {
  const caps = new Map<string, boolean>();
  caps.set("internet", !internetIsDown());
  if (!isStackConfigured()) return caps;
  try {
    const { roles } = await getStackClient().roles();
    for (const role of roles) {
      const capability = ROLE_TO_CAPABILITY[role.id];
      if (capability) caps.set(capability, role.state.state !== "notInstalled");
    }
  } catch {
    // The Stack not answering says nothing about what is installed.
  }
  return caps;
}

export interface CapabilityGate {
  /** Required capabilities the node says are off. Non-empty means the package is hidden and does not run. */
  missing: string[];
  /** Optional capabilities the node says are off. The package stays and is marked degraded. */
  degraded: string[];
}

export function capabilityGate(manifest: Pick<PackageManifest, "requires" | "optional">, caps: NodeCapabilities): CapabilityGate {
  return {
    missing: (manifest.requires ?? []).filter((name) => caps.get(name) === false),
    degraded: (manifest.optional ?? []).filter((name) => caps.get(name) === false),
  };
}

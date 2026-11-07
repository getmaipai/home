// AGENT-SVC-01: the read-only `uptime` tool over the household's Uptime Kuma instances.
// Offered to adults only, when at least one enabled uptime_kuma instance exists. It reads, never changes anything, so it has no
// confirmation, undo or brake. The audit row carries the action name and the result only: never an instance slug, label or monitor name (C3).
import { z } from "zod";
import type { ToolSpec } from "@/lib/llm";
import { outcomeOf, type ToolExecutionOutcome } from "@/lib/turnContext";
import { recordToolAudit } from "@/lib/toolAudit";
import { listInstances, type ConnectorInstance } from "@/lib/connectors/instances";
import type { PersonRow } from "@/types";
import { fetchKumaStatus, type KumaFailureKind, type KumaMonitor, type KumaResult } from "./kuma";
import { UPTIME_TOOL_ID } from "./ids";
export { UPTIME_TOOL_ID } from "./ids";

export const UPTIME_ACTIONS = ["status", "list"] as const;
const LIST_ROWS_MAX = 60;
const NAME_MAX = 80;

/** Audit rows take the action name only from this closed list. */
export function safeUptimeAction(value: unknown): string { return typeof value === "string" && (UPTIME_ACTIONS as readonly string[]).includes(value) ? value : "invalid"; }

const UptimeArgs = z.object({
  action: z.enum(UPTIME_ACTIONS),
  name: z.string().trim().min(1).max(64).optional(),
  instance: z.string().min(1).max(31).optional(),
}).strict();

export type UptimeToolDeps = {
  instances?: () => ConnectorInstance[];
  fetchStatus?: (instance: ConnectorInstance) => Promise<KumaResult>;
  audit?: typeof recordToolAudit;
};

/** The instances a speaker can ask about: every enabled uptime_kuma instance (there is no virtual default for this type). */
export function visibleUptimeInstances(deps: Pick<UptimeToolDeps, "instances"> = {}): ConnectorInstance[] {
  return (deps.instances ?? (() => listInstances("uptime_kuma")))();
}

/** The offer gate: an adult in the owner, admin or adult role, on a written chat turn, with at least one enabled instance. */
export function uptimeAllowed(input: { actor: Pick<PersonRow, "role">; band: string; surface?: string; surfaceClass: string; spoken: boolean; bare: boolean }, deps: Pick<UptimeToolDeps, "instances"> = {}): boolean {
  if (input.band !== "adult" || !(input.actor.role === "owner" || input.actor.role === "admin" || input.actor.role === "adult")) return false;
  if (input.bare || input.spoken || input.surfaceClass !== "written" || input.surface === "robot") return false;
  return visibleUptimeInstances(deps).length > 0;
}

/** Rule 1: the `instance` argument exists only when this speaker can see more than one instance; with one it is implied. */
export function uptimeToolSpec(instances: readonly Pick<ConnectorInstance, "instance" | "label">[]): ToolSpec {
  return {
    id: UPTIME_TOOL_ID,
    description: "Check whether the household's services are up. Use action status for a short summary of what is up or down, or list for each monitor with its status and 24 hour uptime. Pass name to narrow to monitors whose name contains it.",
    args: { type: "object", required: ["action"], properties: {
      action: { type: "string", enum: [...UPTIME_ACTIONS] },
      name: { type: "string", maxLength: 64 },
      ...(instances.length > 1 ? { instance: { type: "string", enum: instances.map((item) => item.instance), description: `Which Uptime Kuma: ${instances.map((item) => `${item.instance} is ${item.label}`).join("; ")}. Leave out to check all of them.` } } : {}),
    }, additionalProperties: false },
  };
}

function clean(value: string): string { return value.replace(/\s+/g, " ").trim().slice(0, NAME_MAX); }

function fail(callId: string, line: string, failureKind: "unavailable" | "bad_arguments" | "found_nothing", status: "failed" | "rejected" = "failed"): ToolExecutionOutcome {
  return outcomeOf({ callId, packageId: UPTIME_TOOL_ID, status, via: "tool_call", args: {}, durationMs: 0, errorCode: "uptime_tool", failureKind, userMessage: line } as Parameters<typeof outcomeOf>[0]);
}

function summary(monitors: readonly KumaMonitor[]): string {
  if (monitors.length === 0) return "no monitors";
  const named = (status: KumaMonitor["status"]) => monitors.filter((monitor) => monitor.status === status).map((monitor) => clean(monitor.name));
  const down = named("down");
  const parts: string[] = [];
  if (down.length) parts.push(`${down.length} down: ${down.join(", ")}`);
  for (const [status, word] of [["pending", "pending"], ["maintenance", "in maintenance"], ["unknown", "unknown"]] as const) {
    const names = named(status);
    if (names.length) parts.push(`${names.length} ${word}: ${names.join(", ")}`);
  }
  if (parts.length === 0) return `all ${monitors.length} up`;
  const up = monitors.length - monitors.filter((monitor) => monitor.status !== "up").length;
  return up > 0 ? `${parts.join("; ")}; ${up} up` : parts.join("; ");
}

const problem = (kind: KumaFailureKind, who: string): string => kind === "not_configured" ? `${who} has no status page set up.` : `${who} did not answer.`;

export async function runUptimeTool({ actor, band, args, callId, deps = {} }: { actor: Pick<PersonRow, "id" | "role">; band: string; args: Record<string, unknown>; callId: string; deps?: UptimeToolDeps }): Promise<ToolExecutionOutcome> {
  const audit = deps.audit ?? recordToolAudit;
  const action = safeUptimeAction(args.action);
  const done = (outcome: ToolExecutionOutcome, ok: boolean, count: number): ToolExecutionOutcome => {
    audit({ personId: actor.id, tool: UPTIME_TOOL_ID, action, decision: ok ? "do" : "never", band, count });
    return outcome;
  };
  if (band !== "adult" || !(actor.role === "owner" || actor.role === "admin" || actor.role === "adult")) {
    return done(fail(callId, "Service checks are not available for this speaker.", "found_nothing", "rejected"), false, 0);
  }
  const parsed = UptimeArgs.safeParse(args);
  if (!parsed.success) return done(fail(callId, "That service check was not valid. Ask for the status or the list, and optionally a monitor name.", "bad_arguments", "rejected"), false, 0);
  const input = parsed.data;

  const all = visibleUptimeInstances(deps);
  const chosen = input.instance === undefined ? all : all.filter((item) => item.instance === input.instance);
  if (chosen.length === 0) return done(fail(callId, "There is no service monitor to check.", "found_nothing"), false, 0);
  const several = chosen.length > 1;

  const fetchStatus = deps.fetchStatus ?? ((instance: ConnectorInstance) => fetchKumaStatus(instance));
  const results = await Promise.all(chosen.map(async (instance) => ({ instance, result: await fetchStatus(instance).catch((): KumaResult => ({ ok: false, kind: "unreachable" })) })));

  const needle = input.name?.toLocaleLowerCase();
  const matches = (monitor: KumaMonitor) => needle === undefined || monitor.name.toLocaleLowerCase().includes(needle);
  const lines: string[] = [];
  const problems: string[] = [];
  const rows: Array<{ monitor: KumaMonitor; label: string }> = [];
  let answered = 0;
  for (const { instance, result } of results) {
    if (!result.ok) { problems.push(problem(result.kind, several ? `The ${clean(instance.label)} Kuma` : "Uptime Kuma")); continue; }
    answered += 1;
    const found = result.monitors.filter(matches);
    if (found.length === 0 && needle !== undefined) continue;
    if (input.action === "status") {
      const line = summary(found);
      lines.push(several ? `${clean(instance.label)}: ${line}` : `${line.charAt(0).toLocaleUpperCase()}${line.slice(1)}`);
    }
    else for (const monitor of found) rows.push({ monitor, label: clean(instance.label) });
  }

  if (answered === 0) return done(fail(callId, problems.join(" "), "unavailable"), false, 0);
  const shown = input.action === "status" ? lines.length : rows.length;
  if (shown === 0) return done(fail(callId, `${needle === undefined ? "No monitors were found." : "No monitor matches that name."}${problems.length ? ` ${problems.join(" ")}` : ""}`, "found_nothing"), false, 0);

  let body: string;
  if (input.action === "status") body = lines.join("\n");
  else {
    const text = rows.slice(0, LIST_ROWS_MAX).map(({ monitor, label }) => `${clean(monitor.name)}: ${monitor.status}${monitor.uptime24h === null ? "" : `, ${monitor.uptime24h}% in 24 hours`}${several ? `, ${label}` : ""}`);
    body = `${text.join("\n")}${rows.length > LIST_ROWS_MAX ? `\nand ${rows.length - LIST_ROWS_MAX} more` : ""}`;
  }
  const reply = problems.length ? `${body}\n${problems.join(" ")}` : body;
  return done(outcomeOf({ callId, packageId: UPTIME_TOOL_ID, status: "succeeded", via: "tool_call", args: { action }, durationMs: 0, result: { reply: { text: reply }, data: {}, actions: [] } }), true, shown);
}

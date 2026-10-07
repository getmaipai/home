import permissions from "@maipai/spec/vocab/permissions.json" with { type: "json" };
import grantActions from "@maipai/spec/vocab/grant-actions.json" with { type: "json" };
import { meetsMinRole } from "@/lib/plugins";
import type { Approver, GateDecision, GateRequest } from "./types";

type Policy = { approver: Record<"child" | "teen" | "adult", Approver>; by_parameter?: Record<string, Record<"child" | "teen" | "adult", Approver>> };
type Entry = { id: string; policy?: Policy; policy_ref?: string };
const permissionRows = permissions.permissions as Entry[];
const grantRows = grantActions.actions as Entry[];
const order: Record<Approver, number> = { none: 0, self: 1, parent: 2, never: 3 };

function rowFor(id: string): Entry | undefined {
  const all = [...permissionRows, ...grantRows];
  return all.find((row) => row.id === id) ?? all.find((row) => row.id.endsWith("<host>") && id.startsWith("net:"))
    ?? all.find((row) => row.id.endsWith("<domain>") && id.startsWith("home:"))
    ?? all.find((row) => row.id.endsWith("<kind>") && id.startsWith("actions:"))
    ?? all.find((row) => row.id.endsWith("<id>") && id.startsWith("integration:"))
    ?? all.find((row) => row.id.endsWith("<path>") && id.startsWith("files:"));
}

function cell(id: string, band: "child" | "teen" | "adult"): Approver {
  const row = rowFor(id);
  const sharedRow = row?.policy_ref === "permissions" ? permissionRows.find((r) => r.id === row.id) : undefined;
  const policy = row?.policy ?? sharedRow?.policy;
  if (!policy) return band === "adult" ? "self" : "parent";
  const parameter = id.slice(id.indexOf(":") + 1);
  return policy.by_parameter?.[parameter]?.[band] ?? policy.approver[band];
}

export function decide(request: GateRequest): GateDecision {
  const { who, what } = request;
  const audit = { capabilities: [...what.capabilities], band: who.band };
  const deny = (reason: Extract<GateDecision, { kind: "deny" }> ["reason"]): GateDecision => ({ kind: "deny", reason, audit });
  if (request.context?.crisis) return deny("crisis_state");
  if (what.minRole && !meetsMinRole(who.role, what.minRole)) return deny("min_band");
  if (who.anonymous && what.capabilities.some((id) => id === "memory:read" || id === "memory:write")) return deny("anonymous_speaker");
  if (request.context?.temporary && what.capabilities.includes("memory:write")) return deny("temporary_mode");
  if (what.denied) return deny("grant_denied");
  const band = who.band;
  let needed: Approver = "none";
  for (const id of what.capabilities) {
    let value = cell(id, band);
    if (what.consequential && value === "none") value = "self";
    if (order[value] > order[needed]) needed = value;
  }
  if (needed === "never") return deny("never_for_band");
  if (needed === "parent") return { kind: "ask_parent", summary: what.summary ?? "This action needs a parent.", audit };
  if (needed === "self") return { kind: "ask_self", prompt: "Would you like me to go ahead?", audit };
  return { kind: "allow", audit };
}

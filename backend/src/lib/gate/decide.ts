import permissions from "@maipai/spec/vocab/permissions.json" with { type: "json" };
import grantActions from "@maipai/spec/vocab/grant-actions.json" with { type: "json" };
import type { Approver, DenyReason, GateDecision, GateRequest, Provenance } from "./types";

type Band = "child" | "teen" | "adult";
type Risk = "read" | "lookup" | "chosen_destination" | "write_own" | "write_household" | "action" | "spend" | "admin";
type Policy = {
  risk: Risk;
  approver: Record<Band, Approver>;
  by_parameter?: Record<string, Record<Band, Approver>>;
  limits?: string[];
};
type Entry = { id: string; policy?: Policy; policy_ref?: string };
type RegistryEntry = { id: string; policy: Policy };

const bands: Band[] = ["child", "teen", "adult"];
const order: Record<Approver, number> = { none: 0, self: 1, parent: 2, never: 3 };
const decisionObjects = new WeakSet<object>();

function buildRegistry(): readonly RegistryEntry[] {
  const permissionRows = permissions.permissions as Entry[];
  const grantRows = grantActions.actions as Entry[];
  const source = new Map(permissionRows.map((row) => [row.id, row]));
  const rows = [...permissionRows, ...grantRows];
  const seen = new Set<string>();
  const resolved: RegistryEntry[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) {
      // grant-actions deliberately repeats integration:<id> as a reference.
      if (row.policy_ref === "permissions" && source.has(row.id)) continue;
      throw new Error(`duplicate capability policy: ${row.id}`);
    }
    seen.add(row.id);
    const policy = row.policy ?? (row.policy_ref === "permissions" ? source.get(row.id)?.policy : undefined);
    if (!policy) throw new Error(`capability has no policy: ${row.id}`);
    for (const band of bands) {
      if (!(policy.approver[band] in order)) throw new Error(`invalid ${band} approver for ${row.id}`);
    }
    Object.freeze(policy.approver);
    for (const overrides of Object.values(policy.by_parameter ?? {})) Object.freeze(overrides);
    if (policy.by_parameter) Object.freeze(policy.by_parameter);
    if (policy.limits) Object.freeze(policy.limits);
    Object.freeze(policy);
    resolved.push(Object.freeze({ id: row.id, policy }));
  }
  return Object.freeze(resolved);
}

const registry = buildRegistry();
const exact = new Map(registry.map((row) => [row.id, row]));
const templates = registry.filter((row) => row.id.includes("<")).sort((a, b) => b.id.length - a.id.length);

function rowFor(id: string): RegistryEntry | undefined {
  const literal = exact.get(id);
  if (literal) return literal;
  // Placeholder matching is deliberately exact about the surrounding prefix
  // and suffix, and the longest template wins if the vocabulary grows.
  return templates.find(({ id: template }) => {
      const [prefix, suffix = ""] = template.split(/<[^>]+>/, 2);
      return id.startsWith(prefix!) && id.endsWith(suffix) && id.length > prefix!.length + suffix.length;
    });
}

function capabilityPolicy(id: string): Policy | undefined {
  return rowFor(id)?.policy;
}

function approverFor(id: string, band: Band, explicitParameter?: string): Approver {
  const row = rowFor(id);
  if (!row) return band === "adult" ? "self" : "parent";
  const parameter = explicitParameter ?? (row.id.includes("<") ? id.slice(row.id.indexOf(":") + 1) : "");
  return row.policy.by_parameter?.[parameter]?.[band] ?? row.policy.approver[band];
}

function roleMeetsFloor(role: string, minimum: string): boolean {
  const ladder = ["owner", "admin", "adult", "teen", "child", "guest"];
  const actorIndex = ladder.indexOf(role);
  const minimumIndex = ladder.indexOf(minimum);
  return actorIndex >= 0 && minimumIndex >= 0 && actorIndex <= minimumIndex;
}

function makeDecision<T extends GateDecision>(decision: T): T {
  Object.freeze(decision.audit.capabilities);
  if (decision.kind === "allow_with_limits") Object.freeze(decision.limits);
  Object.freeze(decision.audit);
  Object.freeze(decision);
  decisionObjects.add(decision);
  return decision;
}

/** Reject decisions not returned by this module, including hand-built or copied objects. */
export function assertGated(decision: unknown): asserts decision is GateDecision {
  if (!decision || typeof decision !== "object" || !decisionObjects.has(decision)) {
    throw new Error("effect requires a decision returned by gate.decide()");
  }
}

export function registeredCapabilities(): readonly string[] {
  return Object.freeze(registry.map(({ id }) => id));
}

export function decide(request: GateRequest): GateDecision {
  const { who, what } = request;
  const provenance: Provenance = request.context?.provenance ?? "person";
  const audit = { capabilities: [...what.capabilities], band: who.band, provenance };
  const result = (decision: GateDecision) => makeDecision(decision);
  const deny = (reason: DenyReason): GateDecision => result({ kind: "deny", reason, audit });

  if (request.context?.crisis && what.capabilities.some((id) => ["lookup", "chosen_destination", "action", "spend"].includes(capabilityPolicy(id)?.risk ?? ""))) return deny("crisis_state");
  if (who.anonymous && what.capabilities.some((id) => id.startsWith("memory:") || id.startsWith("memory."))) return deny("anonymous_speaker");
  if ((request.context?.temporary || request.context?.incognito) && (request.context.incognitoBlocked || what.capabilities.includes("memory:write"))) return deny("temporary_mode");
  if (what.minRole && !roleMeetsFloor(who.role, what.minRole)) return deny("min_band");
  if (what.denied) return deny("grant_denied");

  const decisions = what.capabilities.map((id) => ({ id, policy: capabilityPolicy(id), approver: approverFor(id, who.band, what.parameters?.[id]) }));
  if (decisions.some(({ approver }) => approver === "never")) return deny("never_for_band");

  if (provenance === "untrusted") {
    const affected = decisions.some(({ policy }) => !policy || ["write_household", "action", "spend", "chosen_destination"].includes(policy.risk));
    if (affected) {
      if (who.band === "child") return deny("tainted_action");
      if (who.band === "teen" && decisions.some(({ policy }) => policy && ["action", "spend"].includes(policy.risk))) return deny("tainted_action");
      return result({ kind: "ask_self", prompt: "Would you like me to go ahead?", audit });
    }
  }

  let needed: Approver = "none";
  for (const { id, approver } of decisions) {
    let value = approver;
    if (what.consequential && value === "none") value = "self";
    if (order[value] > order[needed]) needed = value;
  }
  if (needed === "parent" && (request.context?.temporary || request.context?.incognito)) return deny("needs_parent_unavailable");
  if (needed === "never") return deny("never_for_band");
  if (needed === "parent") return result({ kind: "ask_parent", summary: what.summary ?? "This action needs a parent.", audit });
  if (needed === "self") return result({ kind: "ask_self", prompt: "Would you like me to go ahead?", audit });

  const limits = [...new Set(decisions.flatMap(({ policy }) => policy?.limits ?? []))];
  if (limits.length) return result({ kind: "allow_with_limits", limits, audit });
  return result({ kind: "allow", audit });
}

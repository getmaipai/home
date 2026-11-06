import { z } from "zod";
import type { ToolSpec } from "@/lib/llm";
import { outcomeOf, type ToolExecutionOutcome } from "@/lib/turnContext";
import type { PersonRow } from "@/types";
import { effectivePermissions } from "@/lib/permissions";
import { brakeFor, type BrakeMode } from "@/lib/toolBrake";
import { recordToolAudit } from "@/lib/toolAudit";
import { recordUndo, undoPropsFor, type UndoInverse } from "@/lib/toolUndo";
import { blockEnvelope } from "@/lib/packageBlocks";
import { getHouseholdSettingValue } from "@/lib/settings";
import { houseLanFetch } from "./connection";
import { fetchHouseRegistry, type HouseArea, type HouseEntity, type HouseKind } from "./registry";
import { houseAccess, visibleEntities, type EffectivePermission, type HouseActor, type HouseBand } from "./access";
import { houseServiceCall, performHouseAction, supportedActions, type HouseActionInput, type HouseActionName, type HouseActionResult } from "./act";

export const HOUSE_TOOL_ID = "house";
const kinds = ["light", "switch", "scene", "cover", "lock", "fan", "climate"] as const;
const actions = ["find", "turn_on", "turn_off", "set_brightness", "set_color", "set_speed", "open", "close", "lock", "unlock", "activate", "set_temperature"] as const;
const argsSchema = z.object({
  action: z.enum(actions),
  targets: z.array(z.object({ area: z.string().min(1).optional(), name: z.string().min(1).optional(), kind: z.enum(kinds).optional() }).strict()).max(25).optional(),
  value: z.number().finite().optional(),
  rgb: z.tuple([z.number().int().min(0).max(255), z.number().int().min(0).max(255), z.number().int().min(0).max(255)]).optional(),
}).strict();
type HouseArgs = z.infer<typeof argsSchema>;
export type HouseToolDeps = {
  loadRegistry?: () => Promise<{ ok: true; areas: HouseArea[]; entities: HouseEntity[] } | { ok: false; kind: "unreachable" | "refused" | "timeout" }>;
  permissionsOf?: (personId: string) => EffectivePermission[];
  perform?: (entity: HouseEntity, action: HouseActionInput) => Promise<HouseActionResult>;
  brakeMode?: () => BrakeMode;
  audit?: (input: { personId: string; tool: string; action: string; decision: string; band: string; count: number }) => void;
  undo?: (input: { personId: string; turnId?: string; tool: string; action: string; inverse: UndoInverse }, now?: Date) => { id: string; expiresAt: string };
  now?: () => Date;
};

let cachedAt = 0;
let cachedRegistry: Awaited<ReturnType<typeof loadHouseRegistry>> | undefined;
let registryFlight: Promise<Awaited<ReturnType<typeof loadHouseRegistry>>> | undefined;
async function loadHouseRegistry() {
  const connection = houseLanFetch();
  if (!connection.ok) return { ok: false as const, kind: "unreachable" as const };
  return fetchHouseRegistry({ lanFetch: connection.lanFetch, token: connection.token });
}
async function defaultLoadRegistry() {
  const now = Date.now();
  if (cachedRegistry && now - cachedAt < 30_000) return cachedRegistry;
  if (!registryFlight) registryFlight = loadHouseRegistry().then((value) => { if (value.ok) { cachedRegistry = value; cachedAt = Date.now(); } else cachedRegistry = undefined; return value; }).finally(() => { registryFlight = undefined; });
  return registryFlight;
}

export function houseToolSpec(ctx: { visible: HouseEntity[]; areas: HouseArea[] }): ToolSpec {
  const areaIds = new Set(ctx.visible.flatMap((entity) => entity.area ? [entity.area] : []));
  const areaNames = [...new Set(ctx.areas.filter((area) => areaIds.has(area.id)).map((area) => area.name))].sort((a, b) => a.localeCompare(b)).slice(0, 40);
  return {
    id: HOUSE_TOOL_ID,
    description: "Find visible home devices and scenes or control devices you are allowed to use. Name an area or device in your arguments; use find to see what is available.",
    args: { type: "object", required: ["action"], properties: {
      action: { type: "string", enum: actions },
      targets: { type: "array", maxItems: 25, items: { type: "object", properties: { area: { type: "string", ...(areaNames.length ? { enum: areaNames } : {}) }, name: { type: "string" }, kind: { type: "string", enum: kinds } }, additionalProperties: false } },
      value: { type: "number" }, rgb: { type: "array", minItems: 3, maxItems: 3, items: { type: "integer", minimum: 0, maximum: 255 } },
    }, additionalProperties: false },
  };
}

/** Everything this speaker may see, with scenes held to the member rule: a scene is offered only when every entity it sets is
 * one the speaker may control (a scene can set locks, covers and the alarm). A scene whose members are unknown is for adults only. */
export function visibleHouseEntities({ actor, permissions, entities }: { actor: HouseActor; permissions: readonly EffectivePermission[]; entities: readonly HouseEntity[] }): HouseEntity[] {
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const sceneOk = (scene: HouseEntity): boolean => {
    if (scene.sceneMembers === null) return actor.band === "adult";
    return scene.sceneMembers.every((id) => {
      const member = byId.get(id);
      return member ? houseAccess({ actor, permissions, entity: member, level: "control" }).allowed : actor.band === "adult";
    });
  };
  return visibleEntities({ actor, permissions, entities, level: "see" }).filter((entity) => entity.kind !== "scene" || sceneOk(entity));
}

/** Only an exact "do" or "never" is believed; anything else (unset, empty, a typo) is ask. */
function brakeModeOf(value: unknown): BrakeMode { return value === "do" || value === "never" ? value : "ask"; }

function normalize(value: string): string { return value.trim().replace(/\s+/g, " ").toLocaleLowerCase(); }
function areaName(entity: HouseEntity, areas: HouseArea[]): string { return areas.find((area) => area.id === entity.area)?.name ?? "the home"; }
function fail(callId: string, raw: Record<string, unknown>, line: string, status: "failed" | "rejected" = "failed", confirmNeeded = false): ToolExecutionOutcome {
  return outcomeOf({ callId, packageId: HOUSE_TOOL_ID, status, via: "tool_call", args: raw, durationMs: 0, errorCode: "house_tool", failureKind: "unavailable", userMessage: line, ...(confirmNeeded ? { confirmNeeded: true } as object : {}) } as Parameters<typeof outcomeOf>[0]);
}
function reply(callId: string, raw: Record<string, unknown>, text: string, blocks: Record<string, unknown>[] = []): ToolExecutionOutcome {
  return outcomeOf({ callId, packageId: HOUSE_TOOL_ID, status: "succeeded", via: "tool_call", args: raw, durationMs: 0, result: { reply: { text }, data: blocks.length ? { blocks } : {}, actions: [] } });
}
const failureCopy: Record<string, string> = {
  unreachable: "Home Assistant did not answer. Check that it is on and try again.", timeout: "Home Assistant took too long to answer. Try again.",
  refused: "Home Assistant could not complete that request. Check the device and try again.", not_confirmed: "The device did not confirm the change. Check its state and try again.",
};

function resolveTargets(targets: NonNullable<HouseArgs["targets"]>, entities: HouseEntity[], areas: HouseArea[]): { matches: HouseEntity[]; ambiguous?: string[]; missing?: boolean } {
  const selected: HouseEntity[] = [];
  for (const target of targets) {
    const filtered = entities.filter((entity) => (!target.kind || entity.kind === target.kind) && (!target.area || normalize(areaName(entity, areas)) === normalize(target.area)));
    if (target.name) {
      const matches = filtered.filter((entity) => normalize(entity.name) === normalize(target.name!));
      if (matches.length > 1) return { matches: [], ambiguous: matches.slice(0, 8).map((entity) => entity.name) };
      if (matches.length === 0) return { matches: [], missing: true };
      selected.push(matches[0]!);
    } else if (target.area) selected.push(...filtered);
    else return { matches: [], missing: true };
  }
  return { matches: [...new Map(selected.map((entity) => [entity.id, entity])).values()] };
}

export async function runHouseTool({ actor, band: bandIn, args, callId, tainted = false, approved = false, deps = {} }: { actor: PersonRow | HouseActor; band: HouseBand; args: Record<string, unknown>; callId: string; tainted?: boolean; approved?: boolean; deps?: HouseToolDeps }): Promise<ToolExecutionOutcome> {
  const parsed = argsSchema.safeParse(args);
  if (!parsed.success) return fail(callId, {}, "That home request was invalid. Name an area or device and try again.");
  const input = parsed.data;
  const personId = actor.id;
  const roleBand: HouseBand = "role" in actor && (actor.role === "child" || actor.role === "teen") ? actor.role : "adult";
  const band: HouseBand = bandIn === "child" || roleBand === "child" ? "child" : bandIn === "teen" || roleBand === "teen" ? "teen" : "adult";
  const houseActor: HouseActor = { id: personId, role: "role" in actor ? String(actor.role) as HouseActor["role"] : "unknown", band };
  if (!personId || houseActor.role === "unknown" || houseActor.role === "guest") return fail(callId, {}, "Home controls are not available for this speaker.", "rejected");
  const registry = await (deps.loadRegistry ?? defaultLoadRegistry)();
  if (!registry.ok) return fail(callId, {}, failureCopy[registry.kind] ?? failureCopy.unreachable!);
  const permissions = (deps.permissionsOf ?? effectivePermissions)(personId);
  const visible = visibleHouseEntities({ actor: houseActor, permissions, entities: registry.entities });
  const mode = brakeModeOf((deps.brakeMode ?? (() => getHouseholdSettingValue("tools.house.mode")))());
  if (mode === "never") return outcomeOf({ callId, packageId: HOUSE_TOOL_ID, status: "rejected", via: "tool_call", args, durationMs: 0, reason: "unconfirmed", userMessage: "Home controls are turned off for this household.", ...({ confirmNeeded: false } as object) } as Parameters<typeof outcomeOf>[0]);
  if (input.action === "find") {
    const filtered = visible.filter((entity) => (input.targets ?? []).every((target) => (!target.area || normalize(areaName(entity, registry.areas)) === normalize(target.area)) && (!target.kind || target.kind === entity.kind))).slice(0, 26);
    const shown = filtered.slice(0, 25);
    const list = shown.map((entity) => `${entity.name} (${areaName(entity, registry.areas)}, ${entity.kind}, ${entity.state})`).join("; ");
    return reply(callId, args, shown.length ? `Found ${shown.length} visible home ${shown.length === 1 ? "device" : "devices"}${filtered.length > 25 ? "; there are more" : ""}: ${list}.` : "I did not find any visible device there.");
  }
  const resolved = resolveTargets(input.targets ?? [], visible, registry.areas);
  if (resolved.ambiguous) return reply(callId, args, `That name matches more than one device: ${resolved.ambiguous.join(", ")}. Please be more specific.`);
  if (resolved.missing || resolved.matches.length === 0) return reply(callId, args, "I could not find a visible device matching that area or name.");
  const action: HouseActionInput = { name: input.action as HouseActionName, ...(input.value !== undefined ? { value: input.value } : {}), ...(input.rgb ? { rgb: input.rgb } : {}) };
  if (resolved.matches.length > 12) return reply(callId, args, "That would control too many devices at once. Choose a smaller area or name specific devices.");
  if (resolved.matches.some((entity) => !supportedActions(entity).includes(action.name))) return reply(callId, args, "That action is not available for the selected device. Choose a supported action and try again.");
  const control = resolved.matches.map((entity) => ({ entity, access: houseAccess({ actor: houseActor, permissions, entity, level: "control" }) }));
  if (control.some((item) => !item.access.allowed)) return reply(callId, args, "You are not set up to control that.");
  const confirm = control.some(({ entity }) => !!entity.sensitive && houseAccess({ actor: houseActor, permissions, entity, level: "confirm" }).confirm);
  const byId = new Map(registry.entities.map((entity) => [entity.id, entity]));
  // A scene can set locks, covers and the alarm: it asks whenever it has unknown members or any sensitive member.
  const sceneNeedsAsk = control.some(({ entity }) => entity.kind === "scene" && (entity.sceneMembers === null || entity.sceneMembers.some((id) => !byId.get(id) || !!byId.get(id)!.sensitive)));
  const mustAsk = sceneNeedsAsk || confirm || control.some(({ entity }) => !!entity.sensitive && houseAccess({ actor: houseActor, permissions, entity, level: "confirm" }).reason === "no_grant");
  const decision = brakeFor({ tool: "house", action: input.action, confirm: mustAsk, targets: control.length, tainted, mode, actor: { id: personId, role: houseActor.role, band }, args });
  if (decision.decision === "never") return outcomeOf({ callId, packageId: HOUSE_TOOL_ID, status: "rejected", via: "tool_call", args, durationMs: 0, reason: "unconfirmed", userMessage: "Home controls are turned off for this household.", ...({ confirmNeeded: false } as object) } as Parameters<typeof outcomeOf>[0]);
  // approved is set by the turn engine only when this exact call was parked and the speaker answered yes; it never lifts a never.
  if (decision.decision === "ask" && !approved) return outcomeOf({ callId, packageId: HOUSE_TOOL_ID, status: "rejected", via: "tool_call", args, durationMs: 0, reason: "blocked_by_confirmation", userMessage: `Please confirm ${input.action.replaceAll("_", " ")} for ${control.length} ${control.length === 1 ? "device" : "devices"}.`, ...({ confirmNeeded: true } as object) } as Parameters<typeof outcomeOf>[0]);
  const performed: Array<{ entity: HouseEntity; result: Extract<HouseActionResult, { ok: true }> }> = [];
  const failedKinds: string[] = [];
  for (const { entity } of control) {
    const result = await (deps.perform ?? (async (target, act) => {
      const connection = houseLanFetch();
      return connection.ok ? performHouseAction({ lanFetch: connection.lanFetch, token: connection.token, entity: target, action: act }) : { ok: false as const, kind: "unreachable" as const };
    }))(entity, action);
    if (result.ok) performed.push({ entity, result }); else failedKinds.push(entity.kind);
  }
  const now = (deps.now ?? (() => new Date()))();
  (deps.audit ?? recordToolAudit)({ personId, tool: HOUSE_TOOL_ID, action: input.action, decision: performed.length ? "do" : "never", band, count: control.length });
  // An Undo skips the confirm step, so it never opens or unlocks a sensitive item: only a safer inverse (lock, close) is kept.
  const inverseCalls = performed.flatMap(({ entity, result }) => result.undo && (!entity.sensitive || result.undo.name === "lock" || result.undo.name === "close") ? [houseServiceCall(entity, result.undo)] : []);
  const undoReceipt = inverseCalls.length ? (deps.undo ?? recordUndo)({ personId, turnId: callId, tool: HOUSE_TOOL_ID, action: input.action, inverse: { kind: "house_restore", calls: inverseCalls } }, now) : undefined;
  const goodKinds = [...new Set(performed.map(({ entity }) => entity.kind))];
  const noun = goodKinds.length === 1 ? `${performed.length} ${goodKinds[0]}${performed.length === 1 ? "" : "s"}` : `${performed.length} devices`;
  const place = new Set(performed.map(({ entity }) => areaName(entity, registry.areas))).size === 1 ? areaName(performed[0]!.entity, registry.areas) : "the selected areas";
  const sentence = performed.length ? `${input.action === "turn_on" ? "Turned on" : input.action === "turn_off" ? "Turned off" : input.action.replaceAll("_", " ")} ${noun} in ${place}.` : failureCopy["unreachable"]!;
  const fullText = failedKinds.length ? `${sentence} Some ${[...new Set(failedKinds)].join(" and ")} devices could not be changed.` : sentence;
  let blocks: Record<string, unknown>[] = [];
  if (undoReceipt) {
    const undo = undoPropsFor(undoReceipt.id) ?? { label: "Undo", action: "undo" };
    const confirmation = blockEnvelope("confirmation", HOUSE_TOOL_ID, sentence, `house result in turn ${callId}`, { icon: "home", sentence, undo });
    confirmation.id = undoReceipt.id;
    blocks = [confirmation];
  }
  return outcomeOf({ callId, packageId: HOUSE_TOOL_ID, status: "succeeded", via: "tool_call", args, durationMs: 0, result: { reply: { text: fullText }, data: blocks.length ? { blocks } : {}, actions: [] } });
}

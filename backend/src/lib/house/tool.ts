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
import { db } from "@/db";
import { settingsValues } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { nextHlc } from "@/lib/hlc";
import { houseLanFetch } from "./connection";
import { loadHouseRegistry } from "./cache";
import type { HouseArea, HouseEntity, HouseKind } from "./registry";
import { canRestartServer, houseAccess, visibleEntities, type EffectivePermission, type HouseActor, type HouseBand } from "./access";
import { houseServiceCall, performHouseAction, performHouseServerAction, supportedActions, type HouseActionInput, type HouseActionName, type HouseActionResult, type HouseAddon, type HouseServerAction } from "./act";
import { clearHouseRegistry } from "./cache";
import { HOUSE_TOOL_ID } from "./ids";
export { HOUSE_TOOL_ID } from "./ids";

const kinds = ["light", "switch", "scene", "cover", "lock", "fan", "climate"] as const;
/** Audit rows take the action name only from this closed list; anything else the model typed is just "invalid". */
export function safeHouseAction(value: unknown): string { return typeof value === "string" && (HOUSE_ACTIONS as readonly string[]).includes(value) ? value : "invalid"; }
export const HOUSE_ACTIONS = ["find", "turn_on", "turn_off", "set_brightness", "set_color", "set_speed", "open", "close", "lock", "unlock", "activate", "set_temperature", "restart_core", "restart_addon", "reboot_host"] as const;
/** Small models often send `target` (one object, or a JSON string of it) or put area, name and kind at the top level instead of a
 * `targets` list, or say "lights" for kind. This reshapes the MODEL'S OWN ARGUMENTS into the one shape; it never reads the person's words. */
export function normalizeHouseArgs(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const input = { ...(raw as Record<string, unknown>) };
  const asObject = (value: unknown): Record<string, unknown> | null => {
    if (typeof value === "string") {
      try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null; } catch { return value.trim() ? { name: value.trim() } : null; }
    }
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  };
  let targets: unknown = input.targets;
  if (typeof targets === "string") { try { targets = JSON.parse(targets); } catch { targets = asObject(targets) ? [asObject(targets)] : undefined; } }
  if (targets && !Array.isArray(targets)) targets = [targets];
  if (targets === undefined && input.target !== undefined) {
    const t = Array.isArray(input.target) ? input.target : [asObject(input.target)];
    targets = t.filter(Boolean);
  }
  if (targets === undefined && (typeof input.area === "string" || typeof input.name === "string" || typeof input.kind === "string")) {
    targets = [{ ...(typeof input.area === "string" ? { area: input.area } : {}), ...(typeof input.name === "string" ? { name: input.name } : {}), ...(typeof input.kind === "string" ? { kind: input.kind } : {}) }];
  }
  const cleaned = (Array.isArray(targets) ? targets : []).map((entry) => {
    const o = asObject(entry);
    if (!o) return entry;
    const out: Record<string, unknown> = {};
    if (typeof o.area === "string" && o.area.trim()) out.area = o.area.trim();
    if (typeof o.name === "string" && o.name.trim()) out.name = o.name.trim();
    if (typeof o.kind === "string") { const k = o.kind.trim().toLowerCase(); out.kind = (kinds as readonly string[]).includes(k.replace(/s$/, "")) ? k.replace(/s$/, "") : k; }
    return out;
  });
  const result: Record<string, unknown> = { action: input.action };
  if (Array.isArray(targets)) result.targets = cleaned;
  if (input.value !== undefined) result.value = input.value;
  if (input.rgb !== undefined) result.rgb = input.rgb;
  if (input.addon !== undefined) result.addon = input.addon;
  return result;
}

const argsShape = z.object({
  action: z.enum(HOUSE_ACTIONS),
  targets: z.array(z.object({ area: z.string().min(1).optional(), name: z.string().min(1).optional(), kind: z.enum(kinds).optional() }).strict()).max(25).optional(),
  value: z.number().finite().optional(),
  rgb: z.tuple([z.number().int().min(0).max(255), z.number().int().min(0).max(255), z.number().int().min(0).max(255)]).optional(),
  addon: z.string().min(1).max(128).optional(),
}).strict();
const argsSchema = z.preprocess(normalizeHouseArgs, argsShape);
type HouseArgs = z.infer<typeof argsShape>;
export type HouseToolDeps = {
  loadRegistry?: () => Promise<{ ok: true; areas: HouseArea[]; entities: HouseEntity[] } | { ok: false; kind: "unreachable" | "refused" | "timeout" }>;
  permissionsOf?: (personId: string) => EffectivePermission[];
  perform?: (entity: HouseEntity, action: HouseActionInput) => Promise<HouseActionResult>;
  brakeMode?: () => BrakeMode;
  neverMode?: () => boolean;
  audit?: (input: { personId: string; tool: string; action: string; decision: string; band: string; count: number }) => void;
  undo?: (input: { personId: string; turnId?: string; tool: string; action: string; inverse: UndoInverse }, now?: Date) => { id: string; expiresAt: string };
  now?: () => Date;
  addons?: () => Promise<HouseAddon[]>;
  serverAction?: (action: HouseServerAction, addon?: string) => Promise<{ ok: boolean; disconnected?: boolean }>;
};

const defaultLoadRegistry = loadHouseRegistry;
const serverCooldowns = new Map<HouseServerAction, number>();
const SERVER_COOLDOWN_MS = 60_000;
const SERVER_COOLDOWN_SCOPE = "system";
function storedCooldown(action: HouseServerAction): number {
  const value = db.select({ value: settingsValues.value }).from(settingsValues).where(and(eq(settingsValues.scope, SERVER_COOLDOWN_SCOPE), eq(settingsValues.key, `house.server.last:${action}`))).get()?.value;
  try { const parsed: unknown = JSON.parse(value ?? "null"); return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : 0; } catch { return 0; }
}
function setStoredCooldown(action: HouseServerAction, at: number): void {
  const key = `house.server.last:${action}`;
  const values = { value: JSON.stringify(at), hlc: nextHlc(), source: "hub" as const, updatedAt: new Date(at).toISOString() };
  const existing = db.select({ key: settingsValues.key }).from(settingsValues).where(and(eq(settingsValues.scope, SERVER_COOLDOWN_SCOPE), eq(settingsValues.key, key))).get();
  if (existing) db.update(settingsValues).set(values).where(and(eq(settingsValues.scope, SERVER_COOLDOWN_SCOPE), eq(settingsValues.key, key))).run();
  else db.insert(settingsValues).values({ scope: SERVER_COOLDOWN_SCOPE, key, ...values }).run();
}
async function availableAddons(deps: HouseToolDeps): Promise<HouseAddon[]> {
  if (deps.addons) return deps.addons();
  const connection = houseLanFetch();
  if (!connection.ok) return [];
  const response = await connection.lanFetch("/api/hassio/addons", { headers: { Authorization: `Bearer ${connection.token}` } });
  if (!response.ok || response.status < 200 || response.status >= 300 || response.truncated) return [];
  try {
    const parsed = JSON.parse(response.text) as { data?: { addons?: Array<{ slug?: unknown; name?: unknown }> } };
    return (parsed.data?.addons ?? []).flatMap((item) => typeof item.slug === "string" && typeof item.name === "string" && /^[a-z0-9_]+$/.test(item.slug) ? [{ id: item.slug, name: item.name }] : []);
  } catch { return []; }
}

export function houseToolSpec(ctx: { visible: HouseEntity[]; areas: HouseArea[]; actor?: HouseActor; addons?: HouseAddon[] }): ToolSpec {
  const areaIds = new Set(ctx.visible.flatMap((entity) => entity.area ? [entity.area] : []));
  const areaNames = [...new Set(ctx.areas.filter((area) => areaIds.has(area.id)).map((area) => area.name))].sort((a, b) => a.localeCompare(b)).slice(0, 40);
  const owner = canRestartServer(ctx.actor);
  const actions = owner ? HOUSE_ACTIONS : HOUSE_ACTIONS.filter((action) => !action.startsWith("restart_") && action !== "reboot_host");
  return {
    id: HOUSE_TOOL_ID,
    description: "Find visible home devices and scenes or control devices you are allowed to use. Always pass targets, a list of {area, name, kind}, for example {\"action\":\"turn_on\",\"targets\":[{\"area\":\"Kitchen\",\"name\":\"Ceiling\"}]}. Use action find with an area to see what is there.",
    args: { type: "object", required: ["action", "targets"], properties: {
      action: { type: "string", enum: actions },
      targets: { type: "array", maxItems: 25, items: { type: "object", properties: { area: { type: "string", ...(areaNames.length ? { enum: areaNames } : {}) }, name: { type: "string" }, kind: { type: "string", enum: kinds } }, additionalProperties: false } },
      value: { type: "number" }, rgb: { type: "array", minItems: 3, maxItems: 3, items: { type: "integer", minimum: 0, maximum: 255 } },
      ...(owner ? { addon: { type: "string", enum: (ctx.addons ?? []).map((addon) => addon.id) } } : {}),
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

export type HouseCallPlan =
  | { kind: "refuse"; reason: string; text: string; count: number; rejected?: boolean }
  | { kind: "ask"; reason: string; action: string; count: number; kinds: string[]; labels: string[] }
  | { kind: "run"; input: HouseArgs; actor: HouseActor; permissions: EffectivePermission[]; registry: { ok: true; areas: HouseArea[]; entities: HouseEntity[] }; matches: HouseEntity[]; action: HouseActionInput; mode: BrakeMode; count: number };

function canonicalActor(actor: PersonRow | HouseActor, bandIn: HouseBand): HouseActor {
  const roleBand: HouseBand = "role" in actor && (actor.role === "child" || actor.role === "teen") ? actor.role : "adult";
  const band: HouseBand = bandIn === "child" || roleBand === "child" ? "child" : bandIn === "teen" || roleBand === "teen" ? "teen" : "adult";
  return { id: actor.id, role: "role" in actor ? String(actor.role) as HouseActor["role"] : "unknown", band };
}

/** Pure call-time access and brake decision shared by policy and execution. */
export function planHouseCall({ actor, band, args, tainted = false, approved = false, registry, permissions, mode }: { actor: PersonRow | HouseActor; band: HouseBand; args: Record<string, unknown>; tainted?: boolean; approved?: boolean; registry: { ok: true; areas: HouseArea[]; entities: HouseEntity[] }; permissions: EffectivePermission[]; mode: BrakeMode }): HouseCallPlan {
  const parsed = argsSchema.safeParse(args);
  if (!parsed.success) return { kind: "refuse", reason: "invalid", text: "That home request was invalid. Name an area or device and try again.", count: 0 };
  const houseActor = canonicalActor(actor, band);
  if (!houseActor.id || houseActor.role === "unknown" || houseActor.role === "guest") return { kind: "refuse", reason: "unknown_speaker", text: "Home controls are not available for this speaker.", count: 0, rejected: true };
  if (mode === "never") return { kind: "refuse", reason: "mode_never", text: "Home controls are turned off for this household.", count: 0, rejected: true };
  const visible = visibleHouseEntities({ actor: houseActor, permissions, entities: registry.entities });
  const input = parsed.data;
  if (input.action.startsWith("restart_") || input.action === "reboot_host") {
    if (!canRestartServer(houseActor)) return { kind: "refuse", reason: "server_owner_only", text: "That home action is unavailable for this speaker.", count: 0 };
    const action = input.action as HouseServerAction;
    return approved ? { kind: "run", input, actor: houseActor, permissions, registry, matches: [], action: { name: "turn_on" }, mode, count: 0 } : { kind: "ask", reason: "confirmation_required", action, count: 1, kinds: [action], labels: [action === "restart_core" ? "Home Assistant" : action === "reboot_host" ? "Home Assistant host" : `Home Assistant add-on ${input.addon}`] };
  }
  if (input.action === "find") return { kind: "run", input, actor: houseActor, permissions, registry, matches: [], action: { name: "find" as HouseActionName }, mode, count: 0 };
  const resolved = resolveTargets(input.targets ?? [], visible, registry.areas);
  if (resolved.ambiguous) return { kind: "refuse", reason: "ambiguous", text: `That name matches more than one device: ${resolved.ambiguous.join(", ")}. Please be more specific.`, count: resolved.ambiguous.length };
  if (resolved.missing || resolved.matches.length === 0) return { kind: "refuse", reason: "missing", text: "I could not find a visible device matching that area or name.", count: 0 };
  const action: HouseActionInput = { name: input.action as HouseActionName, ...(input.value !== undefined ? { value: input.value } : {}), ...(input.rgb ? { rgb: input.rgb } : {}) };
  if (resolved.matches.length > 12) return { kind: "refuse", reason: "bulk", text: "That would control too many devices at once. Choose a smaller area or name specific devices.", count: resolved.matches.length };
  if (resolved.matches.some((entity) => !supportedActions(entity).includes(action.name))) return { kind: "refuse", reason: "unsupported", text: "That action is not available for the selected device. Choose a supported action and try again.", count: resolved.matches.length };
  const control = resolved.matches.map((entity) => ({ entity, access: houseAccess({ actor: houseActor, permissions, entity, level: "control" }) }));
  if (control.some((item) => !item.access.allowed)) return { kind: "refuse", reason: "access", text: "You are not set up to control that.", count: control.length };
  const confirm = control.some(({ entity }) => !!entity.sensitive && houseAccess({ actor: houseActor, permissions, entity, level: "confirm" }).confirm);
  const byId = new Map(registry.entities.map((entity) => [entity.id, entity]));
  const sceneNeedsAsk = control.some(({ entity }) => entity.kind === "scene" && (entity.sceneMembers === null || entity.sceneMembers.some((id) => !byId.get(id) || !!byId.get(id)!.sensitive)));
  const mustAsk = sceneNeedsAsk || confirm || control.some(({ entity }) => !!entity.sensitive && houseAccess({ actor: houseActor, permissions, entity, level: "confirm" }).reason === "no_grant");
  // approved = the speaker answered yes to exactly this parked call; it lifts the ask, never a never and never a minor's need for a parent.
  const brake = approved ? { decision: "do" as const, reason: undefined } : brakeFor({ tool: "house", action: input.action, confirm: mustAsk, targets: control.length, tainted, mode, actor: { id: houseActor.id!, role: houseActor.role, band: houseActor.band }, args });
  if (brake.decision === "never") return { kind: "refuse", reason: brake.reason ?? "never", text: "Home controls are turned off for this household.", count: control.length };
  const kinds = [...new Set(control.map(({ entity }) => entity.kind))];
  if (brake.decision === "ask") return { kind: "ask", reason: brake.reason ?? "confirmation_required", action: input.action, count: control.length, kinds, labels: control.map(({ entity }) => houseLabel(entity, registry.areas)) };
  return { kind: "run", input, actor: houseActor, permissions: [...permissions], registry, matches: control.map(({ entity }) => entity), action, mode, count: control.length };
}

/** Only an exact "do" or "never" is believed; anything else (unset, empty, a typo) is ask. */
function brakeModeOf(value: unknown): BrakeMode { return value === "do" || value === "never" ? value : "ask"; }

/** How a device is named to the person who must approve it: "Wall light in Theater". Shown only in their own confirm card. */
export function houseLabel(entity: HouseEntity, areas: HouseArea[]): string {
  const name = entity.name.trim();
  const hasKind = name.toLocaleLowerCase().includes(entity.kind);
  const place = entity.area ? areaName(entity, areas) : "";
  return `${hasKind ? name : `${name} ${entity.kind}`}${place ? ` in ${place}` : ""}`;
}

function normalize(value: string): string { return value.trim().replace(/\s+/g, " ").toLocaleLowerCase(); }
function areaName(entity: HouseEntity, areas: HouseArea[]): string { return areas.find((area) => area.id === entity.area)?.name ?? "the home"; }
function fail(callId: string, raw: Record<string, unknown>, line: string, status: "failed" | "rejected" = "failed", confirmNeeded = false, failureKind: "unavailable" | "bad_arguments" | "found_nothing" = "unavailable"): ToolExecutionOutcome {
  return outcomeOf({ callId, packageId: HOUSE_TOOL_ID, status, via: "tool_call", args: raw, durationMs: 0, errorCode: "house_tool", failureKind, userMessage: line, ...(confirmNeeded ? { confirmNeeded: true } as object : {}) } as Parameters<typeof outcomeOf>[0]);
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
      let matches = filtered.filter((entity) => normalize(entity.name) === normalize(target.name!));
      // The model often says "Wall light" for a device named "Wall": if nothing matches exactly, accept the one device whose
      // area, name and kind words together contain every word the model gave. Arguments only, never the person's sentence.
      if (matches.length === 0) {
        const words = normalize(target.name).split(" ").filter((w) => w && !["the", "a", "an"].includes(w));
        const hay = (entity: HouseEntity): string[] => [...normalize(`${areaName(entity, areas)} ${entity.name} ${entity.kind}`).split(" "), entity.kind + "s", "lamp", "lights"].filter((w) => w !== "lamp" || entity.kind === "light" || entity.kind === "switch");
        const loose = words.length ? filtered.filter((entity) => { const h = new Set(hay(entity)); return words.every((w) => h.has(w)); }) : [];
        if (loose.length === 1) matches = loose;
      }
      if (matches.length > 1) return { matches: [], ambiguous: matches.slice(0, 8).map((entity) => entity.name) };
      if (matches.length === 0) return { matches: [], missing: true };
      selected.push(matches[0]!);
    } else if (target.area) selected.push(...filtered);
    else return { matches: [], missing: true };
  }
  return { matches: [...new Map(selected.map((entity) => [entity.id, entity])).values()] };
}

export async function runHouseTool({ actor, band: bandIn, args, callId, tainted = false, approved = false, deps = {} }: { actor: PersonRow | HouseActor; band: HouseBand; args: Record<string, unknown>; callId: string; tainted?: boolean; approved?: boolean; deps?: HouseToolDeps }): Promise<ToolExecutionOutcome> {
  const personId = actor.id ?? "";
  const serverKind = typeof args.action === "string" && ["restart_core", "restart_addon", "reboot_host"].includes(args.action) ? args.action as HouseServerAction : null;
  const callActor = canonicalActor(actor, bandIn);
  if (serverKind && !canRestartServer(callActor)) return fail(callId, args, "That server action is not available.", "failed", false, "found_nothing");
  const registry = await (deps.loadRegistry ?? defaultLoadRegistry)();
  if (!registry.ok) return fail(callId, {}, failureCopy[registry.kind] ?? failureCopy.unreachable!);
  if (serverKind === "restart_addon" && !(await availableAddons(deps)).some((addon) => addon.id === args.addon)) return fail(callId, args, "Choose a Home Assistant add-on from the available list.", "failed", false, "bad_arguments");
  const permissions = (deps.permissionsOf ?? effectivePermissions)(personId);
  const mode = brakeModeOf((deps.brakeMode ?? (() => getHouseholdSettingValue("tools.house.mode")))());
  const plan = planHouseCall({ actor, band: bandIn, args, tainted, registry, permissions, mode });
  // A malformed call is a tool error, not an answer, so the reply cannot claim it worked.
  if (plan.kind === "refuse" && ["invalid", "missing", "ambiguous", "bulk", "unsupported"].includes(plan.reason)) return fail(callId, args, plan.text, "failed", false, plan.reason === "missing" ? "found_nothing" : "bad_arguments");
  if (plan.kind === "refuse") return plan.rejected ? outcomeOf({ callId, packageId: HOUSE_TOOL_ID, status: "rejected", via: "tool_call", args, durationMs: 0, reason: "unconfirmed", userMessage: plan.text } as Parameters<typeof outcomeOf>[0]) : reply(callId, args, plan.text);
  if (plan.kind === "ask" && !approved) {
    const copy = serverKind ? `This cannot be undone. Confirm ${serverKind === "restart_core" ? "restarting Home Assistant" : serverKind === "reboot_host" ? "rebooting the Home Assistant host" : `restarting the Home Assistant add-on ${String(args.addon)}`}?` : `Please confirm ${plan.action.replaceAll("_", " ")} for ${plan.count} ${plan.count === 1 ? "device" : "devices"}.`;
    return outcomeOf({ callId, packageId: HOUSE_TOOL_ID, status: "rejected", via: "tool_call", args, durationMs: 0, reason: "blocked_by_confirmation", userMessage: copy, ...({ confirmNeeded: true } as object) } as Parameters<typeof outcomeOf>[0]);
  }
  if (approved && callId.startsWith("resumed:")) {
    const currentMode = brakeModeOf((deps.brakeMode ?? (() => getHouseholdSettingValue("tools.house.mode")))());
    if (currentMode === "never") return outcomeOf({ callId, packageId: HOUSE_TOOL_ID, status: "rejected", via: "tool_call", args, durationMs: 0, reason: "unconfirmed", userMessage: "Home controls are turned off for this household." } as Parameters<typeof outcomeOf>[0]);
    const parsed = argsSchema.safeParse(args);
    if (!parsed.success) return reply(callId, args, "That home request was invalid. Name an area or device and try again.");
    const retryPlan = planHouseCall({ actor, band: bandIn, args, tainted: false, approved: true, registry, permissions, mode });
    if (retryPlan.kind === "refuse") return reply(callId, args, retryPlan.text);
    if (retryPlan.kind === "run" && (retryPlan.actor.band === "child" || retryPlan.actor.band === "teen")) {
      const requiresAdult = retryPlan.matches.some((entity) => !!entity.sensitive || entity.kind === "scene" && (entity.sceneMembers === null || entity.sceneMembers.some((id) => registry.entities.find((item) => item.id === id)?.sensitive)));
      if (requiresAdult) return outcomeOf({ callId, packageId: HOUSE_TOOL_ID, status: "rejected", via: "tool_call", args, durationMs: 0, reason: "unconfirmed", userMessage: "A parent needs to approve that home action." } as Parameters<typeof outcomeOf>[0]);
    }
    if (retryPlan.kind === "ask") return reply(callId, args, "That home action could not be confirmed.");
    if (retryPlan.kind === "run") return executeHousePlan({ plan: { ...retryPlan, mode: "do" }, actor, personId, args, callId, band: bandIn, deps });
  }
  if (mode === "never") return outcomeOf({ callId, packageId: HOUSE_TOOL_ID, status: "rejected", via: "tool_call", args, durationMs: 0, reason: "unconfirmed", userMessage: "Home controls are turned off for this household." } as Parameters<typeof outcomeOf>[0]);
  if (plan.kind !== "run") return fail(callId, {}, "That home request was invalid.");
  return executeHousePlan({ plan, actor, personId, args, callId, band: bandIn, deps });
}

async function executeHousePlan({ plan, actor, personId, args, callId, band, deps }: { plan: Extract<HouseCallPlan, { kind: "run" }>; actor: PersonRow | HouseActor; personId: string; args: Record<string, unknown>; callId: string; band: HouseBand; deps: HouseToolDeps }): Promise<ToolExecutionOutcome> {
  const { actor: houseActor, input, registry } = plan;
  if (input.action === "restart_core" || input.action === "restart_addon" || input.action === "reboot_host") {
    const action = input.action as HouseServerAction;
    if (!canRestartServer(houseActor)) return fail(callId, args, "That server action is not available.", "failed", false, "found_nothing");
    const nowMs = (deps.now ?? (() => new Date()))().getTime();
    const last = Math.max(serverCooldowns.get(action) ?? 0, storedCooldown(action));
    if (last && nowMs - last < SERVER_COOLDOWN_MS) return fail(callId, args, "Home Assistant server controls are cooling down. Try again in a minute.", "failed", false, "unavailable");
    const result = deps.serverAction ? await deps.serverAction(action, input.addon) : await (() => {
      const connection = houseLanFetch();
      return connection.ok ? performHouseServerAction({ lanFetch: connection.lanFetch, token: connection.token, action, addon: input.addon }) : Promise.resolve({ ok: false as const, kind: "unreachable" as const });
    })();
    const ok = result.ok || ("disconnected" in result && result.disconnected === true);
    if (ok) { serverCooldowns.set(action, nowMs); setStoredCooldown(action, nowMs); clearHouseRegistry(); }
    (deps.audit ?? recordToolAudit)({ personId, tool: HOUSE_TOOL_ID, action, decision: ok ? "do" : "never", band, count: 1 });
    return ok ? reply(callId, args, "Restart sent; Home Assistant will be back in a minute") : fail(callId, args, failureCopy.unreachable!, "failed", false, "unavailable");
  }
  const mode = plan.mode;
  const permissions = plan.permissions;
  const visible = visibleHouseEntities({ actor: houseActor, permissions, entities: registry.entities });
  if (input.action === "find") {
    const filtered = visible.filter((entity) => (input.targets ?? []).every((target) => (!target.area || normalize(areaName(entity, registry.areas)) === normalize(target.area)) && (!target.kind || target.kind === entity.kind))).slice(0, 26);
    const shown = filtered.slice(0, 25);
    const list = shown.map((entity) => `${entity.name} (${areaName(entity, registry.areas)}, ${entity.kind}, ${entity.state})`).join("; ");
    return reply(callId, args, shown.length ? `Found ${shown.length} visible home ${shown.length === 1 ? "device" : "devices"}${filtered.length > 25 ? "; there are more" : ""}: ${list}.` : "I did not find any visible device there.");
  }
  const matches = plan.matches;
  const action = plan.action;
  const control = matches.map((entity) => ({ entity }));
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
    const confirmation = blockEnvelope("confirmation", HOUSE_TOOL_ID, sentence, `house result in turn ${callId}`, { icon: performed.some(({ entity }) => entity.kind === "lock") ? "lock" : "lightbulb", sentence, undo });
    confirmation.id = undoReceipt.id;
    blocks = [confirmation];
  }
  return outcomeOf({ callId, packageId: HOUSE_TOOL_ID, status: "succeeded", via: "tool_call", args, durationMs: 0, result: { reply: { text: fullText }, data: blocks.length ? { blocks } : {}, actions: [] } });
}

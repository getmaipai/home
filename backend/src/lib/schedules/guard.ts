// SCHED-02: the one access rule for a scheduled device action, shared by creation, the hub executor and the reconciler.
// An automation runs without Home's brakes, so a task may only name lights, switches, fans and scenes, only targets the
// creator could `house.control`, never anything on the sensitive list, and a scene only while every item it sets passes too.
import { DEFAULT_INSTANCE } from "@/lib/connectors/instances";
import { houseAccess, type EffectivePermission, type HouseActor } from "@/lib/house/access";
import { loadHouseRegistry } from "@/lib/house/cache";
import type { HouseEntity, HouseRegistryResult } from "@/lib/house/registry";
import { visibleHouseEntities } from "@/lib/house/tool";

export type SchedulePerson = { id: string; role: string };

/** Owner, admin and adult only: a teen, a child, a guest or an unknown speaker never schedules a device. */
export function scheduleActor(person: SchedulePerson | null | undefined): HouseActor | null {
  if (!person || !person.id) return null;
  if (person.role === "owner" || person.role === "admin" || person.role === "adult") return { id: person.id, role: person.role, band: "adult" };
  return null;
}

/** `<instance>/<native id>`; no prefix means the default instance. Returns the stored form too. */
export function parseTarget(target: string): { instance: string; native: string; key: string } | null {
  const slash = target.indexOf("/");
  const instance = slash > 0 ? target.slice(0, slash) : DEFAULT_INSTANCE;
  const native = slash > 0 ? target.slice(slash + 1) : target;
  if (!native || native.includes("/") || !/^[a-z_]+\.[a-z0-9_]+$/.test(native)) return null;
  return { instance, native, key: `${instance}/${native}` };
}

const SCHEDULABLE_DOMAINS = new Set(["light", "switch", "fan", "scene"]);
export function schedulableDomain(native: string): boolean { return SCHEDULABLE_DOMAINS.has(native.slice(0, native.indexOf("."))); }

const keyOf = (entity: Pick<HouseEntity, "id" | "instance">): string => `${entity.instance ?? DEFAULT_INSTANCE}/${entity.id}`;

/** `unknown` reasons (not_found, scene_unknown) mean the registry could not answer for this target right now; they are never a denial. */
export type TargetReason = "bad_target" | "sensitive" | "not_found" | "no_access" | "scene_changed" | "scene_unknown";
export type TargetCheck = { ok: true; entities: HouseEntity[] } | { ok: false; reason: TargetReason };

/** A reason that is only "could not tell", after a partial read or a Home Assistant restart: skip, never pause. */
export function isUnknownReason(reason: TargetReason): boolean { return reason === "not_found" || reason === "scene_unknown"; }

/** Reuses the house tool's scene member rule, then holds it to the stricter scheduling rule. A member that is missing or a member list that is null is unknown (a partial read);
 * only a member that is present and now sensitive or not controllable is a change. */
function sceneState(scene: HouseEntity, registry: readonly HouseEntity[], actor: HouseActor, permissions: readonly EffectivePermission[]): "ok" | "unknown" | "changed" {
  if (scene.sceneMembers === null) return "unknown";
  const byId = new Map(registry.map((entity) => [keyOf(entity), entity]));
  const members = scene.sceneMembers.map((id) => byId.get(`${scene.instance ?? DEFAULT_INSTANCE}/${id}`));
  const present = members.filter((member): member is HouseEntity => member !== undefined);
  if (present.some((member) => member.sensitive || !houseAccess({ actor, permissions, entity: member, level: "control" }).allowed)) return "changed";
  if (present.length < members.length) return "unknown";
  return visibleHouseEntities({ actor, permissions, entities: registry }).some((entity) => keyOf(entity) === keyOf(scene)) ? "ok" : "changed";
}

export function checkTargets(input: { actor: HouseActor; permissions: readonly EffectivePermission[]; entities: readonly HouseEntity[]; targets: readonly string[] }): TargetCheck {
  const found: HouseEntity[] = [];
  const byId = new Map(input.entities.map((entity) => [keyOf(entity), entity]));
  for (const target of input.targets) {
    const parsed = parseTarget(target);
    if (!parsed || !schedulableDomain(parsed.native)) return { ok: false, reason: parsed ? "sensitive" : "bad_target" };
    const entity = byId.get(parsed.key);
    if (!entity) return { ok: false, reason: "not_found" };
    if (entity.sensitive) return { ok: false, reason: "sensitive" };
    if (!houseAccess({ actor: input.actor, permissions: input.permissions, entity, level: "control" }).allowed) return { ok: false, reason: "no_access" };
    if (entity.kind === "scene") {
      const state = sceneState(entity, input.entities, input.actor, input.permissions);
      if (state !== "ok") return { ok: false, reason: state === "unknown" ? "scene_unknown" : "scene_changed" };
    }
    found.push(entity);
  }
  return { ok: true, entities: found };
}

/** The registry for the instances a task names, each loaded on its own with the instance stamped on its entities and areas (the cache's single-instance read carries none).
 * Any instance that does not answer makes the whole result `ok: false`: a partial registry must never read as a revoked grant. */
export async function loadScheduleRegistry(instances: readonly string[]): Promise<HouseRegistryResult> {
  const parts: Array<Extract<HouseRegistryResult, { ok: true }>> = [];
  for (const instance of new Set(instances)) {
    const loaded = await loadHouseRegistry(instance);
    if (!loaded.ok) return loaded;
    parts.push({ ok: true, areas: loaded.areas.map((area) => ({ ...area, instance })), entities: loaded.entities.map((entity) => ({ ...entity, instance })) });
  }
  return { ok: true, areas: parts.flatMap((part) => part.areas), entities: parts.flatMap((part) => part.entities) };
}

export function instancesOf(targets: readonly string[]): string[] {
  return [...new Set(targets.flatMap((target) => { const parsed = parseTarget(target); return parsed ? [parsed.instance] : []; }))];
}

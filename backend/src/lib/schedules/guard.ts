// SCHED-02: the one access rule for a scheduled device action, shared by creation, the hub executor and the reconciler.
// An automation runs without Home's brakes, so a task may only name lights, switches, fans and scenes, only targets the
// creator could `house.control`, never anything on the sensitive list, and a scene only while every item it sets passes too.
import { DEFAULT_INSTANCE } from "@/lib/connectors/instances";
import { houseAccess, type EffectivePermission, type HouseActor } from "@/lib/house/access";
import type { HouseEntity } from "@/lib/house/registry";
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

export type TargetReason = "bad_target" | "sensitive" | "not_found" | "no_access" | "scene_changed";
export type TargetCheck = { ok: true; entities: HouseEntity[] } | { ok: false; reason: TargetReason };

/** True when a scene sets only known items the actor may control, none of them sensitive. Reuses the house tool's scene member rule, then holds it to the stricter scheduling rule. */
function sceneStillSchedulable(scene: HouseEntity, registry: readonly HouseEntity[], actor: HouseActor, permissions: readonly EffectivePermission[]): boolean {
  if (scene.sceneMembers === null) return false;
  if (!visibleHouseEntities({ actor, permissions, entities: registry }).some((entity) => keyOf(entity) === keyOf(scene))) return false;
  const byId = new Map(registry.map((entity) => [keyOf(entity), entity]));
  return scene.sceneMembers.every((id) => {
    const member = byId.get(`${scene.instance ?? DEFAULT_INSTANCE}/${id}`);
    return !!member && !member.sensitive && houseAccess({ actor, permissions, entity: member, level: "control" }).allowed;
  });
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
    if (entity.kind === "scene" && !sceneStillSchedulable(entity, input.entities, input.actor, input.permissions)) return { ok: false, reason: "scene_changed" };
    found.push(entity);
  }
  return { ok: true, entities: found };
}

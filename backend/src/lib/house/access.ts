import type { Role } from "@/middleware/auth";
import { approverFor } from "@/lib/gate/decide";
import { normalizeGrantTarget } from "@/lib/grants";
import type { HouseEntity, SensitiveClass } from "./registry";

export type HouseBand = "child" | "teen" | "adult";
export type HouseLevel = "see" | "control" | "confirm";
export interface EffectivePermission { action: string; effect: "allow" | "deny" }
export type HouseActor = { role: Role | "unknown"; band: HouseBand; id?: string | null };
export type HouseAccessResult = { allowed: boolean; confirm: boolean; reason: "owner" | "granted" | "no_grant" | "denied" | "never_for_band" | "unknown_speaker" };

const denied = (reason: HouseAccessResult["reason"]): HouseAccessResult => ({ allowed: false, confirm: false, reason });

export function approverCell(actionId: string, band: HouseBand, parameter?: string) {
  return approverFor(actionId, band, parameter);
}

function actionIds(level: HouseLevel, entity: HouseEntity, band: HouseBand): string[] {
  const instance = entity.instance ?? "default";
  const ids = [`house.${level}:${instance}/entity:${entity.id}`];
  // A room grant never reaches a lock, alarm, garage, entry door or camera for a teen or child: those need a grant on the item itself.
  if (entity.sensitive && band !== "adult") return ids;
  if (entity.area) ids.push(`house.${level}:${instance}/area:${entity.area}`);
  return ids;
}

export function houseAccess({ actor, permissions, entity, level }: {
  actor: HouseActor;
  permissions: readonly EffectivePermission[];
  entity: HouseEntity;
  level: HouseLevel;
}): HouseAccessResult {
  if (actor.role === "guest" || actor.role === "unknown" || !actor.id) return denied("unknown_speaker");

  const actionId = `house.${level}:<target>`;
  const cell = approverCell(actionId, actor.band, entity.sensitive ?? undefined);
  if (cell === "never") return denied("never_for_band");

  if (actor.role === "owner") return { allowed: true, confirm: cell === "self" || cell === "parent", reason: "owner" };

  // One form for every target (C2): a prefixed deny beats an unprefixed allow and the reverse.
  const actions = new Set(actionIds(level, entity, actor.band));
  const hits = (effect: EffectivePermission["effect"]): boolean => permissions.some((permission) => permission.effect === effect && actions.has(normalizeGrantTarget(permission.action)));
  if (hits("deny")) return denied("denied");
  if (hits("allow")) {
    return { allowed: true, confirm: cell === "self" || cell === "parent", reason: "granted" };
  }
  return denied("no_grant");
}

export function canRestartServer(actor: Pick<HouseActor, "role"> | null | undefined): boolean {
  return actor?.role === "owner";
}

export function visibleEntities({ actor, permissions, entities, level }: {
  actor: HouseActor;
  permissions: readonly EffectivePermission[];
  entities: readonly HouseEntity[];
  level: HouseLevel;
}): HouseEntity[] {
  return entities.filter((entity) => houseAccess({ actor, permissions, entity, level }).allowed);
}

export type HouseSensitiveClass = SensitiveClass;

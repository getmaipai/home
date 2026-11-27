// This is a code-level floor under the per-person matrix; an admin may lift a default for a named device, and a lift is always listed so it can be logged; nothing here removes a rule an admin could not override.
export interface FloorCall { service: string; entityIds: string[]; deviceClasses?: Record<string, string>; adminExposed?: string[] }
export interface FloorConfig { adminLifted?: string[]; maxTargets?: number }
export type FloorCode = "denied-domain" | "lock-needs-confirm" | "cover-needs-confirm" | "too-many-targets" | "script-scene-not-exposed";
export interface FloorReason { entityId: string | null; code: FloorCode; lifted?: true }
export interface FloorVerdict { decision: "allow" | "confirm" | "deny"; reasons: FloorReason[] }

const deniedDomains = new Set(["alarm_control_panel", "siren", "valve", "camera", "shell_command", "mqtt", "update", "hassio"]);
const denyCodes = new Set<FloorCode>(["denied-domain", "script-scene-not-exposed"]);
const confirmCodes = new Set<FloorCode>(["lock-needs-confirm", "cover-needs-confirm"]);

export function houseFloor(call: FloorCall, config: FloorConfig): FloorVerdict {
  const liftedIds = new Set(config.adminLifted ?? []);
  const exposedIds = new Set(call.adminExposed ?? []);
  const reasons: FloorReason[] = [];
  let hasDeny = false;
  let hasConfirm = false;

  for (const entityId of call.entityIds) {
    const separator = entityId.indexOf(".");
    const domain = separator < 0 ? null : entityId.slice(0, separator);
    let code: FloorCode | undefined;

    if (domain === null || deniedDomains.has(domain)) code = "denied-domain";
    else if (domain === "lock") code = "lock-needs-confirm";
    else if (domain === "cover" && (call.deviceClasses?.[entityId] === "garage" || call.deviceClasses?.[entityId] === "gate")) code = "cover-needs-confirm";
    else if ((domain === "script" || domain === "scene") && !exposedIds.has(entityId)) code = "script-scene-not-exposed";

    if (!code) continue;
    const isLiftable = denyCodes.has(code) || confirmCodes.has(code);
    const lifted = isLiftable && liftedIds.has(entityId);
    reasons.push(lifted ? { entityId, code, lifted: true } : { entityId, code });
    if (!lifted) {
      if (denyCodes.has(code)) hasDeny = true;
      else if (confirmCodes.has(code)) hasConfirm = true;
    }
  }

  if (call.entityIds.length > (config.maxTargets ?? 5)) {
    reasons.push({ entityId: null, code: "too-many-targets" });
    hasDeny = true;
  }

  return { decision: hasDeny ? "deny" : hasConfirm ? "confirm" : "allow", reasons };
}

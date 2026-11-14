import { setBounded } from "@/lib/boundedMap";

export type SuppressionScope = "self" | "device" | "room" | "household";
export type SuppressionKind =
  | "glass_breaking" | "dog_bark" | "baby_cry" | "doorbell" | "music_or_tv" | "shouting"
  | "smoke" | "co" | "gas" | "water_leak" | "temperature" | "intrusion" | "weather_alert";
export type DismissReason = "media" | "handled" | "false_alarm" | "party" | "other";

const MINUTE = 60_000;
const MAX_ENTRIES = 200;
const kinds: Record<SuppressionKind, { tier: "notable" | "emergency" | "sensor" }> = {
  glass_breaking: { tier: "emergency" }, dog_bark: { tier: "notable" }, baby_cry: { tier: "notable" },
  doorbell: { tier: "notable" }, music_or_tv: { tier: "notable" }, shouting: { tier: "notable" },
  smoke: { tier: "sensor" }, co: { tier: "sensor" }, gas: { tier: "sensor" }, water_leak: { tier: "sensor" },
  temperature: { tier: "sensor" }, intrusion: { tier: "sensor" }, weather_alert: { tier: "notable" },
};

type Hold = {
  kind: SuppressionKind; scope: SuppressionScope; deviceId: string | null; room: string | null;
  personId: string | null; until: number; count: number; startedAt: number; ceilingUntil: number; reAlerted: boolean;
};
const holds = new Map<string, Hold>();
const dailyCounts = new Map<string, number>();

function key(h: Pick<Hold, "kind" | "scope" | "deviceId" | "room" | "personId">): string {
  return JSON.stringify([h.kind, h.scope, h.scope === "device" ? h.deviceId : null, h.scope === "room" ? h.room : null, h.scope === "self" ? h.personId : null]);
}
function live(now: number): Hold[] {
  for (const [k, h] of holds) if (h.until <= now) holds.delete(k);
  return [...holds.values()];
}
function dailyKey(now: number): string { return new Date(now).toISOString().slice(0, 10); }
function countDismissal(now: number): void {
  const day = dailyKey(now);
  dailyCounts.set(day, (dailyCounts.get(day) ?? 0) + 1);
  for (const key of dailyCounts.keys()) if (key !== day) dailyCounts.delete(key);
}
function duration(kind: SuppressionKind, reason: DismissReason, count: number): { ms: number; ceiling: number } {
  const tier = kinds[kind].tier;
  if (tier === "sensor") return { ms: 15 * MINUTE, ceiling: 60 * MINUTE };
  if (reason === "party") return { ms: 4 * 60 * MINUTE, ceiling: 8 * 60 * MINUTE };
  if (reason === "media") return { ms: Math.min(3 * 60 * MINUTE * (2 ** (count - 1)), 8 * 60 * MINUTE), ceiling: 8 * 60 * MINUTE };
  const base = tier === "emergency" ? 30 * MINUTE : 60 * MINUTE;
  const ceiling = tier === "emergency" ? 4 * 60 * MINUTE : 8 * 60 * MINUTE;
  return { ms: Math.min(base * (2 ** (count - 1)), ceiling), ceiling };
}

export type DismissInput = {
  kind: SuppressionKind; scope: SuppressionScope; deviceId?: string | null; room?: string | null;
  personId?: string | null; reason: DismissReason; now: number;
  byBand: "child" | "teen" | "adult" | "unknown"; byConfirmedAdult: boolean;
  untilOverrideMs?: number;
};
export function dismiss(input: DismissInput): { ok: boolean; until: number | null; extendedTo?: number; refusal?: "adult_required" | "person_required" } {
  if (input.scope === "self" && !input.personId) return { ok: false, until: null, refusal: "person_required" };
  if (input.scope !== "self" && !input.byConfirmedAdult) return { ok: false, until: null, refusal: "adult_required" };
  live(input.now);
  const target = { kind: input.kind, scope: input.scope, deviceId: input.deviceId ?? null, room: input.room ?? null,
    personId: input.scope === "self" ? input.personId ?? null : null };
  const id = key(target);
  const previous = holds.get(id);
  const repeated = previous && previous.until > input.now;
  const count = repeated ? previous.count + 1 : 1;
  const span = duration(input.kind, input.reason, count);
  const startedAt = repeated ? previous.startedAt : input.now;
  const ceilingUntil = input.kind === "weather_alert" && input.untilOverrideMs !== undefined
    ? input.now + 24 * 60 * MINUTE : startedAt + span.ceiling;
  const requestedUntil = input.untilOverrideMs !== undefined && input.kind === "weather_alert"
    ? input.now + Math.min(Math.max(0, input.untilOverrideMs), 24 * 60 * MINUTE) : input.now + span.ms;
  const until = Math.min(requestedUntil, ceilingUntil);
  const value: Hold = { ...target, count, startedAt, until, ceilingUntil, reAlerted: false };
  setBounded(holds, id, value, MAX_ENTRIES);
  countDismissal(input.now);
  return { ok: true, until, ...(repeated ? { extendedTo: until } : {}) };
}

export function isSuppressed(input: { kind: SuppressionKind; deviceId?: string | null; room?: string | null; personId?: string | null; now: number }): boolean {
  return live(input.now).some((h) => {
    if (h.kind !== input.kind) return false;
    if (h.scope === "self") return !!input.personId && h.personId === input.personId;
    if (h.scope === "device") return !!input.deviceId && h.deviceId === input.deviceId;
    if (h.scope === "room") return !!input.room && h.room === input.room;
    return h.scope === "household";
  });
}

export function shouldReAlert(input: { kind: SuppressionKind; deviceId?: string | null; room?: string | null; personId?: string | null;
  escalation: { dbLouder?: number; longerSeconds?: number; secondSource?: boolean }; now: number }): boolean {
  const candidates = live(input.now).filter((h) => h.kind === input.kind && (h.scope === "household" ||
    (h.scope === "device" && h.deviceId === (input.deviceId ?? null)) || (h.scope === "room" && h.room === (input.room ?? null)) ||
    (h.scope === "self" && h.personId === (input.personId ?? null))));
  const h = candidates.find((hold) => !hold.reAlerted);
  if (!h) return false;
  const e = input.escalation;
  if (!((e.dbLouder ?? 0) >= 6 || (e.longerSeconds ?? 0) >= 60 || e.secondSource === true)) return false;
  h.reAlerted = true;
  return true;
}

export function resume(input: { kind?: SuppressionKind; deviceId?: string | null; room?: string | null; personId?: string | null; byConfirmedAdult: boolean; byPersonId?: string | null }): number {
  let cleared = 0;
  for (const [id, h] of holds) {
    if (input.kind && h.kind !== input.kind) continue;
    const constrainedAdult = input.deviceId || input.room;
    const allowed = (!!input.byPersonId && input.byPersonId === h.personId) || (input.byConfirmedAdult && (!constrainedAdult ||
      ((h.scope === "device" && !!input.deviceId && h.deviceId === input.deviceId) || (h.scope === "room" && !!input.room && h.room === input.room))));
    if (!allowed) continue;
    if (input.deviceId && h.scope === "device" && h.deviceId !== input.deviceId) continue;
    if (input.room && h.scope === "room" && h.room !== input.room) continue;
    if (input.personId && h.scope === "self" && h.personId !== input.personId) continue;
    holds.delete(id); cleared++;
  }
  return cleared;
}

export function listActive(now: number): Array<{ kind: SuppressionKind; scope: SuppressionScope; deviceId: string | null; until: number }> {
  return live(now).map(({ kind, scope, deviceId, until }) => ({ kind, scope, deviceId, until }));
}
export function clearAll(): void { holds.clear(); dailyCounts.clear(); }
export function __resetForTests(): void { clearAll(); }
export function auditCount(): number { return dailyCounts.values().next().value ?? 0; }

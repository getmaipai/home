// SETTINGS-AUDIT-01: the household record of owner and admin changes to safety-relevant settings.
// Rule 6a: the record carries the actor's role, never a person id or name; a person-scope change names no person.
// This file records; it decides nothing. It is called after a write succeeded, never before.
import { desc } from "drizzle-orm";
import { SettingsChange } from "@maipai/spec/gen/ts/settings-change.js";
import { db } from "@/db";
import { settingsChanges } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { randomSuffix } from "@/lib/id";
import { getRegistryKey } from "@/lib/settingsRegistry";
import { directionFor, isSafetyRelevantKey } from "@/settings/safetyRelevantKeys";

export function newSettingsChangeId(): string {
  return `schg-${randomSuffix(8)}`;
}

export function recordSettingsChange(input: {
  key: string;
  scope: "household" | "person";
  actorRole: string;
  value: unknown;
  previous: unknown;
}): void {
  try {
    if (input.actorRole !== "owner" && input.actorRole !== "admin") return;
    const def = getRegistryKey(input.key);
    if (def?.secret || !isSafetyRelevantKey(input.key, def)) return;
    const record = SettingsChange.parse({
      id: newSettingsChangeId(),
      key: input.key,
      scope: input.scope,
      actor_role: input.actorRole,
      value: input.value === undefined ? null : input.value,
      ...(input.previous === undefined || input.previous === null ? {} : { previous: input.previous }),
      direction: directionFor(input.key, input.previous ?? null, input.value),
      changed_at: new Date().toISOString(),
      hlc: nextHlc(),
    });
    db.insert(settingsChanges).values({
      id: record.id,
      key: record.key,
      scope: record.scope,
      actorRole: record.actor_role,
      value: JSON.stringify(record.value ?? null),
      previous: record.previous === undefined ? null : JSON.stringify(record.previous),
      direction: record.direction,
      changedAt: record.changed_at,
      hlc: record.hlc,
    }).run();
  } catch {
    console.error("[settings-audit] write failed");
  }
}

export function listSettingsChanges(limit = 100): SettingsChange[] {
  const rows = db.select().from(settingsChanges).orderBy(desc(settingsChanges.changedAt), desc(settingsChanges.hlc)).limit(limit).all();
  return rows.map((row) => SettingsChange.parse({
    id: row.id,
    key: row.key,
    scope: row.scope,
    actor_role: row.actorRole,
    value: JSON.parse(row.value),
    ...(row.previous === null ? {} : { previous: JSON.parse(row.previous) }),
    direction: row.direction,
    changed_at: row.changedAt,
    hlc: row.hlc,
  }));
}

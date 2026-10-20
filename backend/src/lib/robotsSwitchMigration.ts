// ROBOTS-SWITCH-01: preserve access for homes that already paired a robot.
// The internal settings row is a durable one-time marker; an explicit user
// value (including false) always wins over the migration.
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { settingsValues } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { listDevicesByKind } from "@/lib/devices";
import { getHouseholdSettingSource, setHouseholdSettingValue } from "@/lib/settings";

const MARKER_KEY = "__migration.robots_switch_01";

export function migrateRobotsSwitch(): "already_ran" | "enabled" | "left_off" {
  const marker = db.select({ key: settingsValues.key }).from(settingsValues)
    .where(and(eq(settingsValues.scope, "system"), eq(settingsValues.key, MARKER_KEY))).get();
  if (marker) return "already_ran";

  let outcome: "enabled" | "left_off" = "left_off";
  if (getHouseholdSettingSource("home.robots.enabled") === undefined && listDevicesByKind("robot").length > 0) {
    const written = setHouseholdSettingValue("home.robots.enabled", true);
    if (!written.ok) return "left_off";
    outcome = "enabled";
  }

  const now = new Date().toISOString();
  db.insert(settingsValues).values({
    scope: "system", key: MARKER_KEY, value: "true", hlc: nextHlc(), source: "migration", setBy: null, updatedAt: now,
  }).run();
  return outcome;
}

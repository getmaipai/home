// LOOK-01: ui.look's enum drops "studio" and "calm" (owner ruling -
// the default is a named shadcn theme, not a Home name that hides
// what it is). db/migrations/0057_look_studio_calm_to_neutral.sql
// deletes any stored ui.look row still holding one of the retired
// values, so it falls back to the key's own new default, "neutral" -
// lib/settings.ts's own listValues()/getPersonSettingValue() decode
// whatever's stored with no re-validation against the current
// registry (settings.test.ts's own "GET /api/settings/registry"
// suite exercises that decode path; this only proves the migration's
// own SQL actually clears the rows an old client could have left
// behind), so a stale row would otherwise read back as the retired
// value forever, not the new default. Runs the migration file's own
// SQL text directly against a real row (not the full migrate()
// bootstrap, which only ever runs once per process, at module load,
// long before a test could seed a "pre-migration" row) - a real
// regression test for this file's own content, the same one drizzle's
// migrator will run for real the first time a data directory built
// before this item boots against this code.
import { describe, expect, test, beforeEach } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { settingsValues } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { getSettingValueForPerson } from "@/lib/settings";
import { resetDb } from "./reset-db";

beforeEach(() => {
  resetDb();
});

const MIGRATION_SQL = readFileSync(join(import.meta.dir, "../src/db/migrations/0057_look_studio_calm_to_neutral.sql"), "utf-8");

// ui.look is person-scoped (uiKeys.ts): a bare person id, not a real
// row, is enough here - nothing in this file touches auth.
const PERSON_ID = "person-legacy-look";

function seedLook(scope: string, value: string): void {
  db.insert(settingsValues)
    .values({ scope, key: "ui.look", value: JSON.stringify(value), hlc: nextHlc(), source: "user", updatedAt: new Date().toISOString() })
    .run();
}

describe("0057_look_studio_calm_to_neutral", () => {
  test.each(["studio", "calm"] as const)("a stored %s row is deleted, falling back to the new default", (legacyValue) => {
    seedLook(`person:${PERSON_ID}`, legacyValue);
    const seeded = db.select().from(settingsValues).where(and(eq(settingsValues.scope, `person:${PERSON_ID}`), eq(settingsValues.key, "ui.look"))).get();
    expect(seeded?.value).toBe(JSON.stringify(legacyValue));

    db.run(MIGRATION_SQL);

    const row = db.select().from(settingsValues).where(and(eq(settingsValues.scope, `person:${PERSON_ID}`), eq(settingsValues.key, "ui.look"))).get();
    expect(row).toBeUndefined();
    // The real migration runs at db bootstrap, before any settings read
    // ever primes the in-memory cache with the stale value - reading
    // the resolved value before the migration above (the way a real
    // live process never would) would have done exactly that, so this
    // only reads it after, the sequencing that's actually real.
    expect(getSettingValueForPerson(PERSON_ID, "ui.look")).toBe("neutral");
  });

  test("a stored value that isn't studio or calm survives the migration untouched", () => {
    seedLook(`person:${PERSON_ID}`, "studio");
    seedLook("person:someone-else", "zinc");

    db.run(MIGRATION_SQL);

    const survivor = db.select().from(settingsValues).where(and(eq(settingsValues.scope, "person:someone-else"), eq(settingsValues.key, "ui.look"))).get();
    expect(survivor?.value).toBe(JSON.stringify("zinc"));
  });
});

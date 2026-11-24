import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { settingsValues } from "@/db/schema";
import { migrateTierKeysToFeatureIds } from "@/lib/tierKeyMigration";
import { resetDb } from "../../tests/reset-db";

const put = (scope: string, key: string, value: unknown) => db.insert(settingsValues).values({ scope, key, value: JSON.stringify(value), hlc: "1:0:test", source: "user", setBy: null, updatedAt: "2026-11-24T00:00:00Z" }).run();
const read = (scope: string, key: string) => db.select().from(settingsValues).where(eq(settingsValues.key, key)).all().find((row) => row.scope === scope);
const slot = { model: "klein", options: { steps: 20 }, who: "admins" };

describe("migrateTierKeysToFeatureIds", () => {
  beforeEach(() => resetDb());

  test("picture and voice slot rows move to the Stack feature ids, whatever their scope, and nothing else moves", () => {
    put("household", "engines.image.tier.boost", slot);
    put("household", "engines.tts.tier.max", { model: "off", options: {}, who: "admins" });
    put("household", "engines.image.choice", "auto");
    put("user:p1", "engines.tts.choice", "off");
    put("household", "engines.video.tier.boost", slot);
    expect(migrateTierKeysToFeatureIds()).toBe("migrated");
    expect(read("household", "engines.pictures.tier.boost")?.value).toBe(JSON.stringify(slot));
    expect(read("household", "engines.voice.tier.max")).toBeDefined();
    expect(read("household", "engines.pictures.choice")?.value).toBe(JSON.stringify("auto"));
    expect(read("user:p1", "engines.voice.choice")?.value).toBe(JSON.stringify("off"));
    expect(read("household", "engines.video.tier.boost")).toBeDefined();
    expect(db.select().from(settingsValues).all().filter((row) => /^engines\.(image|tts)\./.test(row.key))).toEqual([]);
  });

  test("a value already stored under the new key wins and the old row is dropped", () => {
    put("household", "engines.image.tier.standard", slot);
    put("household", "engines.pictures.tier.standard", { model: "recommended", options: {}, who: "everyone" });
    migrateTierKeysToFeatureIds();
    expect(JSON.parse(read("household", "engines.pictures.tier.standard")!.value).model).toBe("recommended");
    expect(read("household", "engines.image.tier.standard")).toBeUndefined();
  });

  test("the saved Boost and Max access lists say pictures instead of image, other entries untouched", () => {
    put("user:p2", "access.tier.boost", ["chat", "image", "voice"]);
    put("household", "access.tier.max", { add: ["image"], remove: [] });
    migrateTierKeysToFeatureIds();
    expect(JSON.parse(read("user:p2", "access.tier.boost")!.value)).toEqual(["chat", "pictures", "voice"]);
    expect(JSON.parse(read("household", "access.tier.max")!.value)).toEqual({ add: ["pictures"], remove: [] });
  });

  test("it runs once", () => {
    expect(migrateTierKeysToFeatureIds()).toBe("migrated");
    put("household", "engines.image.choice", "auto");
    expect(migrateTierKeysToFeatureIds()).toBe("already_ran");
  });
});

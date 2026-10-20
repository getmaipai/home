import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { people, settingsValues } from "@/db/schema";
import { eq } from "drizzle-orm";
import { issueDeviceToken } from "@/lib/deviceTokens";
import { migrateRobotsSwitch } from "@/lib/robotsSwitchMigration";
import { getHouseholdSettingValue, setHouseholdSettingValue } from "@/lib/settings";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";

beforeEach(resetDb);

describe("ROBOTS-SWITCH-01 boot migration", () => {
  test("enables robots for a paired home, preserves an explicit false, and runs once", async () => {
    const createOwner = async () => {
      const owner = new TestClient();
      await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
      return db.select({ id: people.id }).from(people).where(eq(people.displayName, "Sage")).get()!.id;
    };
    await (async () => {
      const ownerId = await createOwner();
      issueDeviceToken(ownerId, "robot", "Riff");
      expect(migrateRobotsSwitch()).toBe("enabled");
      expect(getHouseholdSettingValue("home.robots.enabled")).toBe(true);
      expect(migrateRobotsSwitch()).toBe("already_ran");

      resetDb();
      const secondOwnerId = await createOwner();
      expect(setHouseholdSettingValue("home.robots.enabled", false).ok).toBe(true);
      issueDeviceToken(secondOwnerId, "robot", "Riff");
      expect(migrateRobotsSwitch()).toBe("left_off");
      expect(getHouseholdSettingValue("home.robots.enabled")).toBe(false);

      resetDb();
      const thirdOwnerId = await createOwner();
      expect(migrateRobotsSwitch()).toBe("left_off");
      issueDeviceToken(thirdOwnerId, "robot", "Riff");
      expect(migrateRobotsSwitch()).toBe("already_ran");
      expect(getHouseholdSettingValue("home.robots.enabled")).toBe(false);
      expect(db.select().from(settingsValues).all().filter((row) => row.key === "__migration.robots_switch_01")).toHaveLength(1);
    })();
  });
});

// ROUTER-BUILD-01a: the chat.search_assist key is registered once, defaults to
// shadow, offers off/shadow/rescue, and only an owner or admin can change it.
import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { getHouseholdSettingValue, listValues, setValue } from "@/lib/settings";
import { getRegistry } from "@/lib/settingsRegistry";
import { db } from "@/db";
import { people } from "@/db/schema";

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
});

const KEY = "chat.search_assist";

async function household() {
  const owner = new TestClient();
  await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const ids: Record<string, string> = {};
  for (const [name, role, secret] of [
    ["Marlow", "admin", "correcthorse2"],
    ["Rover", "adult", "correcthorse3"],
    ["Wren", "teen", undefined],
    ["Bramble", "child", undefined],
  ] as const) {
    const res = await owner.post("/api/people", { displayName: name, role, ...(secret ? { secret } : {}) });
    if (res.status !== 201) throw new Error(`${role}: ${res.status} ${await res.text()}`);
    ids[role] = ((await res.json()) as { id: string }).id;
  }
  const row = (id: string) => db.select().from(people).where(eq(people.id, id)).get()!;
  const ownerRow = db.select().from(people).where(eq(people.role, "owner")).get()!;
  return { ownerRow, row, ids };
}

describe("chat.search_assist", () => {
  test("is registered exactly once with the declared options and default", () => {
    const hits = getRegistry().filter((k) => k.key === KEY);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ scope: "household", selector: "select", default: "shadow", level: "advanced", lives_in: "household.ai_advanced" });
    expect(hits[0]!.range).toEqual({ options: ["off", "shadow", "rescue"] });
    expect(hits[0]!.help).toContain("not active yet");
  });

  test("getHouseholdSettingValue returns shadow by default", () => {
    expect(getHouseholdSettingValue(KEY)).toBe("shadow");
  });

  test("only an owner or admin can change it; adult, teen and child are refused", async () => {
    const { ownerRow, row, ids } = await household();
    const read = listValues(ownerRow, "household");
    expect(read.ok && read.value.find((v) => v.key === KEY)?.value).toBe("shadow");
    for (const role of ["adult", "teen", "child"] as const) {
      const r = setValue(row(ids[role]!), "household", KEY, "off");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(403);
    }
    expect(setValue(row(ids.admin!), "household", KEY, "off").ok).toBe(true);
    expect(getHouseholdSettingValue(KEY)).toBe("off");
    expect(setValue(ownerRow, "household", KEY, "bogus").ok).toBe(false);
  });
});

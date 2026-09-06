import { describe, expect, test, beforeEach } from "bun:test";
import { dailyMinutesAllowed } from "@/lib/allowance";
import { setValue } from "@/lib/settings";
import { sqlite } from "@/db";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import type { PersonRow } from "@/types";

beforeEach(() => resetDb());

function toPersonRow(id: string): PersonRow {
  return sqlite.query("SELECT * FROM people WHERE id = ?").get(id) as unknown as PersonRow;
}

describe("dailyMinutesAllowed()", () => {
  test("defaults to 0 (no limit configured) for a category nobody has set", async () => {
    const owner = new TestClient();
    const res = await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const { person } = (await res.json()) as { person: { id: string } };
    expect(dailyMinutesAllowed(person.id, "Fun")).toBe(0);
  });

  test("returns the household's configured limit for that person and category", async () => {
    const owner = new TestClient();
    const res = await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const { person } = (await res.json()) as { person: { id: string } };
    const id = person.id;
    const childRes = await owner.post("/api/people", { displayName: "Bramble", role: "child" });
    const child = (await childRes.json()) as { id: string };

    setValue(toPersonRow(id), `person:${child.id}`, "allowance.fun.daily_minutes", 30);
    expect(dailyMinutesAllowed(child.id, "Fun")).toBe(30);
    // Setting one category's limit does not touch another's.
    expect(dailyMinutesAllowed(child.id, "Media")).toBe(0);
  });
});

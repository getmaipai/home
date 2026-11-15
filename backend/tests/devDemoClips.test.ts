import { afterEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { seedDemoClips } from "../scripts/devDemoClips";
import { feedRows } from "@/lib/videos/feed";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import type { PersonRow } from "@/types";

afterEach(() => resetDb());

describe("dev demo video fixtures", () => {
  test("seeds playable, unlocked clip rows for Sage and Marlow only", async () => {
    resetDb();
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const sage = db.select().from(people).where(eq(people.displayName, "Sage")).get()! as PersonRow;
    const add = async (displayName: string, role: string) => {
      const response = await owner.post("/api/people", { displayName, role, secret: "0000" });
      const body = await response.json() as { id: string };
      return db.select().from(people).where(eq(people.id, body.id)).get()! as PersonRow;
    };
    const marlow = await add("Marlow", "teen");
    const nova = await add("Nova", "child");
    await seedDemoClips(sage.id, marlow.id);
    await seedDemoClips(sage.id, marlow.id);

    expect(feedRows(sage, { limit: 30 })).toHaveLength(4);
    expect(feedRows(marlow, { limit: 30 })).toHaveLength(1);
    expect(feedRows(nova, { limit: 30 })).toHaveLength(0);
    const response = await owner.post("/api/plugins/video/data/recipes", { scope: "feed" });
    expect(response.status).toBe(200);
    const served = await response.json() as Array<{ src: string; still: string }>;
    expect(served).toHaveLength(4);
    for (const row of served) for (const url of [row.src, row.still]) {
      const file = await owner.get(url);
      expect(file.status).toBe(200);
      expect((await file.arrayBuffer()).byteLength).toBeGreaterThan(100);
    }
  });
});

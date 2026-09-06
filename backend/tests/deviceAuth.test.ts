import { describe, expect, test, beforeEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { issueDeviceToken } from "@/lib/deviceTokens";
import { db } from "@/db";
import { people } from "@/db/schema";
import { eq } from "drizzle-orm";

beforeEach(() => resetDb());

describe("POST /api/auth/devices/redeem", () => {
  test("a valid device token sets a session cookie for whichever address answers", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const person = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
    const { token } = issueDeviceToken(person.id, "tv", "Living room TV");

    const client = new TestClient();
    const res = await client.post("/api/auth/devices/redeem", { token });
    expect(res.status).toBe(200);

    const me = await client.get("/api/auth/me");
    expect(me.status).toBe(200);
  });

  test("401 for an unknown token, and no session cookie is set", async () => {
    const client = new TestClient();
    const res = await client.post("/api/auth/devices/redeem", { token: "not-a-real-token" });
    expect(res.status).toBe(401);

    const me = await client.get("/api/auth/me");
    expect(me.status).toBe(401);
  });
});

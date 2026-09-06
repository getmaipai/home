import { describe, expect, test, beforeEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { issueDeviceToken } from "@/lib/deviceTokens";
import { db } from "@/db";
import { people } from "@/db/schema";
import { eq } from "drizzle-orm";

beforeEach(() => resetDb());

async function owner(): Promise<{ client: TestClient; personId: string }> {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const person = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  return { client, personId: person.id };
}

describe("GET /api/devices", () => {
  test("requires auth", async () => {
    const anon = new TestClient();
    const res = await anon.get("/api/devices");
    expect(res.status).toBe(401);
  });

  test("lists only devices paired to me", async () => {
    const { client, personId } = await owner();
    issueDeviceToken(personId, "tv", "Living room TV");

    const res = await client.get("/api/devices");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ name: string; kind: string }>;
    expect(body).toHaveLength(1);
    expect(body[0]!.name).toBe("Living room TV");
    expect(body[0]!.kind).toBe("tv");
  });
});

describe("DELETE /api/devices/:id", () => {
  test("revokes a device I own", async () => {
    const { client, personId } = await owner();
    const { deviceId } = issueDeviceToken(personId, "phone", "My phone");

    const res = await client.request(`/api/devices/${deviceId}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await client.get("/api/devices").then((r) => r.json())).toEqual([]);
  });

  test("404 for a device that isn't mine", async () => {
    const { client } = await owner();
    const res = await client.request("/api/devices/device-doesnotexist", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});

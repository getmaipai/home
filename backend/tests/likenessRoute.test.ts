import { beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { db } from "@/db";
import { people } from "@/db/schema";

beforeEach(resetDb);

describe("GET /api/likeness/adults", () => {
  test("requires sign-in and returns only living adults eligible as subjects", async () => {
    const anonymous = new TestClient();
    expect((await anonymous.get("/api/likeness/adults")).status).toBe(401);

    const owner = new TestClient();
    const setup = await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const { person } = await setup.json() as { person: { id: string } };
    expect((await owner.post("/api/people", { displayName: "Nova", role: "child" })).status).toBe(201);
    db.insert(people).values({ id: "person-marlow", displayName: "Marlow", role: "adult", avatarSeed: "Marlow", source: "test", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), hlc: "1:0:test00" }).run();

    const response = await owner.get("/api/likeness/adults");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ adults: [
      { id: expect.any(String), name: "Marlow", self: false },
      { id: person.id, name: "Sage", self: true },
    ] });
  });
});

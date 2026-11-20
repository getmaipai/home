import { beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";

describe("POST /api/films/:id/animatic", () => {
  let client: TestClient;
  beforeEach(async () => { resetDb(); client = new TestClient(); await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" }); });
  test("an unknown film is 404 and nobody is 401", async () => {
    expect((await client.post("/api/films/none/animatic", {})).status).toBe(404);
    expect((await new TestClient().post("/api/films/none/animatic", {})).status).toBe(401);
  });
});

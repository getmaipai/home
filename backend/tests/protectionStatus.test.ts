import { beforeEach, expect, test } from "bun:test";
import { app } from "@/app";
import { db } from "@/db";
import { people } from "@/db/schema";
import { newPersonId } from "@/lib/id";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

beforeEach(() => resetDb());

test("protection details are limited to owner/admin and contain aggregate counts only", async () => {
  const signedOut = new TestClient();
  expect((await signedOut.get("/api/status/protection")).status).toBe(401);

  const owner = new TestClient();
  expect((await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
  const memberCreated = await owner.post("/api/people", { displayName: "Member", role: "adult", secret: "member-pass" });
  expect(memberCreated.status).toBe(201);
  const memberRow = await memberCreated.json() as { id: string };
  const member = new TestClient();
  expect((await member.post("/api/auth/verify-secret", { personId: memberRow.id, secret: "member-pass" })).status).toBe(200);
  expect((await member.get("/api/status/protection")).status).toBe(403);

  const id = newPersonId();
  const now = new Date().toISOString();
  db.insert(people).values({
    id,
    displayName: "Private profile label",
    role: "adult",
    avatarSeed: id,
    source: "hub",
    createdAt: now,
    updatedAt: now,
    hlc: `${Date.now()}:0:protection-test`,
  }).run();

  const response = await owner.get("/api/status/protection");
  expect(response.status).toBe(200);
  const body = await response.json() as Record<string, unknown>;
  expect(body).toHaveProperty("diskEncryption");
  expect(body).toHaveProperty("swapEncryption");
  expect(body).toHaveProperty("https");
  expect(body).toHaveProperty("dataDirectoryOwnerOnly");
  expect(body).toHaveProperty("keyFileInsideData");
  expect(body).toHaveProperty("minimumPasscodeLength", 4);
  expect(body).toHaveProperty("profilesWithoutPasscode", 1);
  expect(JSON.stringify(body)).not.toContain("Private profile label");
  expect(JSON.stringify(body)).not.toContain(id);
});

import { beforeEach, describe, expect, test } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { getHouseholdSettingValue, setHouseholdSettingValue } from "@/lib/settings";
import { derivePairingLookup, issuePairingCode, revokeLinkKey } from "@/lib/stack/linkKeys";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { getLinkKeyPaths } from "@/lib/stack/linkKeys";
import { existsSync } from "node:fs";
import { __resetStackLinkControlForTests, setStackLinkControl } from "@/lib/remoteStackSettings";

beforeEach(() => { resetDb(); revokeLinkKey(); __resetRateLimiterForTests(); __resetStackLinkControlForTests(); });
async function owner(): Promise<TestClient> { const client = new TestClient(); await client.post("/api/auth/setup", { displayName: "Owner", secret: "correcthorse" }); return client; }
const householdHeaders = { "x-real-ip": "192.168.1.40" };

describe("engine link routes", () => {
  test("admin routes require a session and deny a child", async () => {
    expect((await new TestClient().get("/api/engine-link/credentials")).status).toBe(401);
    const admin = await owner(); const created = await admin.post("/api/people", { displayName: "Kid", role: "child" }); const { id } = await created.json() as { id: string };
    const child = new TestClient(); await child.post("/api/auth/select", { personId: id });
    expect((await child.get("/api/engine-link/credentials")).status).toBe(403);
  });
  test("issues pair code for owner and exposes only the derived public GET path", async () => {
    const client = await owner(); setHouseholdSettingValue("engines.stack.where", "another_computer");
    const issued = await client.post("/api/engine-link/pair"); const { code } = await issued.json() as { code: string };
    const lookup = derivePairingLookup(code); expect(lookup).toMatch(/^[\da-f]{32}$/);
    const wrong = await client.get(`/api/engine-link/pair/${code}`); expect(wrong.status).toBe(400);
    const result = await client.get(`/api/engine-link/pair/${lookup}`, householdHeaders); expect(result.status).toBe(200);
    expect(JSON.stringify(await result.json())).not.toContain(code);
  });
  test("public GET refuses plain HTTP and non-household source", async () => {
    const client = await owner(); setHouseholdSettingValue("engines.stack.where", "another_computer");
    const { code } = await (await client.post("/api/engine-link/pair")).json() as { code: string };
    expect((await (await import("@/app")).app.request(`http://localhost/api/engine-link/pair/${derivePairingLookup(code)}`, { headers: householdHeaders })).status).toBe(400);
    expect((await client.get(`/api/engine-link/pair/${derivePairingLookup(code)}`, { "x-real-ip": "8.8.8.8" })).status).toBe(403);
  });
  test("public route rate limits by source and globally", async () => {
    const client = await owner(); setHouseholdSettingValue("engines.stack.where", "another_computer");
    const { code } = await (await client.post("/api/engine-link/pair")).json() as { code: string };
    const lookup = derivePairingLookup(code);
    for (let i = 0; i < 5; i++) expect((await client.get(`/api/engine-link/pair/${"f".repeat(32)}`, householdHeaders)).status).toBe(400);
    expect((await client.get(`/api/engine-link/pair/${lookup}`, householdHeaders)).status).toBe(429);
  });
  test("revoke clears credentials and restores local engine setting", async () => {
    const client = await owner(); setHouseholdSettingValue("engines.stack.where", "another_computer"); issuePairingCode();
    const paths = getLinkKeyPaths(); expect(existsSync(paths.askpassPath)).toBe(false);
    let started = false; setStackLinkControl({ async stopLocalStack() {}, async startLocalStackAndClearLink() { started = true; }, startLink() {}, stopLink() {}, refreshLink() {} });
    const response = await client.request("/api/engine-link/credentials", { method: "DELETE" });
    expect(response.status).toBe(200); expect(getHouseholdSettingValue("engines.stack.where")).toBe("this_computer");
    expect(started).toBe(false); expect(existsSync(paths.askpassPath)).toBe(false);
  });
});

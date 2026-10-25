import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { db } from "@/db";
import { people, sessions } from "@/db/schema";
import { conversationsRoutes } from "@/routes/conversations";
import { OpenAPIHono } from "@hono/zod-openapi";
import { loadManifestOnly } from "@/lib/plugins";
import { createHouseholdCompanion, setHouseholdCompanionAudience, setHouseholdCompanionStatus } from "@/lib/householdCompanions";
import { __reloadPersonasForTests } from "@/lib/persona";
import { setValue } from "@/lib/settings";
import { resetDb } from "../../tests/reset-db";

const app = new OpenAPIHono();
app.route("/api/conversations", conversationsRoutes);
const now = new Date().toISOString();
function addPerson(id: string, role: string) {
  db.insert(people).values({ id, displayName: id, role, avatarSeed: id, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
  const token = `token-${id}`;
  db.insert(sessions).values({ id: `session-${id}`, personId: id, tokenHash: createHash("sha256").update(token).digest("hex").toString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), createdAt: now }).run();
  return token;
}
async function request(path: string, token: string, method = "GET", body?: unknown) {
  return app.request(`http://localhost/api/conversations${path}`, { method, headers: { cookie: `session=${token}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function companion(displayName: string, audience: "all" | "teen" | "adult") {
  const loaded = loadManifestOnly("rivet");
  if (!loaded.ok || !loaded.value.companion) throw new Error("rivet fixture is unavailable");
    const created = createHouseholdCompanion({ ...loaded.value.companion, display_name: displayName, audience }, { display_name: "Author", person_id: "person-compoowner" });
  if (!created.ok) throw new Error(created.error);
  setHouseholdCompanionAudience(created.value.id, audience, { display_name: "Admin" });
  setHouseholdCompanionStatus(created.value.id, "ready");
  __reloadPersonasForTests();
  return created.value.id;
}
function allowCompanions() {
  const owner = db.select().from(people).all().find((person) => person.id === "person-compoowner")!;
  setValue(owner, `person:${owner.id}`, "companions.allowed", true);
}

beforeEach(() => { resetDb(); __reloadPersonasForTests(); });
afterEach(() => { resetDb(); __reloadPersonasForTests(); });

describe("conversation companion selection", () => {
  test("PATCH sets and clears the companion and validates the value", async () => {
    const token = addPerson("person-compoowner", "adult");
    allowCompanions();
    const create = await request("", token, "POST", { surface: "chat" });
    const conversation = await create.json() as { id: string; companion_id: string | null };
    const id = companion("Friendly", "all");
    const set = await request(`/${conversation.id}`, token, "PATCH", { companion_id: id });
    expect(set.status).toBe(200);
    expect((await set.json() as { companion_id: string }).companion_id).toBe(id);
    expect((await request(`/${conversation.id}`, token, "PATCH", { companion_id: 12 })).status).toBe(400);
    const clear = await request(`/${conversation.id}`, token, "PATCH", { companion_id: null });
    expect((await clear.json() as { companion_id: string | null }).companion_id).toBeNull();
  });

  test("PATCH refuses an age-ineligible or unknown companion", async () => {
    const token = addPerson("person-compoteen", "teen");
    addPerson("person-compoowner", "adult");
    allowCompanions();
    const conversation = await (await request("", token, "POST", { surface: "chat" })).json() as { id: string };
    const adultId = companion("Adults only", "adult");
    expect((await request(`/${conversation.id}`, token, "PATCH", { companion_id: adultId })).status).toBe(403);
    expect((await request(`/${conversation.id}`, token, "PATCH", { companion_id: "unknown-companion" })).status).toBe(403);
  });
});

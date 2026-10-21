import { beforeEach, describe, expect, test } from "bun:test";
import { OpenAPIHono } from "@hono/zod-openapi";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { db } from "@/db";
import { devices, people, sessions, settingsValues } from "@/db/schema";
import { companionsRoutes } from "@/routes/companions";
import { settingsRoutes } from "@/routes/settings";
import { createHouseholdCompanion } from "@/lib/householdCompanions";
import { loadManifestOnly } from "@/lib/plugins";
import { __reloadPersonasForTests } from "@/lib/persona";
import { resetDb } from "../../tests/reset-db";

const app = new OpenAPIHono();
app.route("/api/companions", companionsRoutes);
app.route("/api/settings", settingsRoutes);
const dataRoot = process.env.MAIPAI_DATA_DIR!;
const companionRoot = join(dataRoot, "companions");
const now = new Date().toISOString();

function addPerson(id: string, role: string) {
  db.insert(people).values({ id, displayName: id, role, avatarSeed: id, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
  const token = `session-${id}`;
  db.insert(sessions).values({ id: `sess-${id}`, personId: id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 60_000).toISOString(), createdAt: now }).run();
  return token;
}
function headers(token: string) { return { "content-type": "application/json", cookie: `session=${token}` }; }
async function request(path: string, token: string, method = "GET", body?: unknown) {
  return app.request(`http://localhost/api/${path}`, { method, headers: headers(token), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function fixture() {
  const loaded = loadManifestOnly("rivet"); if (!loaded.ok || !loaded.value.companion) throw new Error("rivet fixture is unavailable");
  return loaded.value.companion;
}

beforeEach(() => { resetDb(); rmSync(companionRoot, { recursive: true, force: true }); __reloadPersonasForTests(); });

describe("household companion routes", () => {
  test("children and teens cannot create; an adult creates a draft", async () => {
    const child = addPerson("person-child01", "child"), teen = addPerson("person-teen001", "teen"), adult = addPerson("person-adult01", "adult");
    for (const token of [child, teen]) {
      const refused = await request("companions", token, "POST", { ...fixture(), display_name: "New pal" });
      expect(refused.status).toBe(403); expect(((await refused.json()) as { error: string }).error).toBe("Only adults can make a companion.");
    }
    const response = await request("companions", adult, "POST", { ...fixture(), display_name: "New pal" });
    expect(response.status).toBe(201);
    const { id } = await response.json() as { id: string };
    const stored = await (await import("@/lib/householdCompanions")).getHouseholdCompanion(id);
    expect(stored?.companion).toMatchObject({ audience: "adult", status: "draft" });
  });

  test("bundled companion cannot be edited and can be copied", async () => {
    const adult = addPerson("person-adult02", "adult");
    const edit = await request("companions/rivet", adult, "PUT", { tagline: "Changed" });
    expect(edit.status).toBe(403); expect(((await edit.json()) as { error: string }).error).toBe("A bundled companion can't be changed. Make a copy to edit it.");
    const copied = await request("companions/rivet/copy", adult, "POST", {});
    expect(copied.status).toBe(201);
  });

  test("only an admin changes audience, all requires confirmation and records reviewer", async () => {
    const adult = addPerson("person-adult03", "adult"), admin = addPerson("person-admin003", "admin");
    const created = createHouseholdCompanion(fixture(), { display_name: "Author", person_id: "person-adult03" });
    if (!created.ok) throw new Error(created.error);
    const denied = await request(`companions/${created.value.id}/audience`, adult, "PUT", { audience: "teen" }); expect(denied.status).toBe(403);
    const unconfirmed = await request(`companions/${created.value.id}/audience`, admin, "PUT", { audience: "all" }); expect(unconfirmed.status).toBe(400);
    const confirmed = await request(`companions/${created.value.id}/audience`, admin, "PUT", { audience: "all", confirmed: true }); expect(confirmed.status).toBe(200);
    const stored = (await import("@/lib/householdCompanions")).getHouseholdCompanion(created.value.id);
    expect(stored?.companion?.review?.confirmed_by).toBe("person-admin003");
  });

  test("lowering audience refuses a child robot already using an all ages companion", async () => {
    const adult = addPerson("person-adult07", "adult"), admin = addPerson("person-admin007", "admin");
    const created = createHouseholdCompanion(fixture(), { display_name: "Author", person_id: "person-adult07" });
    if (!created.ok) throw new Error(created.error);
    const setAll = await request(`companions/${created.value.id}/audience`, admin, "PUT", { audience: "all", confirmed: true }); expect(setAll.status).toBe(200);
    const timestamp = new Date().toISOString();
    db.insert(devices).values({ id: "robot-child001", kind: "robot", name: "Kitchen", personId: "person-adult07", createdAt: timestamp, updatedAt: timestamp, hlc: "1:0:test" }).run();
    db.insert(settingsValues).values({ scope: "device:robot-child001", key: "robot.companion.id", value: JSON.stringify(created.value.id), hlc: "1:0:test", source: "user", updatedAt: timestamp }).run();
    const lowered = await request(`companions/${created.value.id}/audience`, admin, "PUT", { audience: "teen" });
    expect(lowered.status).toBe(409); expect(((await lowered.json()) as { error: string }).error).toBe("1 robots use this companion at a lower level. Change them first.");
  });

  test("ready companion can be selected through both endpoints; draft cannot", async () => {
    const adult = addPerson("person-adult04", "adult");
    const draft = createHouseholdCompanion({ ...fixture(), display_name: "Default candidate", examples: undefined }, { display_name: "person-adult04", person_id: "person-adult04" });
    if (!draft.ok) throw new Error(draft.error);
    const draftPick = await request(`companions/${draft.value.id}/default`, adult, "PUT"); expect(draftPick.status).toBe(404);
    const ready = createHouseholdCompanion({ ...fixture(), display_name: "Ready candidate" }, { display_name: "person-adult04", person_id: "person-adult04" });
    if (!ready.ok) throw new Error(ready.error);
    const makeReady = await request(`companions/${ready.value.id}/status`, adult, "PUT", { status: "ready" }); expect(makeReady.status).toBe(200);
    const listed = await request("companions", adult); expect((await listed.json() as { companions: Array<{ id: string; status: string }> }).companions.find((row) => row.id === ready.value.id)?.status).toBe("ready");
    const defaultPick = await request(`companions/${ready.value.id}/default`, adult, "PUT"); expect(defaultPick.status).toBe(200);
    const deleteUsed = await request(`companions/${ready.value.id}`, adult, "DELETE"); expect(deleteUsed.status).toBe(409);
    const settingsPick = await request("settings", adult, "PUT", { scope: "person:person-adult04", key: "persona.active_id", value: ready.value.id }); expect(settingsPick.status).toBe(200);
  });

  test("ready status asks for three example lines", async () => {
    const adult = addPerson("person-adult05", "adult");
    const created = createHouseholdCompanion({ ...fixture(), display_name: "Short samples", examples: undefined }, { display_name: "person-adult05", person_id: "person-adult05" });
    if (!created.ok) throw new Error(created.error);
    const response = await request(`companions/${created.value.id}/status`, adult, "PUT", { status: "ready" });
    expect(response.status).toBe(400); expect(((await response.json()) as { error: string }).error).toBe("Add at least 3 example lines before marking this companion ready.");
  });
});

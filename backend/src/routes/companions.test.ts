import { afterEach, beforeEach, describe, expect, test } from "bun:test";
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
import sharp from "sharp";

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
async function upload(path: string, token: string, png: Uint8Array, rights: string, realPerson: string) {
  const form = new FormData(); form.append("image", new File([new Uint8Array(png)], "Mascot.png", { type: "image/png" })); form.append("rights_confirmed", rights); form.append("shows_real_person", realPerson);
  return app.request(`http://localhost/api/${path}`, { method: "POST", headers: { cookie: `session=${token}` }, body: form });
}
async function transparentPng() {
  return new Uint8Array(await sharp({ create: { width: 512, height: 512, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: await sharp({ create: { width: 180, height: 180, channels: 4, background: { r: 0, g: 255, b: 0, alpha: 1 } } }).png().toBuffer(), left: 166, top: 166 }]).png().toBuffer());
}
function fixture() {
  const loaded = loadManifestOnly("rivet"); if (!loaded.ok || !loaded.value.companion) throw new Error("rivet fixture is unavailable");
  return loaded.value.companion;
}

beforeEach(() => { resetDb(); rmSync(companionRoot, { recursive: true, force: true }); __reloadPersonasForTests(); });
afterEach(() => { resetDb(); rmSync(companionRoot, { recursive: true, force: true }); __reloadPersonasForTests(); });

describe("household companion routes", () => {
  test("look upload requires rights confirmation and refuses real people", async () => {
    const adult = addPerson("person-look-adult", "adult");
    const created = createHouseholdCompanion({ ...fixture(), display_name: "Look upload" }, { display_name: "Author", person_id: "person-look-adult" });
    if (!created.ok) throw new Error(created.error);
    const png = await transparentPng();
    const missingRights = await upload(`companions/${created.value.id}/look/upload`, adult, png, "false", "false");
    expect(missingRights.status).toBe(400); expect((await missingRights.json() as { error: string }).error).toBe("Tick the box to say you made this picture or have the right to use it.");
    const real = await upload(`companions/${created.value.id}/look/upload`, adult, png, "true", "true");
    expect(real.status).toBe(400); expect((await real.json() as { error: string }).error).toBe("Pictures of real people are not supported here yet. Use a drawing or a character instead.");
  });

  test("look upload, GET image and rest management are limited to the author or an admin", async () => {
    const author = addPerson("person-look-owner", "adult"), other = addPerson("person-look-other", "adult"), child = addPerson("person-look-child", "child"), teen = addPerson("person-look-teen", "teen"), admin = addPerson("person-look-admin", "admin");
    const created = createHouseholdCompanion({ ...fixture(), display_name: "Look owner" }, { display_name: "Author", person_id: "person-look-owner" });
    if (!created.ok) throw new Error(created.error);
    const path = `companions/${created.value.id}/look/upload`, png = await transparentPng();
    for (const token of [other, child, teen]) expect((await upload(path, token, png, "true", "false")).status).toBe(403);
    const added = await upload(path, author, png, "true", "false"); expect(added.status).toBe(201);
    const { id: version } = await added.json() as { id: string }; expect(version).toBe("v-1");
    const look = await request(`companions/${created.value.id}/look`, author);
    expect(await look.json()).toMatchObject({ rest: version, can_generate: false, versions: [{ id: version, label: "Mascot", source: "upload" }] });
    const image = await request(`companions/${created.value.id}/look/${version}/image`, author);
    expect(image.status).toBe(200); expect(image.headers.get("content-type")).toBe("image/png"); expect(image.headers.get("cache-control")).toBe("private, max-age=0, must-revalidate");
    expect(new Uint8Array(await image.arrayBuffer()).byteLength).toBeGreaterThan(100);
    expect((await request(`companions/${created.value.id}/look/${version}/image`, admin)).status).toBe(200);
    expect((await request(`companions/${created.value.id}/look/${version}/image`, other)).status).toBe(403);
    const second = await upload(path, author, png, "true", "false"); const secondId = (await second.json() as { id: string }).id;
    const set = await request(`companions/${created.value.id}/look/rest`, author, "PUT", { version_id: secondId }); expect(set.status).toBe(200);
    const refused = await request(`companions/${created.value.id}/look/${secondId}`, author, "DELETE"); expect(refused.status).toBe(409);
    const removed = await request(`companions/${created.value.id}/look/${version}`, author, "DELETE"); expect(removed.status).toBe(204);
    const edit = await request(`companions/${created.value.id}/edit`, author); expect((await edit.json() as { look: { versions: number; rest: string } }).look).toEqual({ versions: 1, rest: secondId });
  });

  test("bundled companions have no editable look store", async () => {
    const adult = addPerson("person-look-bundle", "adult");
    const response = await app.request("http://localhost/api/companions/rivet/look", { headers: headers(adult) });
    expect(response.status).toBe(403); expect((await response.json() as { error: string }).error).toBe("A bundled companion can't be changed. Make a copy to edit it.");
  });

  test("children and teens cannot create; an adult creates a draft", async () => {
    const child = addPerson("person-child01", "child"), teen = addPerson("person-teen001", "teen"), adult = addPerson("person-adult01", "adult");
    for (const token of [child, teen]) {
      const refused = await request("companions", token, "POST", { ...fixture(), display_name: "New pal" });
      expect(refused.status).toBe(403); expect(((await refused.json()) as { error: string }).error).toBe("Only adults can make a companion.");
    }
    const response = await request("companions", adult, "POST", { ...fixture(), display_name: "New pal" });
    expect(response.status).toBe(201);
    const list = await request("companions", adult); expect((await list.json() as { can_create: boolean }).can_create).toBe(true);
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

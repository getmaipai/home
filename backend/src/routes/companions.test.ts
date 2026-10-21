import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { OpenAPIHono } from "@hono/zod-openapi";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import { db } from "@/db";
import { devices, people, sessions, settingsValues } from "@/db/schema";
import { companionsRoutes } from "@/routes/companions";
import { settingsRoutes } from "@/routes/settings";
import { createHouseholdCompanion } from "@/lib/householdCompanions";
import { loadManifestOnly } from "@/lib/plugins";
import { __reloadPersonasForTests } from "@/lib/persona";
import { resetDb } from "../../tests/reset-db";
import sharp from "sharp";
import { __setPicturesFetchForTests } from "@/lib/pictures/stack";
import { __setPictureStatusForTests, readyStatusForTests } from "@/lib/pictures/ready";
import { __clearCompanionLookJobsForTests } from "@/lib/companionLookJobs";
import { __setCharacterPictureCapabilityForTests } from "@/lib/companionLook";
import { addTake, takePath, __resetCompanionStatesForTests } from "@/lib/companionStates";

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

beforeEach(() => { resetDb(); rmSync(companionRoot, { recursive: true, force: true }); __reloadPersonasForTests(); __clearCompanionLookJobsForTests(); __resetCompanionStatesForTests(); __setPicturesFetchForTests(null); __setPictureStatusForTests(undefined); __setCharacterPictureCapabilityForTests(null); });
afterEach(() => { resetDb(); rmSync(companionRoot, { recursive: true, force: true }); __reloadPersonasForTests(); __clearCompanionLookJobsForTests(); __resetCompanionStatesForTests(); __setPicturesFetchForTests(null); __setPictureStatusForTests(undefined); __setCharacterPictureCapabilityForTests(null); });

async function keyedPicture() {
  const svg = Buffer.from('<svg width="512" height="512"><circle cx="256" cy="256" r="150" fill="red"/></svg>');
  return new Uint8Array(await sharp({ create: { width: 512, height: 512, channels: 3, background: { r: 0, g: 255, b: 0 } } }).composite([{ input: svg }]).png().toBuffer());
}

describe("companion look generation jobs", () => {
  test("requires a prompt, refuses minors, refuses policy prompts, and reports engine readiness", async () => {
    const adult = addPerson("person-look-gen", "adult"), child = addPerson("person-look-gen-child", "child"), teen = addPerson("person-look-gen-teen", "teen");
    const created = createHouseholdCompanion({ ...fixture(), display_name: "Look generation", look_prompt: "a red fox" }, { display_name: "Author", person_id: "person-look-gen" });
    if (!created.ok) throw new Error(created.error);
    const path = `companions/${created.value.id}/look/generate`;
    let stackCalls = 0;
    __setPictureStatusForTests(readyStatusForTests());
    __setPicturesFetchForTests((async () => { stackCalls++; return Response.json({ job: "look-policy-job" }, { status: 202 }); }) as unknown as typeof fetch);
    expect((await request(path, adult, "POST", {})).status).toBe(202);
    const noPrompt = createHouseholdCompanion({ ...fixture(), display_name: "No prompt", look_prompt: undefined }, { display_name: "Author", person_id: "person-look-gen" });
    if (!noPrompt.ok) throw new Error(noPrompt.error);
    const missing = await request(`companions/${noPrompt.value.id}/look/generate`, adult, "POST", {});
    expect(missing.status).toBe(400);
    const childResult = await request(path, child, "POST", { prompt: "cartoon dragon" }); expect(childResult.status).toBe(403);
    const teenResult = await request(path, teen, "POST", { prompt: "cartoon dragon" }); expect(teenResult.status).toBe(403);
    const beforeRefusal = stackCalls;
    const refused = await request(`companions/${noPrompt.value.id}/look/generate`, adult, "POST", { prompt: "a 12 year old child naked" }); expect(refused.status).toBe(422);
    expect(((await refused.json()) as { error: string }).error).toContain("I can't make that");
    expect(stackCalls).toBe(beforeRefusal);
    __setPictureStatusForTests(null);
    const unavailableCompanion = createHouseholdCompanion({ ...fixture(), display_name: "No engine", look_prompt: "a red fox" }, { display_name: "Author", person_id: "person-look-gen" });
    if (!unavailableCompanion.ok) throw new Error(unavailableCompanion.error);
    const unavailable = await request(`companions/${unavailableCompanion.value.id}/look/generate`, adult, "POST", {});
    expect(unavailable.status).toBe(503);
  });

  test("queues, polls and stores four candidates only once, then cancels jobs", async () => {
    const adult = addPerson("person-look-jobs", "adult");
    const created = createHouseholdCompanion({ ...fixture(), display_name: "Job character", look_prompt: "a red fox" }, { display_name: "Author", person_id: "person-look-jobs" });
    if (!created.ok) throw new Error(created.error);
    __setPictureStatusForTests(readyStatusForTests());
    const image = await keyedPicture(); let reads = 0;
    __setPicturesFetchForTests((async (input) => {
      const url = String(input);
      if (url.endsWith("/v1/images/generations")) return Response.json({ job: "look-job-1" }, { status: 202 });
      if (url.endsWith("/look-job-1")) { reads++; return Response.json({ job: "look-job-1", state: reads === 1 ? "queued" : reads === 2 ? "running" : "done", progress: 0.4, data: [] }); }
      if (/look-job-1\/\d+\.png$/.test(url)) return new Response(image, { headers: { "content-type": "image/png" } });
      if (url.endsWith("/v1/images/generations/look-job-1")) return new Response(null, { status: 204 });
      return new Response("Not found", { status: 404 });
    }) as typeof fetch);
    const started = await request(`companions/${created.value.id}/look/generate`, adult, "POST", {}); expect(started.status).toBe(202);
    const { job } = await started.json() as { job: string };
    expect((await request(`companions/${created.value.id}/look/generate`, adult, "POST", {})).status).toBe(409);
    const poll = `companions/${created.value.id}/look/jobs/${job}`;
    expect((await (await request(poll, adult)).json() as { state: string }).state).toBe("queued");
    expect((await (await request(poll, adult)).json() as { state: string }).state).toBe("running");
    expect((await (await request(poll, adult)).json() as { state: string; versions: unknown[] }).versions).toHaveLength(4);
    expect((await (await request(poll, adult)).json() as { state: string; versions: unknown[] }).versions).toHaveLength(4);
    await expect((await request(`companions/${created.value.id}/look`, adult)).json()).resolves.toMatchObject({ versions: expect.arrayContaining([expect.objectContaining({ source: "generated" })]) });
    const cancelledStart = await request(`companions/${created.value.id}/look/generate`, adult, "POST", {});
    const cancelledJob = (await cancelledStart.json() as { job: string }).job;
    expect((await request(`companions/${created.value.id}/look/jobs/${cancelledJob}`, adult, "DELETE")).status).toBe(204);
  });

  test("edits a look picture and records its source version", async () => {
    const adult = addPerson("person-look-edit", "adult");
    const created = createHouseholdCompanion({ ...fixture(), display_name: "Edit character", look_prompt: "a red fox" }, { display_name: "Author", person_id: "person-look-edit" });
    if (!created.ok) throw new Error(created.error);
    const image = await keyedPicture();
    __setPictureStatusForTests(readyStatusForTests());
    const started: string[] = [];
    __setPicturesFetchForTests((async (input, init) => {
      const url = String(input), method = init?.method ?? "GET";
      if (url.endsWith("/v1/images/edits") && method === "POST") { started.push("edit"); return Response.json({ job: "look-edit-1" }, { status: 202 }); }
      if (url.endsWith("/look-edit-1")) return Response.json({ job: "look-edit-1", state: "done", progress: 1, data: [] });
      if (url.endsWith("/look-edit-1/0.png")) return new Response(image, { headers: { "content-type": "image/png" } });
      return new Response("Not found", { status: 404 });
    }) as typeof fetch);
    const sourceResponse = await upload(`companions/${created.value.id}/look/upload`, adult, await transparentPng(), "true", "false");
    const { id: sourceId } = await sourceResponse.json() as { id: string };
    const edit = await request(`companions/${created.value.id}/look/edit`, adult, "POST", { version_id: sourceId, instruction: "Add a blue scarf" });
    expect(edit.status).toBe(202); expect(started).toEqual(["edit"]);
    const { job } = await edit.json() as { job: string };
    const result = await request(`companions/${created.value.id}/look/jobs/${job}`, adult);
    expect(await result.json()).toMatchObject({ state: "done", versions: [{ label: "Add a blue scarf" }] });
    const look = await (await request(`companions/${created.value.id}/look`, adult)).json() as { versions: Array<{ id: string; source: string; from: string | null }> };
    expect(look.versions).toHaveLength(2);
    expect(look.versions[1]).toMatchObject({ source: "edit", from: sourceId });
  });

  test("makes three sheet views once, falls back to the look prompt, and approves then unapproves", async () => {
    const adult = addPerson("person-look-sheet", "adult"), other = addPerson("person-look-sheet-other", "adult"), child = addPerson("person-look-sheet-child", "child"), teen = addPerson("person-look-sheet-teen", "teen");
    const created = createHouseholdCompanion({ ...fixture(), display_name: "Sheet character", look_prompt: "a red fox wearing a blue scarf" }, { display_name: "Author", person_id: "person-look-sheet" });
    if (!created.ok) throw new Error(created.error);
    __setPictureStatusForTests(readyStatusForTests());
    __setCharacterPictureCapabilityForTests({ imageParts: false, pictureTokensMax: null });
    const output = await sharp({ create: { width: 512, height: 512, channels: 3, background: "#cc3322" } }).png().toBuffer();
    let next = 0; const submitted: string[] = [];
    __setPicturesFetchForTests((async (input, init) => {
      const url = String(input), method = init?.method ?? "GET";
      if (url.endsWith("/v1/images/edits") && method === "POST") { const job = `sheet-stack-${++next}`; submitted.push(String((init?.body as FormData).get("instruction"))); return Response.json({ job }, { status: 202 }); }
      const match = url.match(/sheet-stack-(\d+)(?:\/(\d+)\.png)?$/);
      if (match?.[2] !== undefined) return new Response(output, { headers: { "content-type": "image/png" } });
      if (match) return Response.json({ job: `sheet-stack-${match[1]}`, state: "done", progress: 1, data: [] });
      return new Response("Not found", { status: 404 });
    }) as typeof fetch);
    const uploaded = await upload(`companions/${created.value.id}/look/upload`, adult, await transparentPng(), "true", "false");
    const rest = (await uploaded.json() as { id: string }).id;
    for (const token of [other, child, teen]) expect((await request(`companions/${created.value.id}/look/sheet`, token, "POST", {})).status).toBe(403);
    const start = await request(`companions/${created.value.id}/look/sheet`, adult, "POST", {});
    expect(start.status).toBe(202); const started = await start.json() as { job: string; card_source: string }; expect(started).toMatchObject({ card_source: "look_prompt" });
    const { job } = started;
    expect((await request(`companions/${created.value.id}/look/sheet`, adult, "POST", {})).status).toBe(409);
    const poll = `companions/${created.value.id}/look/jobs/${job}`;
    await request(poll, adult); await request(poll, adult); const done = await request(poll, adult);
    expect(await done.json()).toMatchObject({ state: "done", versions: [{ label: "Turned left" }, { label: "Turned right" }, { label: "Mouth open" }] });
    expect(await (await request(poll, adult)).json()).toMatchObject({ state: "done" });
    expect(submitted).toHaveLength(3); expect(submitted[0]).toContain("three quarters to its left"); expect(submitted[1]).toContain("three quarters to its right");
    const look = await (await request(`companions/${created.value.id}/look`, adult)).json() as { versions: unknown[]; sheet: { card: { text: string }; views: Record<string, { version_id: string }>; state: string }; ready_for_video: boolean };
    expect(look.sheet).toMatchObject({ state: "needs_review", card: { text: "a red fox wearing a blue scarf" } }); expect(Object.keys(look.sheet.views)).toEqual(["left", "right", "mouth"]); expect(look.ready_for_video).toBe(false);
    expect(look.versions).toHaveLength(4);
    expect((await request(`companions/${created.value.id}/look/sheet/key`, adult, "PUT", { key: "#FF00FF" })).status).toBe(200);
    expect((await request(`companions/${created.value.id}/look/sheet/key`, adult, "PUT", { key: "#00FF00" })).status).toBe(200);
    expect((await request(`companions/${created.value.id}/look/sheet/key`, adult, "PUT", { key: "#123456" })).status).toBe(400);
    const approved = await request(`companions/${created.value.id}/look/sheet/approve`, adult, "POST", {}); expect(approved.status).toBe(200);
    expect((await (await request(`companions/${created.value.id}/look`, adult)).json() as { ready_for_video: boolean }).ready_for_video).toBe(true);
    expect((await request(`companions/${created.value.id}/look/sheet/unapprove`, adult, "POST", {})).status).toBe(200);
    expect((await request(`companions/${created.value.id}/look/sheet/approve`, adult, "POST", {})).status).toBe(200);
    const mouthId = look.sheet.views.mouth!.version_id;
    expect((await request(`companions/${created.value.id}/look/${mouthId}`, adult, "DELETE")).status).toBe(204);
    expect((await (await request(`companions/${created.value.id}/look`, adult)).json() as { sheet: { state: string } }).sheet.state).toBe("needs_review");
    const leftId = look.sheet.views.left!.version_id;
    const changed = await request(`companions/${created.value.id}/look/rest`, adult, "PUT", { version_id: leftId }); expect(await changed.json()).toMatchObject({ sheet_reset: true });
    expect(rest).not.toBe(leftId);
    expect((await (await request(`companions/${created.value.id}/look`, adult)).json() as { sheet: unknown }).sheet).toBeNull();
  });

  test("reports a failed side view and leaves its sheet slot empty", async () => {
    const adult = addPerson("person-look-sheet-fail", "adult");
    const created = createHouseholdCompanion({ ...fixture(), display_name: "Sheet failure", look_prompt: "a blue bird" }, { display_name: "Author", person_id: "person-look-sheet-fail" });
    if (!created.ok) throw new Error(created.error);
    const uploaded = await upload(`companions/${created.value.id}/look/upload`, adult, await transparentPng(), "true", "false");
    __setPictureStatusForTests(readyStatusForTests()); __setCharacterPictureCapabilityForTests({ imageParts: false, pictureTokensMax: null });
    __setPicturesFetchForTests((async (input, init) => {
      const url = String(input);
      if (url.endsWith("/v1/images/edits") && init?.method === "POST") return Response.json({ job: "sheet-fail-stack" }, { status: 202 });
      if (url.endsWith("/sheet-fail-stack")) return Response.json({ job: "sheet-fail-stack", state: "failed", progress: 0, data: [] });
      return new Response("Not found", { status: 404 });
    }) as typeof fetch);
    const started = await request(`companions/${created.value.id}/look/sheet`, adult, "POST", {}), { job } = await started.json() as { job: string };
    const result = await request(`companions/${created.value.id}/look/jobs/${job}`, adult);
    expect(await result.json()).toMatchObject({ state: "failed", error: "The side view did not work. Try again." });
    expect((await (await request(`companions/${created.value.id}/look`, adult)).json() as { sheet: { views: { left: string | null }; state: string } }).sheet).toMatchObject({ views: { left: null }, state: "needs_review" });
  });
});

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
    const edit = await request(`companions/${created.value.id}/edit`, author); expect((await edit.json() as { look: { versions: number; rest: string } }).look).toMatchObject({ versions: 1, rest: secondId });
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

  test("states view follows the media vocabulary, files support byte ranges, and bundled states are blocked", async () => {
    const adult = addPerson("person-states", "adult"), other = addPerson("person-states-other", "adult");
    const created = createHouseholdCompanion({ ...fixture(), display_name: "State routes" }, { display_name: "person-states", person_id: "person-states" });
    if (!created.ok) throw new Error(created.error);
    const take = addTake(created.value.id, "idle", { source: "upload", label: "Idle take" });
    const path = takePath(created.value.id, "idle", take.id, "clip.h264.mp4")!;
    mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, Buffer.from("0123456789"));
    const stateResponse = await request(`companions/${created.value.id}/states`, adult);
    expect(stateResponse.status).toBe(200);
    const stateBody = await stateResponse.json() as { states: Array<{ id: string; required: boolean }> };
    expect(stateBody.states.map((s) => s.id)).toEqual(["idle", "idle_look", "listening", "thinking", "working", "speaking", "needs_you", "greeting", "happy", "oops", "celebrate", "sleeping"]);
    expect(stateBody.states[0]?.required).toBe(true);
    const partial = await app.request(`http://localhost/api/companions/${created.value.id}/states/idle/${take.id}/clip.h264.mp4`, { headers: { cookie: `session=${adult}`, range: "bytes=2-5" } });
    expect(partial.status).toBe(206); expect(partial.headers.get("content-range")).toBe("bytes 2-5/10"); expect(await partial.text()).toBe("2345");
    const full = await app.request(`http://localhost/api/companions/${created.value.id}/states/idle/${take.id}/clip.h264.mp4`, { headers: { cookie: `session=${adult}` } });
    expect(full.status).toBe(200); expect(full.headers.get("accept-ranges")).toBe("bytes");
    const unknown = await app.request(`http://localhost/api/companions/${created.value.id}/states/idle/${take.id}/manifest.json`, { headers: { cookie: `session=${adult}` } }); expect(unknown.status).toBe(404);
    expect((await request(`companions/${created.value.id}/states`, other)).status).toBe(403);
    expect((await request("companions/rivet/states", adult)).status).toBe(403);
  });
});

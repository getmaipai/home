import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { OpenAPIHono } from "@hono/zod-openapi";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { db } from "@/db";
import { and, eq } from "drizzle-orm";
import { devices, people, sessions, settingsValues, jobs, conversations } from "@/db/schema";
import { companionsRoutes } from "@/routes/companions";
import { settingsRoutes } from "@/routes/settings";
import { createHouseholdCompanion, householdCompanionFolder, setHouseholdCompanionAnimation, setHouseholdCompanionAudience, setHouseholdCompanionStatus } from "@/lib/householdCompanions";
import { loadManifestOnly } from "@/lib/plugins";
import { __reloadPersonasForTests } from "@/lib/persona";
import { __resetSettingsCacheForTests } from "@/lib/settings";
import { resetDb } from "./reset-db";
import sharp from "sharp";
import { __setPicturesFetchForTests } from "@/lib/pictures/stack";
import { __setPictureStatusForTests, readyStatusForTests } from "@/lib/pictures/ready";
import { __clearCompanionLookJobsForTests } from "@/lib/companionLookJobs";
import { __setCharacterPictureCapabilityForTests } from "@/lib/companionLook";
import { portraitPath } from "@/lib/companionPortrait";
import { addTake, takePath, saveStates, readStates, bestTake, __resetCompanionStatesForTests } from "@/lib/companionStates";
import { __setStackClientForTests } from "@/lib/stackEngine";
import { addVersion, approveSheet, setRest, updateSheet } from "@/lib/companionLook";
import { getHouseholdCompanion } from "@/lib/householdCompanions";
import { __setVideosFetchForTests } from "@/lib/videos/stack";
import { __setVideoStatusForTests, readyVideoStatusForTests } from "@/lib/videos/ready";
import { __clearCompanionTakeRunsForTests, __setTakeRetryWaitMsForTests } from "@/lib/companionTakes";
import media from "@maipai/spec/vocab/companion-media.json";
import { __setAgeCheckRunnerForTests, __resetAgeCheckForTests } from "@/lib/pictures/ageCheck";
import { __setChildSafetyRunnerForTests } from "@/lib/pictures/laneGate";
import { __setKeyframesForTests } from "@/lib/pictures/keyframes";

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
async function upload(path: string, token: string, png: Uint8Array) {
  const form = new FormData(); form.append("image", new File([new Uint8Array(png)], "Mascot.png", { type: "image/png" }));
  return app.request(`http://localhost/api/${path}`, { method: "POST", headers: { cookie: `session=${token}` }, body: form });
}
async function transparentPng() {
  return new Uint8Array(await sharp({ create: { width: 512, height: 512, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: await sharp({ create: { width: 180, height: 180, channels: 4, background: { r: 0, g: 255, b: 0, alpha: 1 } } }).png().toBuffer(), left: 166, top: 166 }]).png().toBuffer());
}
function fixture() {
  const loaded = loadManifestOnly("rivet"); if (!loaded.ok || !loaded.value.companion) throw new Error("rivet fixture is unavailable");
  return loaded.value.companion;
}


const AGE_OK = { ok: true as const, verdict: { people_count: 0, apparent_min_age_estimate: null, label: "none" as const, is_nude_or_sexual: false, confidence: 1 } };
const AGE_WITHHELD = { ok: true as const, verdict: { people_count: 1, apparent_min_age_estimate: 8, label: "child" as const, is_nude_or_sexual: true, confidence: 1 } };
const CHILD_OK = { ok: true as const, verdict: { is_cartoon: true, looks_like_photo: false, brand_or_licensed_character: false, violent_or_scary: false, sexual_or_romantic: false, weapons_drugs_or_alcohol: false, confidence: 1 } };
/** A live companion under the old model (live animation, approved idle) whose draft has since moved to a second approved take. */
async function publishFixture(personId: string, role: string, audience: "adult" | "teen" | "all", persistBackfill = true) {
  const token = addPerson(personId, role), made = createHouseholdCompanion({ ...fixture(), display_name: `Pub ${personId}` }, { display_name: "Author", person_id: personId }); if (!made.ok) throw new Error(made.error); const id = made.value.id;
  const png = await transparentPng(), rest = addVersion(id, png, { source: "upload", label: "rest", width: 1024, height: 1024, from: null }); setRest(id, rest.id);
  updateSheet(id, { views: { left: null, right: null, mouth: null }, card: { text: "fox", species: "fox", colours: ["#CC3322"] }, key: "#00FF00", state: "needs_review", approved_by: null, approved_at: null }); approveSheet(id, "Author");
  const report = { ok: true, reasons: [], seconds: 3, bytes: { h264: 4, av1: null }, colour_distance: 1, area_ratio: 1, loop_gap: 0, opaque_share: { min: .5, max: .8 } };
  const makeTake = (label: string) => { const take = addTake(id, "idle", { source: "upload", label }), all = readStates(id); all.states.idle!.takes.find((row) => row.id === take.id)!.report = report; saveStates(id, all); mkdirSync(join(takePath(id, "idle", take.id, "clip.h264.mp4")!, ".."), { recursive: true }); writeFileSync(takePath(id, "idle", take.id, "clip.h264.mp4")!, label); writeFileSync(takePath(id, "idle", take.id, "still.png")!, Buffer.from(png)); return take.id; };
  const first = makeTake("first"), seeded = readStates(id); seeded.states.idle!.approved = first; saveStates(id, seeded);
  setHouseholdCompanionAnimation(id, { kind: "video", spec_version: media.version, key: "#00FF00", states: { idle: { h264: "old.h264.mp4", still: "old.png", loop: true } } });
  const live = join(householdCompanionFolder(id)!, "animation"); mkdirSync(live, { recursive: true }); writeFileSync(join(live, "old.h264.mp4"), "old"); writeFileSync(join(live, "old.png"), Buffer.from(png)); writeFileSync(join(live, "rest.png"), Buffer.from(png));
  setHouseholdCompanionAudience(id, audience, { display_name: "Author" });
  if (persistBackfill) expect((await request(`companions/${id}/appearance`, token)).status).toBe(200);
  const second = makeTake("second"), moved = readStates(id); moved.states.idle!.approved = second; saveStates(id, moved);
  __setKeyframesForTests(async () => [new Uint8Array([7])]);
  return { token, id, png, first, second, live };
}

beforeEach(() => { resetDb(); rmSync(companionRoot, { recursive: true, force: true }); __reloadPersonasForTests(); __clearCompanionLookJobsForTests(); __clearCompanionTakeRunsForTests(); __resetCompanionStatesForTests(); __setPicturesFetchForTests(null); __setVideoStatusForTests(undefined); __setVideosFetchForTests(null); __setPictureStatusForTests(undefined); __setCharacterPictureCapabilityForTests(null); __setStackClientForTests(null); });
afterEach(() => { __resetAgeCheckForTests(); __setChildSafetyRunnerForTests(null); __setKeyframesForTests(null); resetDb(); rmSync(companionRoot, { recursive: true, force: true }); __reloadPersonasForTests(); __clearCompanionLookJobsForTests(); __clearCompanionTakeRunsForTests(); __resetCompanionStatesForTests(); __setPicturesFetchForTests(null); __setVideoStatusForTests(undefined); __setVideosFetchForTests(null); __setPictureStatusForTests(undefined); __setCharacterPictureCapabilityForTests(null); __setStackClientForTests(null); });

test("activity returns own task details and needs-you agrees with companion waiting counts", async () => {
  const person = addPerson("activity-own", "adult"), other = addPerson("activity-other", "adult");
  db.insert(jobs).values([
    { id: "waiting-task", kind: "ask", startedBy: "activity-own", forPerson: "activity-own", title: "Choose an option", state: "waiting", progress: "  Looking for an answer  ", waitingReason: "Choose one", resultRef: null, conversationId: null, companionId: "rivet", errorKind: null, raw: null, provenance: "{}", createdAt: now, updatedAt: now },
    { id: "running-task", kind: "project", startedBy: "activity-own", forPerson: "activity-own", title: "Working", state: "running", progress: "Working now", waitingReason: null, resultRef: null, conversationId: null, companionId: "rivet", errorKind: null, raw: null, provenance: "{}", createdAt: now, updatedAt: now },
    { id: "private-task", kind: "ask", startedBy: "activity-other", forPerson: "activity-other", title: "Private", state: "waiting", progress: null, waitingReason: "Private reason", resultRef: null, conversationId: null, companionId: "rivet", errorKind: null, raw: null, provenance: "{}", createdAt: now, updatedAt: now },
  ]).run();
  const rows = (await (await request("companions/rivet/activity", person)).json() as { activity: Array<Record<string, unknown>> }).activity;
  expect(rows).toHaveLength(2);
  expect(rows.find((row) => row.id === "waiting-task")).toMatchObject({ conversation_id: null, waiting_reason: "Choose one", progress: "Looking for an answer", result_ref: null, needs_you: true });
  expect(rows.find((row) => row.id === "running-task")?.needs_you).toBe(false);
  const card = (await (await request("companions", person)).json() as { companions: Array<{ id: string; waiting_count: number }> }).companions.find((row) => row.id === "rivet");
  expect(card?.waiting_count).toBe(1);
});

test("companion set routes materialize unset, add and remove per person, and enforce default and age limits", async () => {
  const adult = addPerson("person-set-route", "adult"), other = addPerson("person-set-other", "adult"), child = addPerson("person-set-child", "child"), teen = addPerson("person-set-teen", "teen");
  const created = createHouseholdCompanion({ ...fixture(), display_name: "Set candidate" }, { display_name: "Author", person_id: "person-set-other" });
  if (!created.ok) throw new Error(created.error);
  setHouseholdCompanionStatus(created.value.id, "ready"); __reloadPersonasForTests();
  const addableId = created.value.id;
  const initial = await (await request("companions", adult)).json() as { companions: Array<{ id: string }>; discover: Array<{ id: string }> };
  expect(initial.companions.map((item) => item.id)).toContain(addableId);
  expect((await request("companions/tessa/remove", adult, "POST")).status).toBe(400);
  const add = await request(`companions/${addableId}/add`, adult, "POST"); expect(add.status).toBe(200);
  const afterAdd = await (await request("companions", adult)).json() as { companions: Array<{ id: string }>; discover: Array<{ id: string }> };
  expect(afterAdd.companions.map((item) => item.id)).toContain(addableId);
  expect((await request(`companions/${addableId}/remove`, adult, "POST")).status).toBe(200);
  const afterRemove = await (await request("companions", adult)).json() as { companions: Array<{ id: string }>; discover: Array<{ id: string }> };
  expect(afterRemove.companions.map((item) => item.id)).not.toContain(addableId);
  const otherList = await (await request("companions", other)).json() as { companions: Array<{ id: string }> };
  expect(otherList.companions.map((item) => item.id)).toContain(addableId);
  const adultOnly = addableId;
  expect((await request(`companions/${adultOnly}/add`, child, "POST")).status).toBe(403);
  expect((await request(`companions/${adultOnly}/add`, teen, "POST")).status).toBe(403);
  const teenHouse = createHouseholdCompanion({ ...fixture(), display_name: "Teen set candidate", audience: "teen" }, { display_name: "Author", person_id: "person-set-route" });
  if (!teenHouse.ok) throw new Error(teenHouse.error);
  setHouseholdCompanionStatus(teenHouse.value.id, "ready"); setHouseholdCompanionAudience(teenHouse.value.id, "teen"); __reloadPersonasForTests();
  expect((await request(`companions/${teenHouse.value.id}/add`, teen, "POST")).status).toBe(200);
});

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

  test("COMPANION-ART-CHECK-01: generated look candidates that fail the age check are not kept and the job says why", async () => {
    const adult = addPerson("person-look-withheld", "adult");
    const created = createHouseholdCompanion({ ...fixture(), display_name: "Withheld character", look_prompt: "a red fox" }, { display_name: "Author", person_id: "person-look-withheld" });
    if (!created.ok) throw new Error(created.error);
    __setPictureStatusForTests(readyStatusForTests());
    __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { people_count: 1, apparent_min_age_estimate: 12, label: "child" as const, is_nude_or_sexual: true, confidence: 1 } })));
    const image = await keyedPicture();
    __setPicturesFetchForTests((async (input) => {
      const url = String(input);
      if (url.endsWith("/v1/images/generations")) return Response.json({ job: "look-withheld-1" }, { status: 202 });
      if (url.endsWith("/look-withheld-1")) return Response.json({ job: "look-withheld-1", state: "done", progress: 1, data: [] });
      if (/look-withheld-1\/\d+\.png$/.test(url)) return new Response(image, { headers: { "content-type": "image/png" } });
      if (url.endsWith("/v1/images/generations/look-withheld-1")) return new Response(null, { status: 204 });
      return new Response("Not found", { status: 404 });
    }) as typeof fetch);
    const started = await request(`companions/${created.value.id}/look/generate`, adult, "POST", {});
    const { job } = await started.json() as { job: string };
    const done = await (await request(`companions/${created.value.id}/look/jobs/${job}`, adult)).json() as { state: string; error?: string; versions: unknown[] };
    expect(done.state).toBe("failed");
    expect((done.error ?? "").length).toBeGreaterThan(10);
    expect(done.versions).toHaveLength(0);
    expect(((await (await request(`companions/${created.value.id}/look`, adult)).json()) as { versions: unknown[] }).versions).toHaveLength(0);
  });

  test("edits a look picture and records its source version", async () => {
    const adult = addPerson("person-look-edit", "adult");
    const created = createHouseholdCompanion({ ...fixture(), display_name: "Edit character", look_prompt: "a red fox" }, { display_name: "Author", person_id: "person-look-edit" });
    if (!created.ok) throw new Error(created.error);
    const image = await keyedPicture();
    __setPictureStatusForTests(readyStatusForTests());
    const started: string[] = [], postedSources: Array<{ image: string; image_source: string | File | null }> = [];
    __setPicturesFetchForTests((async (input, init) => {
      const url = String(input), method = init?.method ?? "GET";
      if (url.endsWith("/v1/images/edits") && method === "POST") { const form = init?.body as FormData, file = form.get("image") as File; postedSources.push({ image: Buffer.from(await file.arrayBuffer()).toString("base64"), image_source: form.get("image_source") }); started.push("edit"); return Response.json({ job: "look-edit-1" }, { status: 202 }); }
      if (url.endsWith("/look-edit-1")) return Response.json({ job: "look-edit-1", state: "done", progress: 1, data: [] });
      if (url.endsWith("/look-edit-1/0.png")) return new Response(image, { headers: { "content-type": "image/png" } });
      return new Response("Not found", { status: 404 });
    }) as typeof fetch);
    const sourceOriginal = image;
    const sourceVersion = addVersion(created.value.id, await transparentPng(), { source: "generated", label: "Rest", width: 1024, height: 1024, from: null }, sourceOriginal);
    const sourceId = sourceVersion.id;
    const edit = await request(`companions/${created.value.id}/look/edit`, adult, "POST", { version_id: sourceId, instruction: "Add a blue scarf" });
    expect(edit.status).toBe(202); expect(started).toEqual(["edit"]); expect(postedSources).toEqual([{ image: Buffer.from(sourceOriginal).toString("base64"), image_source: "generated" }]);
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
    let next = 0; const submitted: string[] = [], postedSources: Array<{ image: string; image_source: string | File | null }> = [];
    __setPicturesFetchForTests((async (input, init) => {
      const url = String(input), method = init?.method ?? "GET";
      if (url.endsWith("/v1/images/edits") && method === "POST") { const form = init?.body as FormData, file = form.get("image") as File; postedSources.push({ image: Buffer.from(await file.arrayBuffer()).toString("base64"), image_source: form.get("image_source") }); const job = `sheet-stack-${++next}`; submitted.push(String(form.get("instruction"))); return Response.json({ job }, { status: 202 }); }
      const match = url.match(/sheet-stack-(\d+)(?:\/(\d+)\.png)?$/);
      if (match?.[2] !== undefined) return new Response(output, { headers: { "content-type": "image/png" } });
      if (match) return Response.json({ job: `sheet-stack-${match[1]}`, state: "done", progress: 1, data: [] });
      return new Response("Not found", { status: 404 });
    }) as typeof fetch);
    const stackOriginal = new Uint8Array(output);
    const rest = addVersion(created.value.id, await transparentPng(), { source: "generated", label: "Rest", width: 1024, height: 1024, from: null }, stackOriginal).id;
    for (const token of [other, child, teen]) expect((await request(`companions/${created.value.id}/look/sheet`, token, "POST", {})).status).toBe(403);
    const start = await request(`companions/${created.value.id}/look/sheet`, adult, "POST", {});
    expect(start.status).toBe(202); const started = await start.json() as { job: string; card_source: string }; expect(started).toMatchObject({ card_source: "look_prompt" });
    const { job } = started;
    expect((await request(`companions/${created.value.id}/look/sheet`, adult, "POST", {})).status).toBe(409);
    const poll = `companions/${created.value.id}/look/jobs/${job}`;
    await request(poll, adult); await request(poll, adult); const done = await request(poll, adult);
    expect(await done.json()).toMatchObject({ state: "done", versions: [{ label: "Turned left" }, { label: "Turned right" }, { label: "Mouth open" }] });
    expect(await (await request(poll, adult)).json()).toMatchObject({ state: "done" });
    expect(submitted).toHaveLength(3); expect(submitted[0]).toContain("three quarters to its left"); expect(submitted[1]).toContain("three quarters to its right"); expect(postedSources).toEqual(Array.from({ length: 3 }, () => ({ image: Buffer.from(stackOriginal).toString("base64"), image_source: "generated" })));
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
    const uploaded = await upload(`companions/${created.value.id}/look/upload`, adult, await transparentPng());
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
  test("look upload accepts real person photos without a content consent prompt", async () => {
    const adult = addPerson("person-look-adult", "adult");
    const created = createHouseholdCompanion({ ...fixture(), display_name: "Look upload" }, { display_name: "Author", person_id: "person-look-adult" });
    if (!created.ok) throw new Error(created.error);
    const png = await transparentPng();
    const real = await upload(`companions/${created.value.id}/look/upload`, adult, png);
    expect(real.status).toBe(201);
  });

  test("look upload, GET image and rest management are limited to the author or an admin", async () => {
    const author = addPerson("person-look-owner", "adult"), other = addPerson("person-look-other", "adult"), child = addPerson("person-look-child", "child"), teen = addPerson("person-look-teen", "teen"), admin = addPerson("person-look-admin", "admin");
    const created = createHouseholdCompanion({ ...fixture(), display_name: "Look owner" }, { display_name: "Author", person_id: "person-look-owner" });
    if (!created.ok) throw new Error(created.error);
    const path = `companions/${created.value.id}/look/upload`, png = await transparentPng();
    for (const token of [other, child, teen]) expect((await upload(path, token, png)).status).toBe(403);
    const added = await upload(path, author, png); expect(added.status).toBe(201);
    const { id: version } = await added.json() as { id: string }; expect(version).toBe("v-1");
    const look = await request(`companions/${created.value.id}/look`, author);
    expect(await look.json()).toMatchObject({ rest: version, can_generate: false, versions: [{ id: version, label: "Mascot", source: "upload" }] });
    const image = await request(`companions/${created.value.id}/look/${version}/image`, author);
    expect(image.status).toBe(200); expect(image.headers.get("content-type")).toBe("image/png"); expect(image.headers.get("cache-control")).toBe("private, max-age=0, must-revalidate");
    expect(new Uint8Array(await image.arrayBuffer()).byteLength).toBeGreaterThan(100);
    expect((await request(`companions/${created.value.id}/look/${version}/image`, admin)).status).toBe(200);
    expect((await request(`companions/${created.value.id}/look/${version}/image`, other)).status).toBe(403);
    expect(existsSync(portraitPath(created.value.id, version)!)).toBe(false);
    const portrait = await request(`companions/portraits/${created.value.id}/${version}`, author);
    expect(portrait.status).toBe(200); expect(portrait.headers.get("content-type")).toBe("image/webp"); expect(portrait.headers.get("cache-control")).toContain("immutable");
    expect(existsSync(portraitPath(created.value.id, version)!)).toBe(true);
    expect((await request(`companions/portraits/${created.value.id}/v-999`, author)).status).toBe(404);
    expect((await request(`companions/portraits/${created.value.id}/${version}`, child)).status).toBe(404);
    expect((await app.request(`http://localhost/api/companions/portraits/${created.value.id}/${version}`)).status).toBe(401);
    const second = await upload(path, author, png); const secondId = (await second.json() as { id: string }).id;
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

  test("a draft companion's portrait is only for its author or an admin", async () => {
    const author = addPerson("portrait-draft-author", "adult"), other = addPerson("portrait-draft-other", "adult");
    const draft = createHouseholdCompanion({ ...fixture(), display_name: "Draft portrait" }, { display_name: "Author", person_id: "portrait-draft-author" });
    if (!draft.ok) throw new Error(draft.error);
    const png = await transparentPng(), version = addVersion(draft.value.id, png, { source: "upload", label: "rest", width: 512, height: 512, from: null });
    setRest(draft.value.id, version.id);
    expect((await request(`companions/portraits/${draft.value.id}/${version.id}`, author)).status).toBe(200);
    expect((await request(`companions/portraits/${draft.value.id}/${version.id}`, other)).status).toBe(404);
  });

  test("companion lists expose rest portrait keys without creating retained files", async () => {
    const adult = addPerson("portrait-list-adult", "adult");
    const created = createHouseholdCompanion({ ...fixture(), display_name: "Portrait list" }, { display_name: "Author", person_id: "portrait-list-adult" });
    if (!created.ok) throw new Error(created.error);
    setHouseholdCompanionStatus(created.value.id, "ready"); __reloadPersonasForTests();
    const png = await transparentPng(), version = addVersion(created.value.id, png, { source: "upload", label: "rest", width: 512, height: 512, from: null });
    setRest(created.value.id, version.id);
    const withoutLook = createHouseholdCompanion({ ...fixture(), display_name: "No portrait" }, { display_name: "Author", person_id: "portrait-list-adult" });
    if (!withoutLook.ok) throw new Error(withoutLook.error);
    setHouseholdCompanionStatus(withoutLook.value.id, "ready"); __reloadPersonasForTests();
    const cards = (await (await request("companions", adult)).json() as { companions: Array<{ id: string; portrait: string | null }> }).companions;
    expect(cards.find((card) => card.id === created.value.id)?.portrait).toBe(`${created.value.id}/${version.id}`);
    expect(cards.find((card) => card.id === withoutLook.value.id)?.portrait).toBeNull();
    expect(cards.find((card) => card.id === "rivet")?.portrait).toBeNull();
    expect(existsSync(portraitPath(created.value.id, version.id)!)).toBe(false);
  });

  test("list exposes child discovery eligibility and the actual default id", async () => {
    const child = addPerson("person-discover-child", "child");
    const adult = addPerson("person-discover-adult", "adult");
    const kidList = await (await request("companions", child)).json() as { can_discover: boolean; default_id: string };
    const adultList = await (await request("companions", adult)).json() as { can_discover: boolean; default_id: string };
    expect(kidList.can_discover).toBe(false);
    expect(adultList.can_discover).toBe(true);
    expect(kidList.default_id).toBe("tessa");
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

  test("a name alone creates a draft and blank optional fields are omitted", async () => {
    const adult = addPerson("person-adult-companion-blank", "adult");
    const response = await request("companions", adult, "POST", { name: "Only a name", tagline: "  ", backstory: "", pronouns: null, interests: [] });
    expect(response.status).toBe(201);
    const { id } = await response.json() as { id: string };
    const stored = getHouseholdCompanion(id);
    expect(stored?.description).toBe("A companion made at home.");
    expect(stored?.companion).toMatchObject({ display_name: "Only a name", status: "draft" });
    expect(stored?.companion?.tagline).toBeUndefined();
  });

  test("create validation returns field messages for one or more bad fields", async () => {
    const adult = addPerson("person-adult-companion-invalid", "adult");
    const one = await request("companions", adult, "POST", { ...fixture(), name: "Invalid about", backstory: "x".repeat(500) });
    expect(one.status).toBe(400);
    expect(await one.json()).toMatchObject({ fields: { backstory: expect.stringContaining("About is too long") }, error: expect.stringContaining("About is too long") });
    const two = await request("companions", adult, "POST", { ...fixture(), name: "Two invalid fields", backstory: "x".repeat(500), examples: ["one", "two"] });
    expect(two.status).toBe(400);
    expect(await two.json()).toMatchObject({ fields: { backstory: expect.stringContaining("About is too long"), examples: "Example lines: add at least 3." } });
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
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: "Example lines: add at least 3.", fields: { examples: "Example lines: add at least 3." } });
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
    const stateBody = await stateResponse.json() as { start_ready: boolean; start_reason?: string; states: Array<{ id: string; required: boolean }> };
    expect(stateBody.start_ready).toBe(false); expect(stateBody.start_reason).toContain("The video model can only start from a picture the picture model made.");
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

  test("state upload validates the file and approval stays in draft until Publish", async () => {
    __setKeyframesForTests(async () => [new Uint8Array([7])]);
    const adult = addPerson("person-state-upload", "adult"), created = createHouseholdCompanion({ ...fixture(), display_name: "State upload" }, { display_name: "Author", person_id: "person-state-upload" });
    if (!created.ok) throw new Error(created.error);
    const companionId = created.value.id;
    const rest = addVersion(companionId, new Uint8Array([1]), { source: "upload", label: "rest", width: 1024, height: 1024, from: null }); setRest(companionId, rest.id);
    updateSheet(companionId, { views: { left: null, right: null, mouth: null }, card: { text: "red fox", species: "fox", colours: ["#CC3322"] }, key: "#00FF00", state: "needs_review", approved_by: null, approved_at: null }); approveSheet(companionId, "Author");
    const videoBytes = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0]);
    async function uploadVideo(bytes = videoBytes) { const form = new FormData(); form.append("video", new File([bytes], "clip.mp4", { type: "video/mp4" }));   return app.request(`http://localhost/api/companions/${companionId}/states/idle/upload`, { method: "POST", headers: { cookie: `session=${adult}` }, body: form }); }
    expect((await uploadVideo(new Uint8Array([1, 2, 3]))).status).toBe(400);
    let submitted: any; let waitForFinish: (() => void) | undefined;
    __setStackClientForTests({ mediaRoots: async () => ({ read: [companionRoot], write: [companionRoot] }), setMediaRoots: async () => ({ read: [], write: [] }), submitJob: async (request: any) => { submitted = request; const out = join(request.input.output_dir, request.input.output_name); mkdirSync(out, { recursive: true }); writeFileSync(join(out, "clip.h264.mp4"), "h264"); writeFileSync(join(out, "still.png"), "png"); waitForFinish?.(); return { id: "state-job", state: "done", result: { ok: true, reasons: [], seconds: 3, files: [{ name: "clip.h264.mp4", bytes: 4 }], av1: false, colour_distance: 1, area_ratio: 1, loop_gap: 0, opaque_share: { min: .5, max: .8 } } }; }, job: async () => { throw Error("unexpected poll"); } } as never);
    const uploaded = await uploadVideo(); expect(uploaded.status).toBe(202); const { take_id } = await uploaded.json() as { take_id: string };
    await new Promise<void>((resolve) => { waitForFinish = resolve; setTimeout(resolve, 20); }); for (let attempt = 0; attempt < 200 && !readStates(companionId).states.idle?.takes.find((take) => take.id === take_id)?.report; attempt++) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(submitted.input).toMatchObject({ key: "#00FF00", output_name: "finished", max_bytes: media.ship.max_bytes_per_clip });
    const approval = await request(`companions/${companionId}/states/idle/approve`, adult, "PUT", { take_id }); expect(approval.status).toBe(200);
    expect(getHouseholdCompanion(companionId)?.companion?.animation).toBeUndefined();
    const appearance = await request(`companions/${companionId}/appearance`, adult); expect(appearance.status).toBe(200); expect(await appearance.json()).toMatchObject({ has_changes: true, can_publish: true });
    expect((await request(`companions/${companionId}/states/idle/${take_id}/source.mp4`, adult)).status).toBe(200);
  });

  test("state upload asks for an approved character sheet before accepting a clip", async () => {
    const adult = addPerson("person-state-no-sheet", "adult"), created = createHouseholdCompanion({ ...fixture(), display_name: "No state sheet" }, { display_name: "Author", person_id: "person-state-no-sheet" }); if (!created.ok) throw new Error(created.error);
    const form = new FormData(); form.append("video", new File([new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0])], "clip.mp4", { type: "video/mp4" }));
    const response = await app.request(`http://localhost/api/companions/${created.value.id}/states/idle/upload`, { method: "POST", headers: { cookie: `session=${adult}` }, body: form });
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: "Approve the character sheet first, so every clip starts from the same character." });
  });

  test("generates two candidates in sequence, finishes them, stores reports and deletes Stack jobs", async () => {
    __setKeyframesForTests(async () => [new Uint8Array([7])]);
    const adult = addPerson("person-state-generate", "adult"), created = createHouseholdCompanion({ ...fixture(), display_name: "Generated character" }, { display_name: "Author", person_id: "person-state-generate" }); if (!created.ok) throw new Error(created.error); const id = created.value.id;
    const stackOriginal = await transparentPng();
    const rest = addVersion(id, await transparentPng(), { source: "upload", label: "rest", width: 1024, height: 1024, from: null }, stackOriginal); setRest(id, rest.id); updateSheet(id, { views: { left: null, right: null, mouth: null }, card: { text: "A red fox with white paws", species: "fox", colours: ["#CC3322"] }, key: "#FF00FF", state: "needs_review", approved_by: null, approved_at: null }); approveSheet(id, "Author");
    __setVideoStatusForTests(readyVideoStatusForTests());
    const submitted: Array<Record<string, unknown>> = [], deleted: string[] = [], fetched: string[] = [];
    __setVideosFetchForTests((async (input, init) => {
      const url = new URL(String(input)), method = init?.method ?? "GET";
      if (url.pathname === "/v1/videos/generations" && method === "POST") { submitted.push(JSON.parse(String(init?.body)) as Record<string, unknown>); return Response.json({ job: `video-${submitted.length}` }, { status: 202 }); }
      const jobMatch = /^\/v1\/videos\/generations\/(video-\d+)$/.exec(url.pathname);
      if (jobMatch && method === "GET") return Response.json({ job: jobMatch[1], state: "done", progress: 100, data: [{ seed: submitted[Number(jobMatch[1]!.slice(6)) - 1]?.seed }] });
      const clipMatch = /^\/v1\/videos\/generations\/(video-\d+)\/video\.mp4$/.exec(url.pathname);
      if (clipMatch && method === "GET") { fetched.push(clipMatch[1]!); return new Response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112])); }
      if (jobMatch && method === "DELETE") { deleted.push(jobMatch[1]!); return new Response(null, { status: 204 }); }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch);
    let finished = 0;
    __setStackClientForTests({ mediaRoots: async () => ({ read: [companionRoot], write: [companionRoot] }), setMediaRoots: async () => ({ read: [companionRoot], write: [companionRoot] }), submitJob: async (request: any) => { finished++; expect(request.kind).toBe("media.companion_clip"); expect(request.input.key).toBe("#FF00FF"); const distance = request.input.output_dir.endsWith("take-2") ? 1 : 4; const out = join(request.input.output_dir, request.input.output_name); mkdirSync(out, { recursive: true }); writeFileSync(join(out, "clip.h264.mp4"), "h264"); writeFileSync(join(out, "still.png"), "png"); return { id: `media-${finished}`, state: "done", result: { ok: true, reasons: [], seconds: 3, files: [{ name: "clip.h264.mp4", bytes: 123 }], av1: false, colour_distance: distance, area_ratio: 1, loop_gap: 0, opaque_share: { min: .5, max: .8 }, colour_match: { applied: true, strength: .4 }, settle_skipped_frames: 16 } }; }, job: async () => { throw Error("unexpected poll"); } } as never);
    const started = await request(`companions/${id}/states/idle/generate`, adult, "POST", { count: 2 }); expect(started.status).toBe(202); const { job } = await started.json() as { job: string };
    let progress: any;
    for (let attempt = 0; attempt < 100; attempt++) { const response = await request(`companions/${id}/states/jobs/run/${job}`, adult); progress = await response.json(); if (progress.state === "done" || progress.state === "failed") break; await new Promise((resolve) => setTimeout(resolve, 5)); }
    expect(progress).toMatchObject({ state: "done", percent: 100, takes_made: 2 }); expect(progress.label).toContain("take 2 of 2");
    expect(submitted).toHaveLength(2); expect(submitted[0]?.seed).not.toBe(submitted[1]?.seed); expect(submitted[0]).toMatchObject({ size: `${media.generate.width}x${media.generate.height}`, seconds: media.generate.seconds, image_source: "generated", audience: "all-ages", timeout_ms: 1 }); expect(submitted[0]).toMatchObject({ model: "wan2.2-ti2v-5b-fastwan-mlx" });
    expect(submitted[0]?.image).toBe(Buffer.from(stackOriginal).toString("base64"));
    expect(fetched).toEqual(["video-1", "video-2"]); expect(deleted).toEqual(["video-1", "video-2"]); expect(finished).toBe(2);
    const takes = readStates(id).states.idle!.takes; expect(takes).toHaveLength(2); expect(takes.every((take) => take.report?.ok)).toBe(true); expect(bestTake(takes)?.id).toBe("take-2");
    const statesApi = await (await request(`companions/${id}/states`, adult)).json() as any;
    expect(statesApi.states.find((state: any) => state.id === "idle").takes[0]).toMatchObject({ colour_match: { applied: true, strength: .4 }, settle_skipped_frames: 16 });
  });

  test("retries one memory cancellation once with a fresh seed, and Stop during the wait wins", async () => {
    const adult = addPerson("person-state-retry", "adult"), submitted: Array<Record<string, unknown>> = [];
    __setVideoStatusForTests(readyVideoStatusForTests()); __setTakeRetryWaitMsForTests(0);
    const prepare = async (name: string) => {
      const created = createHouseholdCompanion({ ...fixture(), display_name: name }, { display_name: "Author", person_id: "person-state-retry" }); if (!created.ok) throw new Error(created.error);
      const id = created.value.id, original = await transparentPng();
      const rest = addVersion(id, original, { source: "upload", label: "rest", width: 1024, height: 1024, from: null }, original); setRest(id, rest.id);
      updateSheet(id, { views: { left: null, right: null, mouth: null }, card: { text: "A red fox", species: "fox", colours: ["#CC3322"] }, key: "#00FF00", state: "needs_review", approved_by: null, approved_at: null }); approveSheet(id, "Author");
      return id;
    };
    const runScenario = async (id: string, cancelCount: number, expectedState: "done" | "failed") => {
      let videoNumber = 0; const sent: Array<Record<string, unknown>> = [];
      __setVideosFetchForTests((async (input, init) => {
        const url = new URL(String(input)), method = init?.method ?? "GET";
        if (url.pathname === "/v1/videos/generations" && method === "POST") { const body = JSON.parse(String(init?.body)) as Record<string, unknown>; sent.push(body); videoNumber++; return Response.json({ job: `retry-${id}-${videoNumber}` }, { status: 202 }); }
        if (url.pathname.startsWith(`/v1/videos/generations/retry-${id}-`) && method === "GET") { const n = Number(url.pathname.slice(url.pathname.lastIndexOf("-") + 1)); return Response.json({ job: `retry-${id}-${n}`, state: n <= cancelCount ? "cancelled" : "done", progress: 100, data: [{ seed: sent[n - 1]?.seed }] }); }
        if (url.pathname.endsWith("/video.mp4") && method === "GET") return new Response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]));
        if (url.pathname.startsWith(`/v1/videos/generations/retry-${id}-`) && method === "DELETE") return new Response(null, { status: 204 });
        return new Response("Not found", { status: 404 });
      }) as typeof fetch);
      __setStackClientForTests({ mediaRoots: async () => ({ read: [companionRoot], write: [companionRoot] }), setMediaRoots: async () => ({ read: [companionRoot], write: [companionRoot] }), submitJob: async (request: any) => { expect(request.kind).toBe("media.companion_clip"); return { id: `finish-${id}`, state: "done", result: { ok: true, reasons: [], seconds: 3, files: [{ name: "clip.h264.mp4", bytes: 10 }], av1: false } }; } } as never);
      const started = await request(`companions/${id}/states/idle/generate`, adult, "POST", { count: 1 }); expect(started.status).toBe(202); const { job } = await started.json() as { job: string };
      let progress: any;
      for (let i = 0; i < 200; i++) { progress = await (await request(`companions/${id}/states/jobs/run/${job}`, adult)).json(); if (progress.state === "done" || progress.state === "failed") break; await new Promise((resolve) => setTimeout(resolve, 5)); }
      expect(progress.state).toBe(expectedState); expect(sent).toHaveLength(Math.min(cancelCount + 1, 2)); if (cancelCount === 1 && expectedState === "done") expect(sent[0]?.seed).not.toBe(sent[1]?.seed);
      if (expectedState === "failed") expect(progress.error).toBe("The video engine stopped this clip. Try again.");
      submitted.push(...sent);
    };
    const onceId = await prepare("Retry once"); await runScenario(onceId, 1, "done");
    const twiceId = await prepare("Retry twice"); await runScenario(twiceId, 2, "failed");

    const stopId = await prepare("Stop during retry wait"); __setTakeRetryWaitMsForTests(30_000); let videoNumber = 0;
    __setVideosFetchForTests((async (input, init) => { const url = new URL(String(input)), method = init?.method ?? "GET"; if (url.pathname === "/v1/videos/generations" && method === "POST") { videoNumber++; return Response.json({ job: `stop-retry-${videoNumber}` }, { status: 202 }); } if (url.pathname.endsWith("/stop-retry-1") && method === "GET") return Response.json({ job: "stop-retry-1", state: "cancelled", progress: 21, data: [] }); if (url.pathname.endsWith("/stop-retry-1") && method === "DELETE") return new Response(null, { status: 204 }); return new Response("Not found", { status: 404 }); }) as typeof fetch);
    const started = await request(`companions/${stopId}/states/idle/generate`, adult, "POST", { count: 1 }); const { job } = await started.json() as { job: string };
    let progress: any;
    for (let i = 0; i < 100; i++) { progress = await (await request(`companions/${stopId}/states/jobs/run/${job}`, adult)).json(); if (progress.label === "Waiting for memory, then trying again") break; await new Promise((resolve) => setTimeout(resolve, 5)); }
    expect(progress.label).toBe("Waiting for memory, then trying again"); expect((await request(`companions/${stopId}/states/jobs/run/${job}`, adult, "DELETE")).status).toBe(204);
    for (let i = 0; i < 100; i++) { progress = await (await request(`companions/${stopId}/states/jobs/run/${job}`, adult)).json(); if (progress.state === "cancelled") break; await new Promise((resolve) => setTimeout(resolve, 5)); }
    expect(progress.state).toBe("cancelled"); expect(videoNumber).toBe(1); expect(submitted).toHaveLength(4);
  });

  test("refuses minor, unapproved sheet and unavailable video engine before submitting", async () => {
    const adult = addPerson("person-state-gate", "adult"), child = addPerson("person-state-gate-child", "child"), created = createHouseholdCompanion({ ...fixture(), display_name: "Generation gates" }, { display_name: "Author", person_id: "person-state-gate" }); if (!created.ok) throw new Error(created.error); const id = created.value.id;
    __setVideoStatusForTests(readyVideoStatusForTests()); let calls = 0; __setVideosFetchForTests((async () => { calls++; return new Response("unexpected", { status: 500 }); }) as unknown as typeof fetch);
    expect((await request(`companions/${id}/states/idle/generate`, child, "POST", { count: 1 })).status).toBe(403);
    expect((await request(`companions/${id}/states/idle/generate`, adult, "POST", { count: 1 })).status).toBe(409);
    __setVideoStatusForTests(null);
    const restBytes = await transparentPng();
    const rest = addVersion(id, restBytes, { source: "upload", label: "rest", width: 1024, height: 1024, from: null }, restBytes); setRest(id, rest.id); updateSheet(id, { views: { left: null, right: null, mouth: null }, card: { text: "A red fox", species: "fox", colours: ["#CC3322"] }, key: "#00FF00", state: "needs_review", approved_by: null, approved_at: null }); approveSheet(id, "Author");
    expect((await request(`companions/${id}/states/idle/generate`, adult, "POST", { count: 1 })).status).toBe(503); expect(calls).toBe(0);
    __setVideoStatusForTests(readyVideoStatusForTests()); updateSheet(id, { views: { left: null, right: null, mouth: null }, card: { text: "a naked child character", species: "fox", colours: ["#CC3322"] }, key: "#00FF00", state: "approved", approved_by: "Author", approved_at: now });
    const refused = await request(`companions/${id}/states/idle/generate`, adult, "POST", { count: 1 }); expect(refused.status).toBe(422); expect((await refused.json() as { error: string }).error).toContain("never allowed"); expect(calls).toBe(0);
    updateSheet(id, { views: { left: null, right: null, mouth: null }, card: { text: "A red fox", species: "fox", colours: ["#CC3322"] }, key: "#00FF00", state: "approved", approved_by: "Author", approved_at: now });
    __setVideoStatusForTests(readyVideoStatusForTests({ quickMissing: true }));
    const quickMissing = await request(`companions/${id}/states/idle/generate`, adult, "POST", { count: 1 }); expect(quickMissing.status).toBe(503); expect((await quickMissing.json() as { error: string }).error).toContain("standard video model"); expect(calls).toBe(0);
  });

  test("blocks video start without a Stack original before calling the Stack", async () => {
    const adult = addPerson("person-state-no-original", "adult"), created = createHouseholdCompanion({ ...fixture(), display_name: "Upload only rest" }, { display_name: "Author", person_id: "person-state-no-original" }); if (!created.ok) throw new Error(created.error); const id = created.value.id;
    const rest = addVersion(id, await transparentPng(), { source: "upload", label: "rest", width: 1024, height: 1024, from: null }); setRest(id, rest.id); updateSheet(id, { views: { left: null, right: null, mouth: null }, card: { text: "A red fox", species: "fox", colours: ["#CC3322"] }, key: "#00FF00", state: "needs_review", approved_by: null, approved_at: null }); approveSheet(id, "Author");
    let calls = 0; __setVideosFetchForTests((async () => { calls++; return new Response("unexpected", { status: 500 }); }) as unknown as typeof fetch);
    const response = await request(`companions/${id}/states/idle/generate`, adult, "POST", { count: 1 });
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: 'The video model can only start from a picture the picture model made. Use "Change it" on this picture to make a version with the picture model, then pick that one as the starting picture.', code: "no_original" }); expect(calls).toBe(0);
    const look = await (await request(`companions/${id}/look`, adult)).json() as { start_ready: boolean; start_reason?: string }; expect(look.start_ready).toBe(false); expect(look.start_reason).toContain("Use \"Change it\"");
  });

  test("keeps one companion run active and cancels its live Stack video job", async () => {
    const adult = addPerson("person-state-cancel", "adult"), created = createHouseholdCompanion({ ...fixture(), display_name: "Cancelable character" }, { display_name: "Author", person_id: "person-state-cancel" }); if (!created.ok) throw new Error(created.error); const id = created.value.id;
    const restBytes = await transparentPng();
    const rest = addVersion(id, restBytes, { source: "upload", label: "rest", width: 1024, height: 1024, from: null }, restBytes); setRest(id, rest.id); updateSheet(id, { views: { left: null, right: null, mouth: null }, card: { text: "A red fox", species: "fox", colours: ["#CC3322"] }, key: "#00FF00", state: "needs_review", approved_by: null, approved_at: null }); approveSheet(id, "Author");
    __setVideoStatusForTests(readyVideoStatusForTests()); let sawPoll!: () => void; const pollStarted = new Promise<void>((resolve) => { sawPoll = resolve; }); let cancelled = 0;
    __setVideosFetchForTests((async (input: string | URL | Request, init?: RequestInit) => { const url = new URL(String(input)), method = init?.method ?? "GET"; if (url.pathname === "/v1/videos/generations" && method === "POST") return Response.json({ job: "video-live" }, { status: 202 }); if (url.pathname.endsWith("/video-live") && method === "GET") { sawPoll(); return Response.json({ job: "video-live", state: "running", progress: 20, data: [] }); } if (url.pathname.endsWith("/video-live") && method === "DELETE") { cancelled++; return new Response(null, { status: 204 }); } return new Response("Not found", { status: 404 }); }) as unknown as typeof fetch);
    const started = await request(`companions/${id}/states/idle/generate`, adult, "POST", { count: 1 }); expect(started.status).toBe(202); const { job } = await started.json() as { job: string }; await pollStarted;
    expect((await request(`companions/${id}/states/idle/generate`, adult, "POST", { count: 1 })).status).toBe(409);
    const states = await (await request(`companions/${id}/states`, adult)).json() as any; expect(states.run.job).toBe(job); expect(states.states.find((row: any) => row.id === "idle").busy).toBe(true);
    expect((await request(`companions/${id}/states/jobs/run/${job}`, adult, "DELETE")).status).toBe(204); expect(cancelled).toBe(1);
    expect((await (await request(`companions/${id}/states/jobs/run/${job}`, adult)).json() as { state: string }).state).toBe("cancelled");
  });

  test("approval requires force and idle first, edits only the draft, and idle removal clears every draft approval", async () => {
    const adult = addPerson("person-state-approve", "adult"), created = createHouseholdCompanion({ ...fixture(), display_name: "Approval flow" }, { display_name: "Author", person_id: "person-state-approve" }); if (!created.ok) throw new Error(created.error); const id = created.value.id;
    const rest = addVersion(id, new Uint8Array([1]), { source: "upload", label: "rest", width: 1024, height: 1024, from: null }); setRest(id, rest.id); updateSheet(id, { views: { left: null, right: null, mouth: null }, card: { text: "fox", species: "fox", colours: ["#CC3322"] }, key: "#00FF00", state: "needs_review", approved_by: null, approved_at: null }); approveSheet(id, "Author");
    const idle = addTake(id, "idle", { source: "upload", label: "idle" }), thinking = addTake(id, "thinking", { source: "upload", label: "thinking" });
    const report = (ok: boolean, reasons: string[]) => ({ ok, reasons, seconds: 3, bytes: { h264: 4, av1: null }, colour_distance: 1, area_ratio: 1, loop_gap: 0, opaque_share: { min: .5, max: .8 } });
    const all = readStates(id); all.states.idle!.takes[0]!.report = report(false, ["The loop does not close cleanly."]); all.states.thinking!.takes[0]!.report = report(true, []); saveStates(id, all);
    for (const [state, take] of [["idle", idle], ["thinking", thinking]] as const) { const h264 = takePath(id, state, take.id, "clip.h264.mp4")!, still = takePath(id, state, take.id, "still.png")!; mkdirSync(join(h264, ".."), { recursive: true }); writeFileSync(h264, "h264"); writeFileSync(still, "png"); }
    const idlePath = `companions/${id}/states/idle/approve`;
    const needsForce = await request(idlePath, adult, "PUT", { take_id: idle.id }); expect(needsForce.status).toBe(409); expect(await needsForce.json()).toMatchObject({ code: "needs_force", error: "This clip missed a quality check: The loop does not close cleanly. Approve it anyway?" });
    const beforeIdle = await request(`companions/${id}/states/thinking/approve`, adult, "PUT", { take_id: thinking.id }); expect(beforeIdle.status).toBe(409); expect((await beforeIdle.json() as { error: string }).error).toBe("Approve the idle clip first.");
    expect((await request(idlePath, adult, "PUT", { take_id: idle.id, force: true })).status).toBe(200);
    expect((await request(`companions/${id}/states/thinking/approve`, adult, "PUT", { take_id: thinking.id })).status).toBe(200);
    expect(getHouseholdCompanion(id)?.companion?.animation).toBeUndefined();
    expect((await request(`companions/${id}/states/thinking/approve`, adult, "DELETE")).status).toBe(200);
    expect(getHouseholdCompanion(id)?.companion?.animation).toBeUndefined();
    const removedIdle = await request(idlePath, adult, "DELETE"); expect(removedIdle.status).toBe(200); expect(await removedIdle.json()).toMatchObject({ note: "Without the idle clip the others cannot play, so their approvals were removed too." });
    expect(getHouseholdCompanion(id)?.companion?.animation).toBeUndefined(); expect(Object.values(readStates(id).states).every((state) => !state?.approved)).toBe(true);
  });

  test("appearance backfills published live animation and Publish checks then swaps the approved draft", async () => {
    const author = addPerson("person-publish", "adult"), made = createHouseholdCompanion({ ...fixture(), display_name: "Publish test" }, { display_name: "Author", person_id: "person-publish" }); if (!made.ok) throw new Error(made.error); const id = made.value.id;
    const png = await transparentPng(), rest = addVersion(id, png, { source: "upload", label: "rest", width: 1024, height: 1024, from: null }); setRest(id, rest.id); updateSheet(id, { views: { left: null, right: null, mouth: null }, card: { text: "fox", species: "fox", colours: ["#CC3322"] }, key: "#00FF00", state: "needs_review", approved_by: null, approved_at: null }); approveSheet(id, "Author");
    const idle = addTake(id, "idle", { source: "upload", label: "idle" }), report = { ok: true, reasons: [], seconds: 3, bytes: { h264: 4, av1: null }, colour_distance: 1, area_ratio: 1, loop_gap: 0, opaque_share: { min: .5, max: .8 } }, states = readStates(id); states.states.idle!.takes[0]!.report = report; saveStates(id, states); mkdirSync(join(takePath(id, "idle", idle.id, "clip.h264.mp4")!, ".."), { recursive: true }); writeFileSync(takePath(id, "idle", idle.id, "clip.h264.mp4")!, "clip"); writeFileSync(takePath(id, "idle", idle.id, "still.png")!, Buffer.from(png));
    const oldAnimation = { kind: "video" as const, spec_version: media.version, key: "#00FF00", states: { idle: { h264: "old.h264.mp4", still: "old.png", loop: true } } }; setHouseholdCompanionAnimation(id, oldAnimation);
    const seedState = readStates(id); seedState.states.idle!.approved = idle.id; saveStates(id, seedState);
    const backed = await request(`companions/${id}/appearance`, author); expect(await backed.json()).toMatchObject({ has_changes: false, published: { states: { idle: idle.id } } });
    const changedTake = addTake(id, "idle", { source: "upload", label: "replacement" }), changed = readStates(id); changed.states.idle!.takes.find((row) => row.id === changedTake.id)!.report = report; saveStates(id, changed); mkdirSync(join(takePath(id, "idle", changedTake.id, "still.png")!, ".."), { recursive: true }); writeFileSync(takePath(id, "idle", changedTake.id, "clip.h264.mp4")!, "clip2"); writeFileSync(takePath(id, "idle", changedTake.id, "still.png")!, Buffer.from(png));
    const approved = await request(`companions/${id}/states/idle/approve`, author, "PUT", { take_id: changedTake.id }); expect(approved.status).toBe(200);
    __setKeyframesForTests(async () => [new Uint8Array([9])]); __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true, verdict: { people_count: 0, apparent_min_age_estimate: null, label: "none", is_nude_or_sexual: false, confidence: 1 } })));
    const pub = await request(`companions/${id}/appearance/publish`, author, "POST"); expect(pub.status).toBe(200); expect(getHouseholdCompanion(id)?.companion?.animation?.states).toHaveProperty("idle"); expect(readStates(id).published?.states.idle).toBe(changedTake.id);
  });

  test("Publish withholds an unrunnable adult check and leaves the live animation untouched", async () => {
    const author = addPerson("person-publish-block", "adult"), made = createHouseholdCompanion({ ...fixture(), display_name: "Blocked publish" }, { display_name: "Author", person_id: "person-publish-block" }); if (!made.ok) throw new Error(made.error); const id = made.value.id;
    const png = await transparentPng(), rest = addVersion(id, png, { source: "upload", label: "rest", width: 1024, height: 1024, from: null }); setRest(id, rest.id); updateSheet(id, { views: { left: null, right: null, mouth: null }, card: { text: "fox", species: "fox", colours: ["#CC3322"] }, key: "#00FF00", state: "needs_review", approved_by: null, approved_at: null }); approveSheet(id, "Author");
    const take = addTake(id, "idle", { source: "upload", label: "idle" }), all = readStates(id); all.states.idle!.approved = take.id; all.states.idle!.takes[0]!.report = { ok: true, reasons: [], seconds: 3, bytes: { h264: 4, av1: null }, colour_distance: 1, area_ratio: 1, loop_gap: 0, opaque_share: { min: .5, max: .8 } }; saveStates(id, all); mkdirSync(join(takePath(id, "idle", take.id, "clip.h264.mp4")!, ".."), { recursive: true }); writeFileSync(takePath(id, "idle", take.id, "clip.h264.mp4")!, "clip"); writeFileSync(takePath(id, "idle", take.id, "still.png")!, Buffer.from(png));
    setHouseholdCompanionAnimation(id, { kind: "video", spec_version: media.version, key: "#00FF00", states: { idle: { h264: "old.h264.mp4", still: "old.png", loop: true } } });
    // The first read saves the backfilled published record; then the draft changes to a second take.
    expect((await request(`companions/${id}/appearance`, author)).status).toBe(200);
    const second = addTake(id, "idle", { source: "upload", label: "second" }), moved = readStates(id); moved.states.idle!.takes.find((row) => row.id === second.id)!.report = moved.states.idle!.takes[0]!.report; moved.states.idle!.approved = second.id; saveStates(id, moved); mkdirSync(join(takePath(id, "idle", second.id, "clip.h264.mp4")!, ".."), { recursive: true }); writeFileSync(takePath(id, "idle", second.id, "clip.h264.mp4")!, "clip2"); writeFileSync(takePath(id, "idle", second.id, "still.png")!, Buffer.from(png));
    __setKeyframesForTests(async () => [new Uint8Array([3])]); __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: false, why: "unavailable" })));
    const blocked = await request(`companions/${id}/appearance/publish`, author, "POST"); expect(blocked.status).toBe(422); expect(getHouseholdCompanion(id)?.companion?.animation?.states.idle?.h264).toBe("old.h264.mp4"); expect(readStates(id).checks && Object.values(readStates(id).checks!).every((check) => !check.age)).toBe(true);
  });


  test("Publish is blocked by a withheld age check and leaves the live animation untouched", async () => {
    const f = await publishFixture("person-pub-withheld", "adult", "adult");
    __setAgeCheckRunnerForTests(async (images) => images.map(() => AGE_WITHHELD));
    const blocked = await request(`companions/${f.id}/appearance/publish`, f.token, "POST");
    expect(blocked.status).toBe(422); expect(((await blocked.json()) as { reasons: string[] }).reasons.length).toBeGreaterThan(0);
    expect(getHouseholdCompanion(f.id)?.companion?.animation?.states.idle?.h264).toBe("old.h264.mp4");
    expect(existsSync(join(f.live, "old.h264.mp4"))).toBe(true); expect(existsSync(join(f.live, "..", "animation.next"))).toBe(false);
    expect(readStates(f.id).published?.states.idle).toBe(f.first);
  });

  test("an all-ages companion's art also gets the child-safety question; a check that did not run is never cached", async () => {
    const f = await publishFixture("person-pub-child", "adult", "all");
    let ageCalls = 0, childCalls = 0, childOk = false;
    __setAgeCheckRunnerForTests(async (images) => { ageCalls += images.length; return images.map(() => AGE_OK); });
    __setChildSafetyRunnerForTests(async (images) => { childCalls += images.length; return images.map(() => childOk ? CHILD_OK : { ok: false as const, why: "unavailable" as const }); });
    const blocked = await request(`companions/${f.id}/appearance/publish`, f.token, "POST");
    expect(blocked.status).toBe(422); expect(childCalls).toBeGreaterThan(0);
    expect(Object.values(readStates(f.id).checks ?? {}).every((entry) => !entry.child)).toBe(true);
    expect(getHouseholdCompanion(f.id)?.companion?.animation?.states.idle?.h264).toBe("old.h264.mp4");
    const agesBefore = ageCalls; childOk = true;
    const published = await request(`companions/${f.id}/appearance/publish`, f.token, "POST");
    expect(published.status).toBe(200); expect(ageCalls).toBe(agesBefore);
    expect(getHouseholdCompanion(f.id)?.companion?.animation?.states.idle?.h264).toBe("idle.h264.mp4"); expect(readStates(f.id).published?.states.idle).toBe(f.second);
  });

  test("teen and adult companions are decided on their own band without the child-safety question", async () => {
    for (const audience of ["teen", "adult"] as const) {
      const f = await publishFixture(`person-pub-${audience}`, "adult", audience); let childCalls = 0;
      __setAgeCheckRunnerForTests(async (images) => images.map(() => AGE_OK)); __setChildSafetyRunnerForTests(async (images) => { childCalls += images.length; return images.map(() => CHILD_OK); });
      expect((await request(`companions/${f.id}/appearance/publish`, f.token, "POST")).status).toBe(200); expect(childCalls).toBe(0);
    }
  });

  test("widening the audience re-checks the live set; narrowing and a companion with no live animation are unchecked", async () => {
    const f = await publishFixture("person-pub-widen", "admin", "adult"); let calls = 0;
    __setAgeCheckRunnerForTests(async (images) => { calls += images.length; return images.map(() => AGE_WITHHELD); });
    const refused = await request(`companions/${f.id}/audience`, f.token, "PUT", { audience: "teen" });
    expect(refused.status).toBe(422); expect(calls).toBeGreaterThan(0); expect(getHouseholdCompanion(f.id)?.companion?.audience).toBe("adult");
    // The raw verdict for these exact bytes is cached (and would not change in production), so the test clears it before the checker answers differently.
    const cached = readStates(f.id); delete cached.checks; saveStates(f.id, cached);
    __setAgeCheckRunnerForTests(async (images) => { calls += images.length; return images.map(() => AGE_OK); });
    expect((await request(`companions/${f.id}/audience`, f.token, "PUT", { audience: "teen" })).status).toBe(200); expect(getHouseholdCompanion(f.id)?.companion?.audience).toBe("teen");
    calls = 0; expect((await request(`companions/${f.id}/audience`, f.token, "PUT", { audience: "adult" })).status).toBe(200); expect(calls).toBe(0);
    const bare = createHouseholdCompanion({ ...fixture(), display_name: "No art yet" }, { display_name: "Author", person_id: "person-pub-widen" }); if (!bare.ok) throw new Error(bare.error);
    expect((await request(`companions/${bare.value.id}/audience`, f.token, "PUT", { audience: "teen" })).status).toBe(200); expect(calls).toBe(0);
  });

  test("changing the rest picture clears the draft approvals but leaves the live animation until the next Publish", async () => {
    const f = await publishFixture("person-pub-rest", "adult", "adult");
    const other = addVersion(f.id, f.png, { source: "upload", label: "other", width: 1024, height: 1024, from: null });
    const changed = await request(`companions/${f.id}/look/rest`, f.token, "PUT", { version_id: other.id }); expect(changed.status).toBe(200);
    expect(readStates(f.id).states.idle?.approved ?? null).toBeNull();
    expect(getHouseholdCompanion(f.id)?.companion?.animation?.states.idle?.h264).toBe("old.h264.mp4"); expect(existsSync(join(f.live, "old.h264.mp4"))).toBe(true);
    expect(readStates(f.id).published?.states.idle).toBe(f.first);
  });


  test("Publish aborts and touches nothing when the approvals change while the checks run", async () => {
    const f = await publishFixture("person-pub-race", "adult", "adult");
    __setAgeCheckRunnerForTests(async (images) => { const moved = readStates(f.id); moved.states.idle!.approved = f.first; saveStates(f.id, moved); return images.map(() => AGE_OK); });
    const aborted = await request(`companions/${f.id}/appearance/publish`, f.token, "POST");
    expect(aborted.status).toBe(409); expect(getHouseholdCompanion(f.id)?.companion?.animation?.states.idle?.h264).toBe("old.h264.mp4"); expect(existsSync(join(f.live, "..", "animation.next"))).toBe(false);
    expect(readStates(f.id).states.idle?.approved).toBe(f.first);
  });

  test("Publish aborts when the audience changes while the checks run", async () => {
    const f = await publishFixture("person-pub-audience-race", "adult", "adult");
    __setAgeCheckRunnerForTests(async (images) => { setHouseholdCompanionAudience(f.id, "teen", { display_name: "Author" }); return images.map(() => AGE_OK); });
    const aborted = await request(`companions/${f.id}/appearance/publish`, f.token, "POST");
    expect(aborted.status).toBe(409); expect(getHouseholdCompanion(f.id)?.companion?.animation?.states.idle?.h264).toBe("old.h264.mp4");
  });

  test("a rest picture change on a companion that was never backfilled still reads as a portrait change", async () => {
    const f = await publishFixture("person-pub-legacy-rest", "adult", "adult", false);
    const other = addVersion(f.id, f.png, { source: "upload", label: "other", width: 1024, height: 1024, from: null });
    expect((await request(`companions/${f.id}/look/rest`, f.token, "PUT", { version_id: other.id })).status).toBe(200);
    const status = (await (await request(`companions/${f.id}/appearance`, f.token)).json()) as { portrait_changed: boolean; has_changes: boolean };
    expect(status.portrait_changed).toBe(true); expect(status.has_changes).toBe(true);
  });

  test("children, teens, non-author adults and bundled companions cannot use state routes", async () => {
    const author = addPerson("person-state-owner", "adult"), other = addPerson("person-state-other", "adult"), child = addPerson("person-state-child", "child"), teen = addPerson("person-state-teen", "teen");
    const created = createHouseholdCompanion({ ...fixture(), display_name: "State access" }, { display_name: "Author", person_id: "person-state-owner" }); if (!created.ok) throw new Error(created.error);
    for (const token of [other, child, teen]) {
      for (const [path, method, body] of [[`companions/${created.value.id}/states`, "GET", undefined], [`companions/${created.value.id}/states/idle/motion`, "PUT", { motion: "wave" }], [`companions/${created.value.id}/states/idle/approve`, "PUT", { take_id: "take-1" }], [`companions/${created.value.id}/states/idle/take-1`, "DELETE", undefined], [`companions/${created.value.id}/states/idle/take-1/clip.h264.mp4`, "GET", undefined]] as const) expect((await request(path, token, method, body)).status).toBe(403);
    }
    for (const token of [other, child, teen]) {
      const form = new FormData(); form.append("video", new File([new Uint8Array([0, 0, 0, 24])], "clip.mp4", { type: "video/mp4" }));
      expect((await app.request(`http://localhost/api/companions/${created.value.id}/states/idle/upload`, { method: "POST", headers: { cookie: `session=${token}` }, body: form })).status).toBe(403);
    }
    expect((await request("companions/rivet/states", author)).status).toBe(403);
  });

  test("copy prompt routes are editor-only, include complete packs, and reject unknown states", async () => {
    const author = addPerson("person-prompt-owner", "adult"), other = addPerson("person-prompt-other", "adult"), child = addPerson("person-prompt-child", "child"), teen = addPerson("person-prompt-teen", "teen");
    const created = createHouseholdCompanion({ ...fixture(), display_name: "Prompt companion", look_prompt: "A blue bird" }, { display_name: "Author", person_id: "person-prompt-owner" });
    if (!created.ok) throw new Error(created.error);
    const picture = await request(`companions/${created.value.id}/look/prompt`, author);
    expect(picture.status).toBe(200); expect(await picture.json()).toMatchObject({ title: "Character picture for Prompt companion", text: expect.stringContaining("Size:") });
    const clip = await request(`companions/${created.value.id}/states/idle/prompt`, author);
    expect(clip.status).toBe(200); expect(await clip.json()).toMatchObject({ title: "Character clip: Idle for Prompt companion", text: expect.stringContaining("Start from: the starting picture you pick in the Look tab") });
    for (const token of [other, child, teen]) {
      expect((await request(`companions/${created.value.id}/look/prompt`, token)).status).toBe(403);
      expect((await request(`companions/${created.value.id}/states/idle/prompt`, token)).status).toBe(403);
    }
    expect((await request("companions/rivet/look/prompt", author)).status).toBe(403);
    expect((await request(`companions/${created.value.id}/states/dancing/prompt`, author)).status).toBe(404);
  });

  test("avatar returns only ready usable active animation and caches its manifest version", async () => {
    const adult = addPerson("person-avatar-adult", "adult"), child = addPerson("person-avatar-child", "child"), admin = addPerson("person-avatar-admin", "admin");
    const animation = { kind: "video" as const, spec_version: 1, key: "#00FF00", states: { idle: { h264: "idle.h264.mp4", still: "idle.png", loop: true }, listening: { h264: "listening.h264.mp4", av1: "listening.av1.mp4", still: "listening.png", loop: false } } };
    const ready = createHouseholdCompanion({ ...fixture(), display_name: "Avatar fox" }, { display_name: "Author", person_id: "person-avatar-adult" }); if (!ready.ok) throw new Error(ready.error);
    setHouseholdCompanionAudience(ready.value.id, "all", { display_name: "Admin" }); setHouseholdCompanionStatus(ready.value.id, "ready"); setHouseholdCompanionAnimation(ready.value.id, animation); __reloadPersonasForTests();
    const animationFolder = join(householdCompanionFolder(ready.value.id)!, "animation"); mkdirSync(animationFolder, { recursive: true });
    writeFileSync(join(animationFolder, "idle.h264.mp4"), "0123456789"); writeFileSync(join(animationFolder, "idle.png"), "png");
    const picked = await request(`companions/${ready.value.id}/default`, adult, "PUT"); expect(picked.status).toBe(200);
    const response = await request("companions/avatar", adult); expect(response.status).toBe(200);
    const body = await response.json() as { avatar: { id: string; name: string; key: string; version: string; states: Record<string, { loop: boolean; urls: { h264: string; av1: string | null; still: string } }> } | null };
    expect(body.avatar).toMatchObject({ id: ready.value.id, name: "Avatar fox", key: "#00FF00", version: expect.stringMatching(/^[a-f0-9]{12}$/) });
    expect(body.avatar?.states.idle?.urls.av1).toBeNull();
    expect(body.avatar?.states.listening?.urls.av1).toBe(`/api/companions/${ready.value.id}/animation/listening.av1.mp4`);
    const explicit = await request(`companions/avatar?companion=${encodeURIComponent(ready.value.id)}`, adult);
    expect((await explicit.json() as { avatar: { id: string } | null }).avatar?.id).toBe(ready.value.id);
    const etag = response.headers.get("etag")!;
    expect(response.headers.get("cache-control")).toBe("private, max-age=0, must-revalidate");
    const cached = await app.request("http://localhost/api/companions/avatar", { headers: { cookie: `session=${adult}`, "if-none-match": etag } }); expect(cached.status).toBe(304);
    const childPick = await request(`companions/${ready.value.id}/default`, child, "PUT"); expect(childPick.status).toBe(200);
    const childAvatar = await request("companions/avatar", child); expect((await childAvatar.json() as { avatar: { id: string } | null }).avatar?.id).toBe(ready.value.id);

    const adultOnly = createHouseholdCompanion({ ...fixture(), display_name: "Adult avatar" }, { display_name: "Author", person_id: "person-avatar-adult" }); if (!adultOnly.ok) throw new Error(adultOnly.error);
    setHouseholdCompanionStatus(adultOnly.value.id, "ready"); setHouseholdCompanionAnimation(adultOnly.value.id, animation); __reloadPersonasForTests();
    db.delete(settingsValues).where(and(eq(settingsValues.scope, "person:person-avatar-child"), eq(settingsValues.key, "persona.active_id"))).run();
    db.insert(settingsValues).values({ scope: "person:person-avatar-child", key: "persona.active_id", value: JSON.stringify(adultOnly.value.id), hlc: "3:0:test", source: "user", updatedAt: now }).run(); __resetSettingsCacheForTests();
    expect((await (await request("companions/avatar", child)).json() as { avatar: unknown }).avatar).toBeNull();
    const refusedExplicit = await request(`companions/avatar?companion=${encodeURIComponent(adultOnly.value.id)}`, child);
    expect((await refusedExplicit.json() as { avatar: unknown }).avatar).toBeNull();

    const draft = createHouseholdCompanion({ ...fixture(), display_name: "Draft avatar" }, { display_name: "Author", person_id: "person-avatar-adult" }); if (!draft.ok) throw new Error(draft.error);
    setHouseholdCompanionAnimation(draft.value.id, animation);
    db.delete(settingsValues).where(and(eq(settingsValues.scope, "person:person-avatar-adult"), eq(settingsValues.key, "persona.active_id"))).run();
    db.insert(settingsValues).values({ scope: "person:person-avatar-adult", key: "persona.active_id", value: JSON.stringify(draft.value.id), hlc: "2:0:test", source: "user", updatedAt: now }).run();
    expect((await (await request("companions/avatar", adult)).json() as { avatar: unknown }).avatar).toBeNull();
    const bundled = await request("companions/avatar", admin); expect((await bundled.json() as { avatar: { id: string } | null }).avatar?.id).toBe("tessa");
  });

  test("Tessa's four still-only animation states return null video URLs and only listed stills are served", async () => {
    const child = addPerson("person-tessa-avatar-child", "child");
    const response = await request("companions/avatar", child);
    expect(response.status).toBe(200);
    const body = await response.json() as { avatar: { id: string; states: Record<string, { loop: boolean; urls: { h264: string | null; av1: string | null; still: string } }> } | null };
    expect(body.avatar?.id).toBe("tessa");
    expect(Object.keys(body.avatar!.states).sort()).toEqual(["idle", "listening", "speaking", "thinking"]);
    for (const state of Object.values(body.avatar!.states)) {
      expect(state.urls.h264).toBeNull();
      expect(state.urls.av1).toBeNull();
      expect((await request(state.urls.still.replace("/api/", ""), child)).status).toBe(200);
    }
    expect((await request("companions/tessa/animation/unlisted.png", child)).status).toBe(404);
  });

  test("animation files use companion access, manifest allowlists, validators and byte ranges", async () => {
    const author = addPerson("person-animation-author", "adult"), other = addPerson("person-animation-other", "adult"), child = addPerson("person-animation-child", "child");
    const animation = { kind: "video" as const, spec_version: 1, key: "#00FF00", states: { idle: { h264: "idle.h264.mp4", still: "idle.png", loop: true } } };
    const created = createHouseholdCompanion({ ...fixture(), display_name: "Animation access" }, { display_name: "Author", person_id: "person-animation-author" }); if (!created.ok) throw new Error(created.error);
    setHouseholdCompanionAnimation(created.value.id, animation);
    const folder = join(householdCompanionFolder(created.value.id)!, "animation"); mkdirSync(folder, { recursive: true }); writeFileSync(join(folder, "idle.h264.mp4"), "0123456789");
    const url = `companions/${created.value.id}/animation/idle.h264.mp4`;
    expect((await request(url, other)).status).toBe(404);
    expect((await request(url, child)).status).toBe(404);
    const editorRead = await request(url, author); expect(editorRead.status).toBe(200); expect(await editorRead.text()).toBe("0123456789");
    expect(editorRead.headers.get("cache-control")).toBe("private, max-age=0, must-revalidate");
    const etag = editorRead.headers.get("etag")!;
    const partial = await app.request(`http://localhost/api/${url}`, { headers: { cookie: `session=${author}`, range: "bytes=2-5" } });
    expect(partial.status).toBe(206); expect(await partial.text()).toBe("2345"); expect(partial.headers.get("content-range")).toBe("bytes 2-5/10"); expect(partial.headers.get("accept-ranges")).toBe("bytes");
    const unchanged = await app.request(`http://localhost/api/${url}`, { headers: { cookie: `session=${author}`, "if-none-match": etag } }); expect(unchanged.status).toBe(304);
    expect((await request(`companions/${created.value.id}/animation/unknown.h264.mp4`, author)).status).toBe(404);
    expect((await request(`companions/${created.value.id}/animation/..`, author)).status).toBe(404);

    const ready = createHouseholdCompanion({ ...fixture(), display_name: "Ready animation" }, { display_name: "Author", person_id: "person-animation-author" }); if (!ready.ok) throw new Error(ready.error);
    setHouseholdCompanionStatus(ready.value.id, "ready"); setHouseholdCompanionAnimation(ready.value.id, animation); __reloadPersonasForTests();
    const readyFolder = join(householdCompanionFolder(ready.value.id)!, "animation"); mkdirSync(readyFolder, { recursive: true }); writeFileSync(join(readyFolder, "idle.h264.mp4"), "abcdefghij");
    const readyUrl = `companions/${ready.value.id}/animation/idle.h264.mp4`;
    expect((await request(readyUrl, other)).status).toBe(200);
    expect((await request(readyUrl, child)).status).toBe(404);
  });

  test("COMPANION-ART-CHECK-01: an uploaded look picture is checked, and one that may show a minor in a sexual picture or cannot be checked is refused and not kept", async () => {
    const adult = addPerson("person-art-upload", "adult");
    const created = createHouseholdCompanion({ ...fixture(), display_name: "Checked upload" }, { display_name: "Author", person_id: "person-art-upload" });
    if (!created.ok) throw new Error(created.error);
    const path = `companions/${created.value.id}/look/upload`, png = await transparentPng();
    const verdict = (label: "adult" | "possibly_minor") => ({ ok: true as const, verdict: { people_count: 1, apparent_min_age_estimate: label === "adult" ? 30 : 15, label, is_nude_or_sexual: label === "possibly_minor", confidence: 1 } });
    __setAgeCheckRunnerForTests(async (images) => images.map(() => verdict("possibly_minor")));
    const minor = await upload(path, adult, png);
    expect(minor.status).toBe(422);
    expect(((await minor.json()) as { error: string }).error.length).toBeGreaterThan(10);
    // A verdict is kept per file, so each case needs its own picture.
    const second = new Uint8Array(await sharp({ create: { width: 512, height: 512, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: await sharp({ create: { width: 170, height: 170, channels: 4, background: { r: 40, g: 40, b: 220, alpha: 1 } } }).png().toBuffer(), left: 160, top: 160 }]).png().toBuffer());
    __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: false as const, why: "unavailable" as const })));
    expect((await upload(path, adult, second)).status).toBe(422);
    expect(((await (await request(`companions/${created.value.id}/look`, adult)).json()) as { versions: unknown[] }).versions).toHaveLength(0);
    __setAgeCheckRunnerForTests(async (images) => images.map(() => verdict("adult")));
    // A verdict is kept per file, so a different picture is needed to see the new answer.
    const other = new Uint8Array(await sharp({ create: { width: 512, height: 512, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: await sharp({ create: { width: 200, height: 160, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 1 } } }).png().toBuffer(), left: 150, top: 170 }]).png().toBuffer());
    expect((await upload(path, adult, other)).status).toBe(201);
  });
});

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { OpenAPIHono } from "@hono/zod-openapi";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { rmSync, mkdirSync, writeFileSync, existsSync, utimesSync, readFileSync } from "node:fs";
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
import { addTake, takePath, saveStates, readStates, bestTake, __resetCompanionStatesForTests, keyframePath, writeKeyframe } from "@/lib/companionStates";
import { __setStackClientForTests } from "@/lib/stackEngine";
import { __setImageToolsForTests } from "@/lib/imageEdit";
import type { StackImageToolsStatus } from "@/lib/stack/client";
import { addVersion, approveSheet, setRest, updateSheet, readLook } from "@/lib/companionLook";
import { readKeyframeMeta } from "@/lib/companionStates";
import { getHouseholdCompanion } from "@/lib/householdCompanions";
import { __setVideosFetchForTests } from "@/lib/videos/stack";
import { __setVideoStatusForTests, readyVideoStatusForTests } from "@/lib/videos/ready";
import { __clearCompanionTakeRunsForTests, __setTakeRetryWaitMsForTests } from "@/lib/companionTakes";
import media from "@maipai/spec/vocab/companion-media.json";
import { __setAgeCheckRunnerForTests, __resetAgeCheckForTests } from "@/lib/pictures/ageCheck";
import { __setChildSafetyRunnerForTests } from "@/lib/pictures/laneGate";
import { __setKeyframesForTests } from "@/lib/pictures/keyframes";
import { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
import { sweepAbandonedDrafts } from "@/lib/sweepAbandonedDrafts";
import { __setBackstoryCompleteForTests } from "@/routes/companions";
import { mock } from "bun:test";
import { COMPANION_PERSONALITIES } from "@/lib/companionPersonality";

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
  return new Uint8Array(await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: await sharp({ create: { width: 360, height: 360, channels: 4, background: { r: 0, g: 255, b: 0, alpha: 1 } } }).png().toBuffer(), left: 332, top: 332 }]).png().toBuffer());
}
async function clippedPng(edge: "bottom" | "none" = "bottom", colour: string = "red") {
  const top = edge === "bottom" ? 700 : 332, height = edge === "bottom" ? 324 : 360;
  const svg = Buffer.from(`<svg width="360" height="${height}"><rect x="0" y="0" width="360" height="${height}" fill="${colour}"/></svg>`);
  return new Uint8Array(await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: svg, left: 332, top }]).png().toBuffer());
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

beforeEach(() => { __setBackstoryCompleteForTests(null); resetDb(); rmSync(companionRoot, { recursive: true, force: true }); __reloadPersonasForTests(); __clearCompanionLookJobsForTests(); __clearCompanionTakeRunsForTests(); __resetCompanionStatesForTests(); __setPicturesFetchForTests(null); __setVideoStatusForTests(undefined); __setVideosFetchForTests(null); __setPictureStatusForTests(undefined); __setCharacterPictureCapabilityForTests(null); __setStackClientForTests(null); });
afterEach(() => { __setBackstoryCompleteForTests(null); __resetAgeCheckForTests(); __setChildSafetyRunnerForTests(null); __setKeyframesForTests(null); __setImageToolsForTests(undefined); resetDb(); rmSync(companionRoot, { recursive: true, force: true }); __reloadPersonasForTests(); __clearCompanionLookJobsForTests(); __clearCompanionTakeRunsForTests(); __resetCompanionStatesForTests(); __setPicturesFetchForTests(null); __setVideoStatusForTests(undefined); __setVideosFetchForTests(null); __setPictureStatusForTests(undefined); __setCharacterPictureCapabilityForTests(null); __setStackClientForTests(null); });

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

describe("companion look styles", () => {
  test("lists styles by age band before companion id routes and preserves look read styles", async () => {
    const adult = addPerson("look-styles-adult", "adult"), teen = addPerson("look-styles-teen", "teen"), child = addPerson("look-styles-child", "child");
    const styles = async (token: string) => (await request("companions/look-styles", token)).json() as Promise<{ styles: Array<{ id: string; label: string; custom: boolean }>; keep: { id: string; label: string } }>;
    const adultStyles = await styles(adult), teenStyles = await styles(teen);
    expect(adultStyles.styles).toHaveLength(6);
    expect(adultStyles.styles.at(-1)).toMatchObject({ id: "custom", label: "Custom", custom: true });
    expect(adultStyles.keep).toEqual({ id: "keep", label: "Keep as is" });
    expect(teenStyles.styles).toHaveLength(5);
    expect(teenStyles.styles.some((style) => style.id === "custom")).toBe(false);
    const childResult = await request("companions/look-styles", child);
    expect(childResult.status).toBe(403);
    expect(await childResult.json()).toEqual({ error: "Only teens and adults can make a companion." });

    const made = createHouseholdCompanion({ ...fixture(), display_name: "Style comparison" }, { display_name: "Adult", person_id: "look-styles-adult" });
    if (!made.ok) throw new Error(made.error);
    const look = await (await request(`companions/${made.value.id}/look`, adult)).json() as { styles: typeof adultStyles.styles; keep: typeof adultStyles.keep };
    expect(look.styles).toEqual(adultStyles.styles);
    expect(look.keep).toEqual(adultStyles.keep);
  });
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
  test("look upload reports clipped edges and look read keeps them per version", async () => {
    const adult = addPerson("clipped-upload-author", "adult"), made = createHouseholdCompanion({ ...fixture(), display_name: "Clipped upload" }, { display_name: "Author", person_id: "clipped-upload-author" }); if (!made.ok) throw new Error(made.error);
    __setAgeCheckRunnerForTests(async (images) => images.map(() => AGE_OK));
    __setImageToolsForTests({ state: "idle", phase: null, vision: true, models: { isnet: true, lama: true, esrgan: true }, limits: {}, operations: ["remove_background", "resize"], reason: null } satisfies StackImageToolsStatus);
    __setStackClientForTests({ imageEdit: async (form: FormData) => { const file = form.get("image") as File; return { kind: "done", png: new Uint8Array(await file.arrayBuffer()), item: { width: 1024, height: 1024 } }; } } as never);
    const cut = await upload(`companions/${made.value.id}/look/upload`, adult, await clippedPng("bottom"));
    expect(cut.status).toBe(201); const cutBody = await cut.json() as { id: string; clipped: string[] }; expect(cutBody.clipped).toContain("bottom");
    const centered = await upload(`companions/${made.value.id}/look/upload`, adult, await transparentPng());
    expect(centered.status).toBe(201); const centeredBody = await centered.json() as { id: string; clipped: string[] }; expect(centeredBody.clipped).toEqual([]);
    const read = await (await request(`companions/${made.value.id}/look`, adult)).json() as { versions: Array<{ id: string; clipped?: string[] }> };
    expect(read.versions.find((version) => version.id === cutBody.id)?.clipped).toContain("bottom");
    expect(read.versions.find((version) => version.id === centeredBody.id)?.clipped).toEqual([]);
  });

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
    const teenStyleCompanion = createHouseholdCompanion({ ...fixture(), display_name: "Teen style generation", look_prompt: "cartoon dragon" }, { display_name: "Teen author", person_id: "person-look-gen-teen" }); if (!teenStyleCompanion.ok) throw new Error(teenStyleCompanion.error);
    const teenCustom = await request(`companions/${teenStyleCompanion.value.id}/look/generate`, teen, "POST", { prompt: "cartoon dragon", style: "custom", custom_style: "friendly ink" });
    expect(teenCustom.status).toBe(422); expect(((await teenCustom.json()) as { error: string }).error).toContain("Pick another style");
    const adultCustom = await request(path, adult, "POST", { prompt: "red fox", style: "custom" }); expect(adultCustom.status).toBe(400);
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

  test("a teen upload withheld by the input screen is not submitted or saved for edit", async () => {
    const teen = addPerson("person-look-edit-teen-screen", "teen"), made = createHouseholdCompanion({ ...fixture(), display_name: "Teen edit screen", audience: "teen" }, { display_name: "Teen", person_id: "person-look-edit-teen-screen" });
    if (!made.ok) throw new Error(made.error);
    const source = addVersion(made.value.id, await transparentPng(), { source: "upload", label: "Uploaded", width: 1024, height: 1024, from: null, style: "keep" });
    __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { people_count: 1, apparent_min_age_estimate: 12, label: "child" as const, is_nude_or_sexual: true, confidence: 1 } })));
    __setPictureStatusForTests(readyStatusForTests()); let editCalls = 0;
    __setPicturesFetchForTests((async (_input, init) => { if (init?.method === "POST") editCalls++; return Response.json({ job: "should-not-submit" }, { status: 202 }); }) as typeof fetch);
    const beforeCount = readLook(made.value.id).versions.length;
    const response = await request(`companions/${made.value.id}/look/edit`, teen, "POST", { version_id: source.id, instruction: "Add a scarf" });
    expect(response.status).toBe(422); expect(((await response.json()) as { error: string }).error).toBe("I can't show that one. Want to try something different?");
    expect(editCalls).toBe(0); expect(readLook(made.value.id).versions).toHaveLength(beforeCount);
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
    expect(look.sheet).toMatchObject({ state: "approved", card: { text: "a red fox wearing a blue scarf" } }); expect(Object.keys(look.sheet.views)).toEqual(["left", "right", "mouth"]); expect(look.ready_for_video).toBe(true);
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
      if (url.endsWith("/v1/images/generations/sheet-fail-stack")) return Response.json({ job: "sheet-fail-stack", state: "failed", progress: 0, data: [] });
      return new Response("Not found", { status: 404 });
    }) as typeof fetch);
    const started = await request(`companions/${created.value.id}/look/sheet`, adult, "POST", {}), { job } = await started.json() as { job: string };
    const result = await request(`companions/${created.value.id}/look/jobs/${job}`, adult);
    expect(await result.json()).toMatchObject({ state: "failed", error: "The side view did not work. Try again." });
    expect((await (await request(`companions/${created.value.id}/look`, adult)).json() as { sheet: { views: { left: string | null }; state: string } }).sheet).toMatchObject({ views: { left: null }, state: "needs_review" });
  });
});

describe("companion backstory and Save routes", () => {
  test("backstory generation trims doubled model output, handles unavailable models, and enforces age and author gates", async () => {
    const author = addPerson("save-story-author", "adult"), child = addPerson("save-story-child", "child"), other = addPerson("save-story-other", "adult");
    const made = createHouseholdCompanion({ ...fixture(), display_name: "Story fox", backstory: "Original" }, { display_name: "Author", person_id: "save-story-author" }); if (!made.ok) throw new Error(made.error);
    let calls = 0; __setBackstoryCompleteForTests(mock(async () => { calls++; return { ok: true, value: { text: `${"A kind fox helps neighbors find their way home. ".repeat(15)}\n\nA kind fox helps neighbors find their way home.`, finish_reason: "stop", model: "test" } } as never; }) as never);
    const response = await request(`companions/${made.value.id}/backstory/generate`, author, "POST", {}), generated = await response.json() as { text: string };
    expect(response.status).toBe(200); expect(generated.text.length).toBeLessThanOrEqual(400); expect(calls).toBe(1); expect(getHouseholdCompanion(made.value.id)?.companion?.backstory).toBe("Original");
    __setBackstoryCompleteForTests(mock(async () => ({ ok: false, status: 503, code: "unavailable", error: "offline" })) as never);
    const unavailable = await request(`companions/${made.value.id}/backstory/generate`, author, "POST", {});
    expect(unavailable.status).toBe(503); expect(((await unavailable.json()) as { error: string }).error).toBe("The local chat model is unavailable. Try again when it is ready."); expect(getHouseholdCompanion(made.value.id)?.companion?.backstory).toBe("Original");
    expect((await request(`companions/${made.value.id}/backstory/generate`, child, "POST", {})).status).toBe(403);
    expect((await request(`companions/${made.value.id}/backstory/generate`, other, "POST", {})).status).toBe(403);
  });

  test("Save requires an approved starting picture and approved idle animation", async () => {
    const author = addPerson("save-gates-author", "adult"), made = createHouseholdCompanion({ ...fixture(), display_name: "Save gates" }, { display_name: "Author", person_id: "save-gates-author" }); if (!made.ok) throw new Error(made.error);
    let response = await request(`companions/${made.value.id}/save`, author, "POST", { voice_id: "voice-test", personality: "friendly" });
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ go_back_to: "look" });
    const png = await transparentPng(), version = addVersion(made.value.id, png, { source: "upload", label: "rest", width: 1024, height: 1024, from: null }); setRest(made.value.id, version.id); updateSheet(made.value.id, { views: { left: null, right: null, mouth: null }, card: { text: "fox", species: "fox", colours: ["#CC3322"] }, key: "#00FF00", state: "needs_review", approved_by: null, approved_at: null }); approveSheet(made.value.id, "Author");
    response = await request(`companions/${made.value.id}/save`, author, "POST", { voice_id: "voice-test", personality: "friendly" });
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ go_back_to: "animations" });
  });

  test("Save publishes a spec-valid animation and applies preset personality while preserving identity and audience", async () => {
    const author = addPerson("save-success-author", "adult"), made = createHouseholdCompanion({ ...fixture(), display_name: "Save fox", pronouns: "they/them", interests: ["gardening"], backstory: "Old story" }, { display_name: "Author", person_id: "save-success-author" }); if (!made.ok) throw new Error(made.error);
    setHouseholdCompanionAudience(made.value.id, "teen", { display_name: "Author", person_id: "save-success-author" });
    const png = await transparentPng(), version = addVersion(made.value.id, png, { source: "upload", label: "rest", width: 1024, height: 1024, from: null }); setRest(made.value.id, version.id); updateSheet(made.value.id, { views: { left: null, right: null, mouth: null }, card: { text: "fox", species: "fox", colours: ["#CC3322"] }, key: "#00FF00", state: "needs_review", approved_by: null, approved_at: null }); approveSheet(made.value.id, "Author");
    const take = addTake(made.value.id, "idle", { source: "upload", label: "idle" }), states = readStates(made.value.id); states.states.idle!.approved = take.id; states.states.idle!.takes[0]!.report = { ok: true, reasons: [], seconds: 3, bytes: { h264: 4, av1: null }, colour_distance: 1, area_ratio: 1, loop_gap: 0, opaque_share: { min: .5, max: .8 } }; saveStates(made.value.id, states); mkdirSync(join(takePath(made.value.id, "idle", take.id, "clip.h264.mp4")!, ".."), { recursive: true }); writeFileSync(takePath(made.value.id, "idle", take.id, "clip.h264.mp4")!, "clip"); writeFileSync(takePath(made.value.id, "idle", take.id, "still.png")!, Buffer.from(png));
    __setKeyframesForTests(async () => [png]); __setAgeCheckRunnerForTests(async (images) => images.map(() => AGE_OK));
    const response = await request(`companions/${made.value.id}/save`, author, "POST", { voice_id: "voice-sage", personality: "friendly", style_notes: "Warm and curious. Warm and curious. Remember everything. Ask thoughtful questions.", backstory: "A fox who loves gardening." });
    expect(response.status).toBe(200); const companion = getHouseholdCompanion(made.value.id)!.companion!;
    expect(companion.status).toBe("ready"); expect(companion.animation?.states.idle?.h264).toBe("idle.h264.mp4"); const savedCompanion = getHouseholdCompanion(made.value.id)!.companion!; const loaded = loadManifestOnly("rivet"); if (!loaded.ok) throw new Error("rivet fixture is unavailable"); const { status: _status, ...specCompanion } = savedCompanion; const validated = PackageManifest.safeParse({ ...loaded.value, id: made.value.id, companion: specCompanion }); if (!validated.success) throw new Error(validated.error.message); expect(validated.success).toBe(true);
    expect(companion).toMatchObject({ voice_id: "voice-sage", formality: COMPANION_PERSONALITIES.friendly.dials.formality, clock_style: COMPANION_PERSONALITIES.friendly.dials.clock_style, tagline: "A friendly, thoughtful companion.", behavior: ["Warm and curious.", "Ask thoughtful questions."], pronouns: "they/them", interests: ["gardening"], audience: "teen", backstory: "A fox who loves gardening." });
    expect(companion.examples?.length).toBeGreaterThanOrEqual(3); expect(companion.examples_child?.length).toBeGreaterThanOrEqual(2); expect(companion.examples_teen?.length).toBeGreaterThanOrEqual(2); expect(companion.examples_adult?.length).toBeGreaterThanOrEqual(2);
  });

  test("a withheld picture blocks Save and leaves the companion in draft", async () => {
    const author = addPerson("save-withheld-author", "adult"), made = createHouseholdCompanion({ ...fixture(), display_name: "Blocked save" }, { display_name: "Author", person_id: "save-withheld-author" }); if (!made.ok) throw new Error(made.error);
    const png = await transparentPng(), version = addVersion(made.value.id, png, { source: "upload", label: "rest", width: 1024, height: 1024, from: null }); setRest(made.value.id, version.id); updateSheet(made.value.id, { views: { left: null, right: null, mouth: null }, card: { text: "fox", species: "fox", colours: ["#CC3322"] }, key: "#00FF00", state: "needs_review", approved_by: null, approved_at: null }); approveSheet(made.value.id, "Author");
    const take = addTake(made.value.id, "idle", { source: "upload", label: "idle" }), states = readStates(made.value.id); states.states.idle!.approved = take.id; states.states.idle!.takes[0]!.report = { ok: true, reasons: [], seconds: 3, bytes: { h264: 4, av1: null }, colour_distance: 1, area_ratio: 1, loop_gap: 0, opaque_share: { min: .5, max: .8 } }; saveStates(made.value.id, states); mkdirSync(join(takePath(made.value.id, "idle", take.id, "clip.h264.mp4")!, ".."), { recursive: true }); writeFileSync(takePath(made.value.id, "idle", take.id, "clip.h264.mp4")!, "clip"); writeFileSync(takePath(made.value.id, "idle", take.id, "still.png")!, Buffer.from(png));
    __setKeyframesForTests(async () => [png]); __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { people_count: 1, apparent_min_age_estimate: 8, label: "child" as const, is_nude_or_sexual: true, confidence: 1 } })));
    const response = await request(`companions/${made.value.id}/save`, author, "POST", { voice_id: "voice-test", personality: "calm" });
    expect(response.status).toBe(422); expect(await response.json()).toMatchObject({ go_back_to: "animations" }); expect(getHouseholdCompanion(made.value.id)?.companion?.status).toBe("draft");
  });

  test("a band example below its safety floor is replaced by safe preset examples", async () => {
    const author = addPerson("save-floor-author", "adult"), made = createHouseholdCompanion({ ...fixture(), display_name: "Floor fox" }, { display_name: "Author", person_id: "save-floor-author" }); if (!made.ok) throw new Error(made.error);
    const png = await transparentPng(), version = addVersion(made.value.id, png, { source: "upload", label: "rest", width: 1024, height: 1024, from: null }); setRest(made.value.id, version.id); updateSheet(made.value.id, { views: { left: null, right: null, mouth: null }, card: { text: "fox", species: "fox", colours: ["#CC3322"] }, key: "#00FF00", state: "needs_review", approved_by: null, approved_at: null }); approveSheet(made.value.id, "Author");
    const take = addTake(made.value.id, "idle", { source: "upload", label: "idle" }), states = readStates(made.value.id); states.states.idle!.approved = take.id; states.states.idle!.takes[0]!.report = { ok: true, reasons: [], seconds: 3, bytes: { h264: 4, av1: null }, colour_distance: 1, area_ratio: 1, loop_gap: 0, opaque_share: { min: .5, max: .8 } }; saveStates(made.value.id, states); mkdirSync(join(takePath(made.value.id, "idle", take.id, "clip.h264.mp4")!, ".."), { recursive: true }); writeFileSync(takePath(made.value.id, "idle", take.id, "clip.h264.mp4")!, "clip"); writeFileSync(takePath(made.value.id, "idle", take.id, "still.png")!, Buffer.from(png));
    __setKeyframesForTests(async () => [png]); __setAgeCheckRunnerForTests(async (images) => images.map(() => AGE_OK));
    const response = await request(`companions/${made.value.id}/save`, author, "POST", { voice_id: "voice-floor", personality: "friendly" }); expect(response.status).toBe(200);
    const stored = getHouseholdCompanion(made.value.id)!.companion!; expect(stored.examples_teen).toHaveLength(3); expect(stored.examples_teen).toEqual(COMPANION_PERSONALITIES.friendly.examples.teen.map((line) => line.replaceAll("{name}", "Floor fox"))); expect(stored.examples_teen).not.toContain("I cannot help with that request.");
  });

  test("a ready companion is republished only when its approved appearance changes", async () => {
    const f = await publishFixture("save-repeat-author", "adult", "adult"); __setKeyframesForTests(async () => [f.png]); __setAgeCheckRunnerForTests(async (images) => images.map(() => AGE_OK));
    const first = await request(`companions/${f.id}/save`, f.token, "POST", { voice_id: "voice-test", personality: "friendly" }); expect(first.status).toBe(200); expect(await first.json()).toMatchObject({ status: "ready", published: true });
    const second = await request(`companions/${f.id}/save`, f.token, "POST", { voice_id: "voice-test", personality: "friendly" }); expect(second.status).toBe(200); expect(await second.json()).toMatchObject({ status: "ready", published: false });
  });

  test("the legacy appearance publish route keeps its published response", async () => {
    const f = await publishFixture("save-legacy-publish", "adult", "adult"); __setKeyframesForTests(async () => [f.png]); __setAgeCheckRunnerForTests(async (images) => images.map(() => AGE_OK));
    const response = await request(`companions/${f.id}/appearance/publish`, f.token, "POST"); expect(response.status).toBe(200); expect(await response.json()).toEqual({ published: true });
  });
});

describe("household companion routes", () => {
  test("keyframe upload stores transparent art as a prepared 1024 square and withholds checked art", async () => {
    const adult = addPerson("key-upload-author", "adult"), made = createHouseholdCompanion({ ...fixture(), display_name: "Key upload" }, { display_name: "Author", person_id: "key-upload-author" }); if (!made.ok) throw new Error(made.error);
    const id = made.value.id, png = await transparentPng(); let imageToolCalls = 0, checkCalls = 0;
    __setAgeCheckRunnerForTests(async (images) => { checkCalls += images.length; return images.map(() => AGE_OK); });
    __setImageToolsForTests({ state: "idle", phase: null, vision: true, models: { isnet: true, lama: true, esrgan: true }, limits: {}, operations: ["remove_background", "erase", "upscale", "resize"], reason: null } satisfies StackImageToolsStatus);
    __setStackClientForTests({ imageEdit: async () => { imageToolCalls++; return { kind: "done", item: { b64_json: Buffer.from(png).toString("base64"), width: 1024, height: 1024 } }; } } as never);
    const saved = await upload(`companions/${id}/states/happy/keyframe`, adult, png); expect(saved.status).toBe(201); expect(imageToolCalls).toBe(0); expect(checkCalls).toBeGreaterThan(0);
    const stored = readFileSync(keyframePath(id, "happy")), info = await sharp(stored).metadata(); expect(info).toMatchObject({ width: 1024, height: 1024, hasAlpha: true }); expect((await sharp(stored).ensureAlpha().stats()).channels[3]?.min).toBe(0);
    expect(readKeyframeMeta(id, "happy")).toMatchObject({ source: "upload", style: "keep" });
    const withheldId = createHouseholdCompanion({ ...fixture(), display_name: "Withheld key upload" }, { display_name: "Author", person_id: "key-upload-author" }); if (!withheldId.ok) throw new Error(withheldId.error);
    __setAgeCheckRunnerForTests(async (images) => images.map(() => AGE_WITHHELD));
    const withheld = await upload(`companions/${withheldId.value.id}/states/happy/keyframe`, adult, png); expect(withheld.status).toBe(422); expect(((await withheld.json()) as { error: string }).error).toBeTruthy(); expect(existsSync(keyframePath(withheldId.value.id, "happy"))).toBe(false);
  });

  test("keyframe edit starts from the current keyframe and screened teen inputs are refused", async () => {
    const adult = addPerson("key-edit-author", "adult"), other = addPerson("key-edit-other", "adult"), admin = addPerson("key-edit-admin", "admin"), teen = addPerson("key-edit-teen", "teen");
    const made = createHouseholdCompanion({ ...fixture(), display_name: "Key edit" }, { display_name: "Author", person_id: "key-edit-author" }); if (!made.ok) throw new Error(made.error); const id = made.value.id;
    const current = await transparentPng(); writeKeyframe(id, "happy", current, { source: "upload", style: "keep", prompt_hash: "0".repeat(64), model: null, created_at: now, edited_at: now });
    __setPictureStatusForTests(readyStatusForTests()); __setAgeCheckRunnerForTests(async (images) => images.map(() => AGE_OK));
    let submitted: FormData | undefined;
    __setPicturesFetchForTests((async (input, init) => { if (String(input).endsWith("/v1/images/edits") && init?.method === "POST") { submitted = init.body as FormData; return Response.json({ job: "key-edit-job" }, { status: 202 }); } return new Response("Not found", { status: 404 }); }) as typeof fetch);
    const edit = await request(`companions/${id}/states/happy/keyframe/edit`, adult, "POST", { instruction: "Raise one paw" }); expect(edit.status).toBe(202);
    const sentPixels = await sharp(new Uint8Array(await (submitted!.get("image") as File).arrayBuffer())).ensureAlpha().raw().toBuffer(), currentPixels = await sharp(current).flatten({ background: { r: 217, g: 217, b: 217 } }).ensureAlpha().raw().toBuffer();
    expect(sentPixels).toEqual(currentPixels);
    expect((await request(`companions/${id}/states/happy/keyframe`, admin)).status).toBe(200); expect((await request(`companions/${id}/states/happy/keyframe`, other)).status).toBe(403);
    const teenMade = createHouseholdCompanion({ ...fixture(), display_name: "Teen key edit", audience: "teen" }, { display_name: "Teen Author", person_id: "key-edit-teen" }); if (!teenMade.ok) throw new Error(teenMade.error);
    writeKeyframe(teenMade.value.id, "happy", current, { source: "upload", style: "keep", prompt_hash: "0".repeat(64), model: null, created_at: now, edited_at: now });
    let screened = 0; __setAgeCheckRunnerForTests(async (images) => { screened += images.length; return images.map(() => AGE_WITHHELD); });
    const rejected = await request(`companions/${teenMade.value.id}/states/happy/keyframe/edit`, teen, "POST", { instruction: "Raise one paw" }); expect(rejected.status).toBe(422); expect(screened).toBeGreaterThan(0); expect(readKeyframeMeta(teenMade.value.id, "happy")?.edited_at).toBe(now);
  });

  test("keyframe prepare and state rows preserve approvals while reporting stale clips; get and delete follow access", async () => {
    const author = addPerson("key-prepare-author", "adult"), child = addPerson("key-prepare-child", "child"); const made = createHouseholdCompanion({ ...fixture(), display_name: "Key prepare" }, { display_name: "Author", person_id: "key-prepare-author" }); if (!made.ok) throw new Error(made.error); const id = made.value.id;
    const png = await transparentPng(), take = addTake(id, "idle", { source: "upload", label: "Approved" }), states = readStates(id); states.states.idle!.approved = take.id; states.states.idle!.approved_by = "Author"; states.states.idle!.approved_at = now; states.states.idle!.takes[0]!.report = { ok: true, reasons: [], seconds: 3, bytes: { h264: 4, av1: null }, colour_distance: 1, area_ratio: 1, loop_gap: 0, opaque_share: { min: .5, max: .8 } }; saveStates(id, states);
    mkdirSync(join(takePath(id, "idle", take.id, "clip.h264.mp4")!, ".."), { recursive: true }); writeFileSync(takePath(id, "idle", take.id, "clip.h264.mp4")!, "clip"); writeFileSync(takePath(id, "idle", take.id, "still.png")!, Buffer.from(png));
    writeKeyframe(id, "idle", png, { source: "upload", style: "keep", prompt_hash: "0".repeat(64), model: null, created_at: now, edited_at: new Date(Date.now() + 1000).toISOString() });
    __setAgeCheckRunnerForTests(async (images) => images.map(() => AGE_OK));
    __setImageToolsForTests({ state: "idle", phase: null, vision: true, models: { isnet: true, lama: true, esrgan: true }, limits: {}, operations: ["remove_background", "erase", "upscale", "resize"], reason: null } satisfies StackImageToolsStatus);
    __setStackClientForTests({ imageEdit: async (form: FormData) => { const input = new Uint8Array(await (form.get("image") as File).arrayBuffer()); return { kind: "done", item: { b64_json: Buffer.from(await sharp(input).resize(1024, 1024, { fit: "inside" }).png().toBuffer()).toString("base64"), width: 1024, height: 1024 } }; } } as never);
    const prepared = await request(`companions/${id}/states/idle/keyframe/prepare`, author, "POST", { remove_background: false, frame: { zoom: 1.2, x: .5, y: .5 } }); expect(prepared.status).toBe(200);
    const got = await request(`companions/${id}/states/idle/keyframe`, author); expect(got.status).toBe(200); expect(got.headers.get("content-type")).toBe("image/png");
    const row = (await (await request(`companions/${id}/states`, author)).json() as any).states.find((state: any) => state.id === "idle"); expect(row.keyframe).toMatchObject({ url: `/api/companions/${id}/states/idle/keyframe` }); expect(row.clip_out_of_date).toBe(true); expect(row.approved.take_id).toBe(take.id);
    for (const [method, suffix, body] of [["POST", "/keyframe/generate", undefined], ["POST", "/keyframe/edit", { instruction: "Wave" }], ["POST", "/keyframe", undefined], ["POST", "/keyframe/prepare", { remove_background: false }], ["GET", "/keyframe", undefined], ["DELETE", "/keyframe", undefined]] as const) {
      const path = `companions/${id}/states/happy${suffix}`; const res = method === "POST" && suffix === "/keyframe" ? await upload(path, child, png) : await request(path, child, method, body); expect(res.status).toBe(403);
    }
    expect((await request(`companions/${id}/states/idle/keyframe`, child)).status).toBe(403);
    expect((await request(`companions/${id}/states/idle/keyframe`, author, "DELETE")).status).toBe(204); expect(existsSync(keyframePath(id, "idle"))).toBe(false);
    const deleted = (await (await request(`companions/${id}/states`, author)).json() as any).states.find((state: any) => state.id === "idle"); expect(deleted.keyframe).toBeNull(); expect(deleted.approved.take_id).toBe(take.id);
  });

  test("keyframe generation checks before storing and clip generation requires a keyframe except for idle", async () => {
    const adult = addPerson("key-generate-author", "adult"), made = createHouseholdCompanion({ ...fixture(), display_name: "Key generation" }, { display_name: "Author", person_id: "key-generate-author" }); if (!made.ok) throw new Error(made.error); const id = made.value.id;
    const png = await transparentPng(), original = await keyedPicture(), rest = addVersion(id, png, { source: "upload", label: "rest", width: 1024, height: 1024, from: null }, original); setRest(id, rest.id); updateSheet(id, { views: { left: null, right: null, mouth: null }, card: { text: "fox", species: "fox", colours: ["#CC3322"] }, key: "#00FF00", state: "needs_review", approved_by: null, approved_at: null }); approveSheet(id, "Author");
    __setPictureStatusForTests(readyStatusForTests()); __setAgeCheckRunnerForTests(async (images) => images.map(() => AGE_OK));
    let stackCalls = 0, reads = 0;
    __setPicturesFetchForTests((async (input, init) => { const url = String(input); if (url.endsWith("/v1/images/edits") && init?.method === "POST") { stackCalls++; return Response.json({ job: "key-gen-job" }, { status: 202 }); } if (url.endsWith("/v1/images/generations/key-gen-job")) { reads++; return Response.json({ job: "key-gen-job", state: "done", progress: 100, data: [] }); } if (url.endsWith("/key-gen-job/0.png")) return new Response(png, { headers: { "content-type": "image/png" } }); return new Response("Not found", { status: 404 }); }) as typeof fetch);
    const generated = await request(`companions/${id}/states/listening/keyframe/generate`, adult, "POST", {}); expect(generated.status, await generated.clone().text()).toBe(202); expect(stackCalls).toBe(1);
    const { job } = await generated.json() as { job: string }; let progress: any;
    for (let attempt = 0; attempt < 100; attempt++) { const response = await request(`companions/${id}/look/jobs/${job}`, adult); progress = await response.json(); if (progress.state === "done" || progress.state === "failed") break; await new Promise((resolve) => setTimeout(resolve, 5)); }
    expect(progress.state).toBe("done"); expect(reads).toBeGreaterThan(0); const keyInfo = await sharp(readFileSync(keyframePath(id, "listening"))).metadata(); expect(keyInfo).toMatchObject({ width: 1024, height: 1024, hasAlpha: true }); expect(readKeyframeMeta(id, "listening")?.source).toBe("generated");
    const withheldHouse = createHouseholdCompanion({ ...fixture(), display_name: "Withheld key generation" }, { display_name: "Author", person_id: "key-generate-author" }); if (!withheldHouse.ok) throw new Error(withheldHouse.error);
    const withheldRest = addVersion(withheldHouse.value.id, png, { source: "upload", label: "rest", width: 1024, height: 1024, from: null }, original); setRest(withheldHouse.value.id, withheldRest.id); updateSheet(withheldHouse.value.id, { views: { left: null, right: null, mouth: null }, card: { text: "fox", species: "fox", colours: ["#CC3322"] }, key: "#00FF00", state: "needs_review", approved_by: null, approved_at: null }); approveSheet(withheldHouse.value.id, "Author");
    __setAgeCheckRunnerForTests(async (images) => images.map(() => AGE_WITHHELD));
    // Withheld output is refused during the generation poll and cannot become a keyframe.
    const denied = await request(`companions/${withheldHouse.value.id}/states/listening/keyframe/generate`, adult, "POST", {}); expect(denied.status).toBe(202); const deniedJob = (await denied.json() as { job: string }).job;
    for (let attempt = 0; attempt < 100; attempt++) { const response = await request(`companions/${withheldHouse.value.id}/look/jobs/${deniedJob}`, adult); progress = await response.json(); if (progress.state === "done" || progress.state === "failed") break; await new Promise((resolve) => setTimeout(resolve, 5)); }
    expect(progress.state).toBe("failed"); expect(progress.error).toBeTruthy(); expect(existsSync(keyframePath(withheldHouse.value.id, "listening"))).toBe(false);
    __setAgeCheckRunnerForTests(async (images) => images.map(() => AGE_OK));
    __setVideoStatusForTests(readyVideoStatusForTests());
    const started = await request(`companions/${id}/states/thinking/generate`, adult, "POST", { count: 1 }); expect(started.status).toBe(202);
    expect(existsSync(keyframePath(id, "thinking"))).toBe(true); /* an animation with no picture of its own starts from the starting picture */
    expect(await sharp(readFileSync(keyframePath(id, "thinking"))).metadata()).toMatchObject({ width: 1024, height: 1024, hasAlpha: true });
  });
  test("register dials save flat, store social nested, and read back flat (NAT-06)", async () => {
    const author = addPerson("person-dials-author", "adult");
    const created = createHouseholdCompanion({ ...fixture(), display_name: "Dials" }, { display_name: "Author", person_id: "person-dials-author" });
    if (!created.ok) throw new Error(created.error);
    const saved = await request(`companions/${created.value.id}`, author, "PUT", { clock_style: "loose", hedging: "high", humor: "low", warmth: "high", initiative: "low" });
    expect(saved.status).toBe(200);
    expect(getHouseholdCompanion(created.value.id)?.companion).toMatchObject({ clock_style: "loose", hedging: "high", social: { humor: "low", warmth: "high", initiative: "low" } });
    expect(await (await request(`companions/${created.value.id}/edit`, author)).json()).toMatchObject({ clock_style: "loose", hedging: "high", humor: "low", warmth: "high", initiative: "low" });
    expect((await request(`companions/${created.value.id}`, author, "PUT", { hedging: "extreme" })).status).toBe(400);
  });

  test("look upload accepts real person photos without a content consent prompt", async () => {
    const adult = addPerson("person-look-adult", "adult");
    const created = createHouseholdCompanion({ ...fixture(), display_name: "Look upload" }, { display_name: "Author", person_id: "person-look-adult" });
    if (!created.ok) throw new Error(created.error);
    const png = await transparentPng();
    const real = await upload(`companions/${created.value.id}/look/upload`, adult, png);
    expect(real.status).toBe(201);
    const uploadedId = (await real.json() as { id: string }).id;
    expect(readLook(created.value.id).versions.find((version) => version.id === uploadedId)?.style).toBe("keep");
  });

  test("look read returns age-band styles and the approved portrait audience cap", async () => {
    const adult = addPerson("person-look-styles-adult", "adult"), teen = addPerson("person-look-styles-teen", "teen");
    const created = createHouseholdCompanion({ ...fixture(), display_name: "Style read", audience: "teen" }, { display_name: "Author", person_id: "person-look-styles-adult" }); if (!created.ok) throw new Error(created.error);
    const version = addVersion(created.value.id, await transparentPng(), { source: "upload", label: "real", width: 1024, height: 1024, from: null, style: "photorealistic" }); setRest(created.value.id, version.id);
    const adultResult = await (await request(`companions/${created.value.id}/look`, adult)).json() as { styles: Array<{ id: string; custom: boolean }>; keep: { id: string }; audience_cap: string };
    const teenResultResponse = await request(`companions/${created.value.id}/look`, teen);
    expect(teenResultResponse.status).toBe(403);
    const teenCompanion = createHouseholdCompanion({ ...fixture(), display_name: "Teen style read", audience: "teen" }, { display_name: "Teen author", person_id: "person-look-styles-teen" }); if (!teenCompanion.ok) throw new Error(teenCompanion.error);
    const teenAuthorResult = await (await request(`companions/${teenCompanion.value.id}/look`, teen)).json() as { styles: Array<{ id: string }>; audience_cap: string };
    expect(adultResult.styles).toHaveLength(6); expect(adultResult.styles.find((style) => style.id === "custom")?.custom).toBe(true);
    expect(adultResult.keep.id).toBe("keep"); expect(adultResult.audience_cap).toBe("teen");
    expect(teenAuthorResult.styles.map((style) => style.id)).not.toContain("custom"); expect(teenAuthorResult.audience_cap).toBe("all");
  });

  test("a small look upload without an installed upscaler is refused and not stored", async () => {
    const adult = addPerson("person-look-small-no-upscale", "adult");
    const created = createHouseholdCompanion({ ...fixture(), display_name: "Small look upload" }, { display_name: "Author", person_id: "person-look-small-no-upscale" });
    if (!created.ok) throw new Error(created.error);
    const small = new Uint8Array(await sharp({ create: { width: 512, height: 512, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: await sharp({ create: { width: 180, height: 180, channels: 4, background: { r: 0, g: 255, b: 0, alpha: 1 } } }).png().toBuffer(), left: 166, top: 166 }]).png().toBuffer());
    __setImageToolsForTests({ state: "idle", phase: null, vision: true, models: { isnet: true, lama: true, esrgan: true }, limits: {}, operations: ["remove_background", "erase", "resize"], reason: null } satisfies StackImageToolsStatus);
    __setStackClientForTests({ imageEdit: async () => { throw new Error("The upscaler isn't installed. Install it from the engine's model list, then try again."); } } as never);
    const result = await upload(`companions/${created.value.id}/look/upload`, adult, small);
    expect(result.status).toBe(400);
    expect(((await result.json()) as { error: string }).error).toContain("The upscaler isn't installed");
    expect(((await (await request(`companions/${created.value.id}/look`, adult)).json()) as { versions: unknown[] }).versions).toHaveLength(0);
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

  test("a draft companion's profile opens for its author and an admin, not for another adult", async () => {
    const author = addPerson("profile-draft-author", "adult"), other = addPerson("profile-draft-other", "adult");
    const draft = createHouseholdCompanion({ ...fixture(), display_name: "Draft profile" }, { display_name: "Author", person_id: "profile-draft-author" });
    if (!draft.ok) throw new Error(draft.error);
    const mine = await request(`companions/${draft.value.id}`, author);
    expect(mine.status).toBe(200);
    expect(await mine.json()).toMatchObject({ name: "Draft profile", status: "draft", can_edit: true });
    expect((await request(`companions/${draft.value.id}`, other)).status).toBe(404);
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

  test("children cannot create; teens start at teen audience and adults create adult drafts", async () => {
    const child = addPerson("person-child01", "child"), teen = addPerson("person-teen001", "teen"), adult = addPerson("person-adult01", "adult");
    const refused = await request("companions", child, "POST", { ...fixture(), display_name: "New pal" });
    expect(refused.status).toBe(403);
    const teenCreated = await request("companions", teen, "POST", { ...fixture(), display_name: "Teen pal" }); expect(teenCreated.status).toBe(201);
    const teenId = (await teenCreated.json() as { id: string }).id;
    expect((await import("@/lib/householdCompanions")).getHouseholdCompanion(teenId)?.companion).toMatchObject({ audience: "teen", status: "draft" });
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
    const legacy = addVersion(created.value.id, await transparentPng(), { source: "upload", label: "legacy", width: 1024, height: 1024, from: null }); setRest(created.value.id, legacy.id);
    const oldLook = readLook(created.value.id); for (const version of oldLook.versions) delete version.style; writeFileSync(join(householdCompanionFolder(created.value.id)!, "look", "look.json"), JSON.stringify(oldLook));
    const checkManifestPath = join(householdCompanionFolder(created.value.id)!, "manifest.json"), checkManifest = JSON.parse(await Bun.file(checkManifestPath).text()); checkManifest.companion.animation = undefined; writeFileSync(checkManifestPath, JSON.stringify(checkManifest));
    const denied = await request(`companions/${created.value.id}/audience`, adult, "PUT", { audience: "teen" }); expect(denied.status).toBe(403);
    const unconfirmed = await request(`companions/${created.value.id}/audience`, admin, "PUT", { audience: "all" }); expect(unconfirmed.status).toBe(400);
    const unconfirmedLine = (await unconfirmed.json() as { error: string }).error; expect(unconfirmedLine).toContain("checklist");
    const confirmed = await request(`companions/${created.value.id}/audience`, admin, "PUT", { audience: "all", confirmed: true }); expect(confirmed.status).toBe(422);
    const stored = (await import("@/lib/householdCompanions")).getHouseholdCompanion(created.value.id);
    expect(stored?.companion?.review?.confirmed_by).toBeUndefined();
  });

  test("lowering audience refuses a child robot already using an all ages companion", async () => {
    const adult = addPerson("person-adult07", "adult"), admin = addPerson("person-admin007", "admin");
    const created = createHouseholdCompanion(fixture(), { display_name: "Author", person_id: "person-adult07" });
    if (!created.ok) throw new Error(created.error);
    const legacy = addVersion(created.value.id, await transparentPng(), { source: "upload", label: "legacy", width: 1024, height: 1024, from: null }); setRest(created.value.id, legacy.id);
    const oldLook = readLook(created.value.id); for (const version of oldLook.versions) delete version.style; writeFileSync(join(householdCompanionFolder(created.value.id)!, "look", "look.json"), JSON.stringify(oldLook));
    const checkManifestPath = join(householdCompanionFolder(created.value.id)!, "manifest.json"), checkManifest = JSON.parse(await Bun.file(checkManifestPath).text()); checkManifest.companion.animation = undefined; writeFileSync(checkManifestPath, JSON.stringify(checkManifest));
    const setAll = await request(`companions/${created.value.id}/audience`, admin, "PUT", { audience: "all", confirmed: true }); expect(setAll.status).toBe(422);
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
    expect(stateBody.start_ready).toBe(false); expect(stateBody.start_reason).toContain("Choose and approve a starting picture first.");
    expect(stateBody.states.map((s) => s.id)).toContain("laughing");
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
    expect(progress).toMatchObject({ state: "done", percent: 100, takes_made: 2 }); expect(progress.label).toContain("try 2 of 2");
    expect(submitted).toHaveLength(2); expect(submitted[0]?.seed).not.toBe(submitted[1]?.seed); expect(submitted[0]).toMatchObject({ size: `${media.generate.width}x${media.generate.height}`, seconds: media.generate.seconds, image_source: "generated", audience: "all-ages", timeout_ms: 1 }); expect(submitted[0]).toMatchObject({ model: "wan2.2-ti2v-5b-fastwan-mlx" });
    { const sent = await sharp(Buffer.from(String(submitted[0]!.image), "base64")).metadata(); expect(sent.hasAlpha).toBe(false); expect([sent.width, sent.height]).toEqual([media.generate.width, media.generate.height]); } /* the start picture goes on the key colour, never transparent */
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

  test("a photo kept as it is can start a video for anyone the video rules allow", async () => {
    const adult = addPerson("person-state-no-original", "adult"), created = createHouseholdCompanion({ ...fixture(), display_name: "Upload only rest" }, { display_name: "Author", person_id: "person-state-no-original" }); if (!created.ok) throw new Error(created.error); const id = created.value.id;
    const rest = addVersion(id, await transparentPng(), { source: "upload", label: "rest", width: 1024, height: 1024, from: null }); setRest(id, rest.id); updateSheet(id, { views: { left: null, right: null, mouth: null }, card: { text: "A red fox", species: "fox", colours: ["#CC3322"] }, key: "#00FF00", state: "needs_review", approved_by: null, approved_at: null }); approveSheet(id, "Author");
    let calls = 0; __setVideosFetchForTests((async () => { calls++; return new Response("unexpected", { status: 500 }); }) as unknown as typeof fetch);
    const response = await request(`companions/${id}/states/idle/generate`, adult, "POST", { count: 1 });
    expect((await response.json() as { code?: string }).code).not.toBe("no_original");
    const look = await (await request(`companions/${id}/look`, adult)).json() as { start_ready: boolean; start_reason?: string }; expect(look.start_ready).toBe(true); expect(look.start_reason).toBeUndefined();
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

  test("keyframe reads and edits refuse children", async () => {
    const child = addPerson("person-keyframe-child", "child"), made = createHouseholdCompanion({ ...fixture(), display_name: "Keyframe child" }, { display_name: "Author", person_id: "person-keyframe-child" });
    if (!made.ok) throw new Error(made.error);
    expect((await request(`companions/${made.value.id}/states/idle/keyframe`, child)).status).toBe(403);
    const denied = await request(`companions/${made.value.id}/states/idle/keyframe/edit`, child, "POST", { instruction: "Change the expression" });
    expect(denied.status).toBe(403);
  });

  test("states route lists creator vocabulary in spec order and subset generation rejects legacy ids", async () => {
    const adult = addPerson("person-state-subset", "adult"), created = createHouseholdCompanion({ ...fixture(), display_name: "Subset character" }, { display_name: "Author", person_id: "person-state-subset" }); if (!created.ok) throw new Error(created.error); const id = created.value.id;
    const body = await (await request(`companions/${id}/states`, adult)).json() as any;
    expect(body.states.map((state: any) => state.id)).toEqual(media.states.filter((state) => state.creator).map((state) => state.id));
    expect(body.states.filter((state: any) => state.required)).toHaveLength(4); expect(body.states.some((state: any) => state.id === "needs_you")).toBe(false); expect(body.counts.total).toBe(13);
    const rejected = await request(`companions/${id}/states/generate`, adult, "POST", { states: ["needs_you"] });
    expect(rejected.status).toBe(400); expect((await rejected.json() as any).error).toBe("Choose only listed companion states.");
  });

  test("subset generation starts the clips straight from the starting picture and makes no separate picture first", async () => {
    const author = addPerson("subset-keyframe-order", "adult"), made = createHouseholdCompanion({ ...fixture(), display_name: "Subset order" }, { display_name: "Author", person_id: "subset-keyframe-order" }); if (!made.ok) throw new Error(made.error); const id = made.value.id;
    const png = await transparentPng(), rest = addVersion(id, png, { source: "upload", label: "rest", width: 1024, height: 1024, from: null }); setRest(id, rest.id); updateSheet(id, { views: { left: null, right: null, mouth: null }, card: { text: "fox", species: "fox", colours: ["#CC3322"] }, key: "#00FF00", state: "needs_review", approved_by: null, approved_at: null }); approveSheet(id, "Author");
    __setPictureStatusForTests(readyStatusForTests()); __setAgeCheckRunnerForTests(async (images) => images.map(() => AGE_OK)); const events: string[] = [];
    __setPicturesFetchForTests((async (input, init) => { if (String(input).endsWith("/v1/images/edits") && init?.method === "POST") events.push("keyframe"); return Response.json({ job: "never" }, { status: 202 }); }) as typeof fetch);
    __setVideoStatusForTests(readyVideoStatusForTests()); __setVideosFetchForTests((async (_input, init) => { if (init?.method === "POST") events.push("clip"); return Response.json({ job: "clip-job" }, { status: 202 }); }) as typeof fetch);
    const response = await request(`companions/${id}/states/generate`, author, "POST", { states: ["listening", "thinking"], count: 1 }); expect(response.status).toBe(202);
    expect(existsSync(keyframePath(id, "listening"))).toBe(true); expect(existsSync(keyframePath(id, "thinking"))).toBe(true); expect(events).not.toContain("keyframe");
  });

  test("failed quality reports stay unapproved and idle removal clears every draft approval", async () => {
    const adult = addPerson("person-state-approve", "adult"), created = createHouseholdCompanion({ ...fixture(), display_name: "Approval flow" }, { display_name: "Author", person_id: "person-state-approve" }); if (!created.ok) throw new Error(created.error); const id = created.value.id;
    const rest = addVersion(id, new Uint8Array([1]), { source: "upload", label: "rest", width: 1024, height: 1024, from: null }); setRest(id, rest.id); updateSheet(id, { views: { left: null, right: null, mouth: null }, card: { text: "fox", species: "fox", colours: ["#CC3322"] }, key: "#00FF00", state: "needs_review", approved_by: null, approved_at: null }); approveSheet(id, "Author");
    const idle = addTake(id, "idle", { source: "upload", label: "idle" }), thinking = addTake(id, "thinking", { source: "upload", label: "thinking" });
    const report = (ok: boolean, reasons: string[]) => ({ ok, reasons, seconds: 3, bytes: { h264: 4, av1: null }, colour_distance: 1, area_ratio: 1, loop_gap: 0, opaque_share: { min: .5, max: .8 } });
    const all = readStates(id); all.states.idle!.takes[0]!.report = report(false, ["The loop does not close cleanly."]); all.states.thinking!.takes[0]!.report = report(true, []); saveStates(id, all);
    for (const [state, take] of [["idle", idle], ["thinking", thinking]] as const) { const h264 = takePath(id, state, take.id, "clip.h264.mp4")!, still = takePath(id, state, take.id, "still.png")!; mkdirSync(join(h264, ".."), { recursive: true }); writeFileSync(h264, "h264"); writeFileSync(still, "png"); }
    const idlePath = `companions/${id}/states/idle/approve`;
    const needsForce = await request(idlePath, adult, "PUT", { take_id: idle.id }); expect(needsForce.status).toBe(409); expect(await needsForce.json()).toEqual({ error: "Needs another try" });
    const beforeIdle = await request(`companions/${id}/states/thinking/approve`, adult, "PUT", { take_id: thinking.id }); expect(beforeIdle.status).toBe(409); expect((await beforeIdle.json() as { error: string }).error).toBe("Approve the idle clip first.");
    expect((await request(idlePath, adult, "PUT", { take_id: idle.id, force: true })).status).toBe(409);
    const idleOk = readStates(id); idleOk.states.idle!.takes[0]!.report = report(true, []); saveStates(id, idleOk);
    expect((await request(idlePath, adult, "PUT", { take_id: idle.id })).status).toBe(200);
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
    writeKeyframe(id, "idle", png, { source: "upload", style: "cartoon", prompt_hash: "a".repeat(64), model: null, created_at: new Date().toISOString(), edited_at: new Date().toISOString() });
    const pub = await request(`companions/${id}/appearance/publish`, author, "POST"); expect(pub.status).toBe(200); expect(getHouseholdCompanion(id)?.companion?.animation).toMatchObject({ states: { idle: { keyframe: "idle-keyframe.png" } } }); expect(readStates(id).published?.states.idle).toBe(changedTake.id); expect(readFileSync(join(householdCompanionFolder(id)!, "animation", "idle-keyframe.png"))).toEqual(Buffer.from(png));
    const publishedManifest = JSON.parse(readFileSync(join(householdCompanionFolder(id)!, "manifest.json"), "utf8")); expect(() => PackageManifest.parse(publishedManifest)).not.toThrow();
  });

  test("Publish without keyframes omits the optional manifest field and validates", async () => {
    const f = await publishFixture("person-pub-no-keyframes", "adult", "adult");
    __setKeyframesForTests(async () => [new Uint8Array([9])]); __setAgeCheckRunnerForTests(async (images) => images.map(() => AGE_OK));
    const pub = await request(`companions/${f.id}/appearance/publish`, f.token, "POST"); expect(pub.status).toBe(200);
    expect(getHouseholdCompanion(f.id)?.companion?.animation?.states.idle).not.toHaveProperty("keyframe");
    const manifest = JSON.parse(readFileSync(join(householdCompanionFolder(f.id)!, "manifest.json"), "utf8")); expect(() => PackageManifest.parse(manifest)).not.toThrow();
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
    // Remove the fixture's picture styles to exercise the legacy audience checklist path.
    const look = readLook(f.id); for (const version of look.versions) delete version.style;
    writeFileSync(join(householdCompanionFolder(f.id)!, "look", "look.json"), JSON.stringify(look));
    const audienceManifestPath = join(householdCompanionFolder(f.id)!, "manifest.json");
    const manifest = JSON.parse(await Bun.file(audienceManifestPath).text()); manifest.companion.audience = "adult"; writeFileSync(audienceManifestPath, JSON.stringify(manifest));
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
    const body = await response.json() as { avatar: { id: string; portrait?: string | null; states: Record<string, { loop: boolean; urls: { h264: string | null; av1: string | null; still: string } }> } | null };
    expect(body.avatar?.id).toBe("tessa");
    expect(body.avatar?.portrait).toBe("/api/companions/tessa/animation/portrait.png");
    expect((await request(body.avatar!.portrait!.replace("/api/", ""), child)).status).toBe(200);
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
    const second = new Uint8Array(await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: await sharp({ create: { width: 340, height: 340, channels: 4, background: { r: 40, g: 40, b: 220, alpha: 1 } } }).png().toBuffer(), left: 320, top: 320 }]).png().toBuffer());
    __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: false as const, why: "unavailable" as const })));
    expect((await upload(path, adult, second)).status).toBe(422);
    expect(((await (await request(`companions/${created.value.id}/look`, adult)).json()) as { versions: unknown[] }).versions).toHaveLength(0);
    __setAgeCheckRunnerForTests(async (images) => images.map(() => verdict("adult")));
    // A verdict is kept per file, so a different picture is needed to see the new answer.
    const other = new Uint8Array(await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: await sharp({ create: { width: 400, height: 320, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 1 } } }).png().toBuffer(), left: 300, top: 340 }]).png().toBuffer());
    expect((await upload(path, adult, other)).status).toBe(201);
  });

  test("name-only draft is idempotent for its author and starts in the maker's age band", async () => {
    const adult = addPerson("draft-author", "adult"), teen = addPerson("draft-teen", "teen");
    const first = await request("companions/draft", adult, "POST", { name: "New Finch" }), firstBody = await first.json() as { id: string };
    const second = await request("companions/draft", adult, "POST", { name: "New Finch" });
    expect(first.status).toBe(201); expect(second.status).toBe(200); expect((await second.json() as { id: string }).id).toBe(firstBody.id);
    expect(getHouseholdCompanion(firstBody.id)?.companion).toMatchObject({ status: "draft", audience: "adult" });
    const teenReply = await request("companions/draft", teen, "POST", { name: "Teen Finch" }), teenId = (await teenReply.json() as { id: string }).id;
    expect(teenReply.status).toBe(201); expect(getHouseholdCompanion(teenId)?.companion?.audience).toBe("teen"); expect(readLook(teenId).versions).toHaveLength(0);
  });

  test("draft sweep removes only old empty drafts and logs count without identifiers", async () => {
    const author = { display_name: "Author", person_id: "sweep-person" };
    const make = (name: string) => { const result = createHouseholdCompanion({ ...fixture(), display_name: name }, author); if (!result.ok) throw new Error(result.error); return result.value.id; };
    const makeBlank = (name: string) => { const result = createHouseholdCompanion({ display_name: name, formality: "neutral", complexity: "standard", engagement: "balanced", filler_density: "light", status: "draft" } as never, author); if (!result.ok) throw new Error(result.error); return result.value.id; };
    const oldEmpty = makeBlank("Old empty draft"), oldWithPicture = make("Old pictured draft"), young = makeBlank("Young draft"), oldPersona = make("Old persona draft");
    for (const marked of [oldEmpty, oldWithPicture, young]) writeFileSync(join(householdCompanionFolder(marked)!, ".name-only-draft"), "");
        const png = await transparentPng(), picture = addVersion(oldWithPicture, png, { source: "upload", label: "Picture", width: 1024, height: 1024, from: null }); expect(picture.id).toBeTruthy();
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000); utimesSync(join(householdCompanionFolder(oldEmpty)!, "manifest.json"), old, old); utimesSync(join(householdCompanionFolder(oldPersona)!, "manifest.json"), old, old); utimesSync(join(householdCompanionFolder(oldWithPicture)!, "manifest.json"), old, old);
    const logs: string[] = [], prior = console.warn; console.warn = (line?: unknown) => logs.push(String(line));
    try { expect(sweepAbandonedDrafts()).toBe(1); } finally { console.warn = prior; }
    expect(getHouseholdCompanion(oldEmpty)).toBeNull(); expect(getHouseholdCompanion(oldPersona)).not.toBeNull(); expect(getHouseholdCompanion(oldWithPicture)).not.toBeNull(); expect(getHouseholdCompanion(young)).not.toBeNull();
    expect(logs).toHaveLength(1); expect(logs[0]).toContain('"count":1'); for (const privateValue of [oldEmpty, oldWithPicture, young, "sweep-person", "Old empty draft"]) expect(logs[0]).not.toContain(privateValue);
  });

  test("prepare saves a checked transparent square, places the character and reports clipped edges", async () => {
    const adult = addPerson("prepare-author", "adult"), made = createHouseholdCompanion({ ...fixture(), display_name: "Prepare fixture" }, { display_name: "Author", person_id: "prepare-author" }); if (!made.ok) throw new Error(made.error);
    const png = await clippedPng("bottom"), original = addVersion(made.value.id, png, { source: "upload", label: "Original", width: 1024, height: 1024, from: null });
    __setAgeCheckRunnerForTests(async (images) => images.map(() => AGE_OK));
    const prepared = await request(`companions/${made.value.id}/look/prepare`, adult, "POST", { version_id: original.id, remove_background: false, frame: { zoom: 1, x: .4, y: .5 } });
    expect(prepared.status).toBe(201);
    const responseBody = await prepared.json() as { id: string; clipped: string[] }, resultId = responseBody.id, resultVersion = readLook(made.value.id).versions.find((version) => version.id === resultId)!;
    const imagePath = join(householdCompanionFolder(made.value.id)!, "look", `${resultId}.png`), imageBytes = new Uint8Array(await Bun.file(imagePath).arrayBuffer()), metadata = await sharp(imageBytes).metadata(), alpha = await sharp(imageBytes).stats();
    expect([metadata.width, metadata.height]).toEqual([1024, 1024]); expect(metadata.hasAlpha).toBe(true); expect(alpha.channels[3]?.min).toBe(0); expect(resultVersion.steps).toContain("place"); expect(responseBody.clipped).toContain("bottom"); expect(resultVersion.clipped).toContain("bottom");
  });

  test("a prepared picture keeps the cut-off record of the photo it came from, so the missing body still gets drawn in", async () => {
    const adult = addPerson("prepare-inherit-author", "adult"), made = createHouseholdCompanion({ ...fixture(), display_name: "Prepare inherit fixture" }, { display_name: "Author", person_id: "prepare-inherit-author" }); if (!made.ok) throw new Error(made.error);
    const inside = new Uint8Array(await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: await sharp({ create: { width: 300, height: 500, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 1 } } }).png().toBuffer(), left: 362, top: 262 }]).png().toBuffer());
    const original = addVersion(made.value.id, inside, { source: "upload", label: "Original", width: 1024, height: 1024, from: null, clipped: ["bottom", "left"] });
    __setAgeCheckRunnerForTests(async (images) => images.map(() => AGE_OK));
    const prepared = await request(`companions/${made.value.id}/look/prepare`, adult, "POST", { version_id: original.id, remove_background: false });
    expect(prepared.status).toBe(201);
    const { id: preparedId } = await prepared.json() as { id: string };
    expect(readLook(made.value.id).versions.find((version) => version.id === preparedId)?.clipped).toEqual(["bottom", "left"]);
  });

  test("complete sends the clipped picture on a neutral backdrop and stores a normalized edit", async () => {
    const adult = addPerson("complete-author", "adult"), made = createHouseholdCompanion({ ...fixture(), display_name: "Complete fixture" }, { display_name: "Author", person_id: "complete-author" }); if (!made.ok) throw new Error(made.error);
    const sourcePng = await clippedPng("bottom"), returned = await transparentPng(); __setPictureStatusForTests(readyStatusForTests()); __setAgeCheckRunnerForTests(async (images) => images.map(() => AGE_OK));
    const posted: Array<{ instruction: string; image: Uint8Array; source: string }> = [];
    __setPicturesFetchForTests((async (input, init) => {
      const url = String(input);
      if (url.endsWith("/v1/images/edits") && init?.method === "POST") { const form = init.body as FormData, file = form.get("image") as File; posted.push({ instruction: String(form.get("instruction")), image: new Uint8Array(await file.arrayBuffer()), source: String(form.get("image_source")) }); return Response.json({ job: "complete-job" }, { status: 202 }); }
      if (url.endsWith("/complete-job")) return Response.json({ job: "complete-job", state: "done", progress: 1, data: [] });
      if (url.endsWith("/complete-job/0.png")) return new Response(returned, { headers: { "content-type": "image/png" } });
      return new Response("Not found", { status: 404 });
    }) as typeof fetch);
    const source = addVersion(made.value.id, sourcePng, { source: "upload", label: "Cut picture", width: 1024, height: 1024, from: null, style: "anime", clipped: ["bottom"] });
    const response = await request(`companions/${made.value.id}/look/complete`, adult, "POST", { version_id: source.id }); expect(response.status).toBe(202);
    const job = (await response.json() as { job: string }).job; expect(posted[0]?.instruction).toContain("at the bottom"); expect(posted[0]?.source).toBe("uploaded"); expect(posted[0]?.instruction).toContain("Keep everything already shown exactly as it is");
    const keyed = await sharp(posted[0]!.image).raw().toBuffer({ resolveWithObject: true }); expect(keyed.info.width).toBe(1024); expect(keyed.info.height).toBe(1024); expect(keyed.data[1]).toBeGreaterThan(200);
    const poll = await request(`companions/${made.value.id}/look/jobs/${job}`, adult); const state = await poll.json() as { state: string; versions: Array<{ id: string }> }; expect(state.state).toBe("done");
    const saved = readLook(made.value.id).versions.find((version) => version.id === state.versions[0]?.id)!;
    const resultPath = join(householdCompanionFolder(made.value.id)!, "look", `${saved.id}.png`), metadata = await sharp(readFileSync(resultPath)).metadata(), stats = await sharp(readFileSync(resultPath)).stats();
    expect(saved).toMatchObject({ source: "edit", from: source.id, style: "anime", clipped: [] }); { const fitted = await sharp(readFileSync(join(householdCompanionFolder(made.value.id)!, "look", `${saved.id}.png`))).trim({ threshold: 0 }).metadata(); expect(Math.max(fitted.width ?? 0, fitted.height ?? 0)).toBeGreaterThan(900); /* the filled picture is fitted so the subject fills the frame like a portrait */ } expect([metadata.width, metadata.height]).toEqual([1024, 1024]); expect(metadata.hasAlpha).toBe(true); expect(stats.channels[3]?.min).toBe(0);
  });

  test("a picture drawn from a Keep as is photo stays Keep as is, so later pictures are not restyled as cartoons", async () => {
    const adult = addPerson("keep-style-author", "adult"), made = createHouseholdCompanion({ ...fixture(), display_name: "Keep style fixture" }, { display_name: "Author", person_id: "keep-style-author" }); if (!made.ok) throw new Error(made.error);
    const sourcePng = await clippedPng("bottom"), returned = await transparentPng(); __setPictureStatusForTests(readyStatusForTests()); __setAgeCheckRunnerForTests(async (images) => images.map(() => AGE_OK));
    __setPicturesFetchForTests((async (input, init) => {
      const url = String(input);
      if (url.endsWith("/v1/images/edits") && init?.method === "POST") return Response.json({ job: "keep-job" }, { status: 202 });
      if (url.endsWith("/keep-job")) return Response.json({ job: "keep-job", state: "done", progress: 1, data: [] });
      if (url.endsWith("/keep-job/0.png")) return new Response(returned, { headers: { "content-type": "image/png" } });
      return new Response("Not found", { status: 404 });
    }) as typeof fetch);
    const source = addVersion(made.value.id, sourcePng, { source: "upload", label: "Cut picture", width: 1024, height: 1024, from: null, style: "keep", clipped: ["bottom"] });
    const response = await request(`companions/${made.value.id}/look/complete`, adult, "POST", { version_id: source.id }), job = (await response.json() as { job: string }).job;
    const state = await (await request(`companions/${made.value.id}/look/jobs/${job}`, adult)).json() as { versions: Array<{ id: string }> };
    expect(readLook(made.value.id).versions.find((version) => version.id === state.versions[0]?.id)?.style).toBe("keep");
  });

  test("complete refuses a centered image, children and non-authors", async () => {
    const adult = addPerson("complete-gate-author", "adult"), other = addPerson("complete-gate-other", "adult"), child = addPerson("complete-gate-child", "child"), made = createHouseholdCompanion({ ...fixture(), display_name: "Complete gates" }, { display_name: "Author", person_id: "complete-gate-author" }); if (!made.ok) throw new Error(made.error);
    const center = addVersion(made.value.id, await transparentPng(), { source: "upload", label: "Centered", width: 1024, height: 1024, from: null });
    const noOp = await request(`companions/${made.value.id}/look/complete`, adult, "POST", { version_id: center.id }); expect(noOp.status).toBe(409); expect(await noOp.json()).toEqual({ error: "Nothing is cut off in this picture." });
    const cut = addVersion(made.value.id, await clippedPng("bottom"), { source: "upload", label: "Cut", width: 1024, height: 1024, from: null });
    expect((await request(`companions/${made.value.id}/look/complete`, child, "POST", { version_id: cut.id })).status).toBe(403);
    expect((await request(`companions/${made.value.id}/look/complete`, other, "POST", { version_id: cut.id })).status).toBe(403);
  });

  test("complete trusts the stored cut-off edges of a picture that was already fitted into the frame", async () => {
    const adult = addPerson("complete-fitted-author", "adult"), made = createHouseholdCompanion({ ...fixture(), display_name: "Fitted complete" }, { display_name: "Author", person_id: "complete-fitted-author" }); if (!made.ok) throw new Error(made.error);
    __setPictureStatusForTests(readyStatusForTests()); __setAgeCheckRunnerForTests(async (images) => images.map(() => AGE_OK));
    __setPicturesFetchForTests((async (_input, init) => init?.method === "POST" ? Response.json({ job: "fitted-job" }, { status: 202 }) : new Response("Not found", { status: 404 })) as typeof fetch);
    const fitted = addVersion(made.value.id, await transparentPng(), { source: "upload", label: "Fitted", width: 1024, height: 1024, from: null, style: "keep", clipped: ["bottom"] });
    const response = await request(`companions/${made.value.id}/look/complete`, adult, "POST", { version_id: fitted.id });
    expect(response.status).toBe(202);
  });

  test("complete screens teen uploaded inputs and withholds unsafe results without saving", async () => {
    const teen = addPerson("complete-teen-author", "teen"), made = createHouseholdCompanion({ ...fixture(), display_name: "Teen complete", audience: "teen" }, { display_name: "Teen", person_id: "complete-teen-author" }); if (!made.ok) throw new Error(made.error);
    const source = addVersion(made.value.id, await clippedPng("bottom"), { source: "upload", label: "Uploaded", width: 1024, height: 1024, from: null, style: "keep" });
    __setAgeCheckRunnerForTests(async (images) => images.map(() => AGE_WITHHELD)); __setPictureStatusForTests(readyStatusForTests()); let edits = 0;
    __setPicturesFetchForTests((async (_input, init) => { if (init?.method === "POST") edits++; return Response.json({ job: "should-not-submit" }, { status: 202 }); }) as typeof fetch);
    const before = readLook(made.value.id).versions.length, refused = await request(`companions/${made.value.id}/look/complete`, teen, "POST", { version_id: source.id });
    expect(refused.status).toBe(422); expect(edits).toBe(0); expect(readLook(made.value.id).versions).toHaveLength(before);
    const adult = addPerson("complete-withheld-author", "adult"), otherHouse = createHouseholdCompanion({ ...fixture(), display_name: "Withheld complete" }, { display_name: "Adult", person_id: "complete-withheld-author" }); if (!otherHouse.ok) throw new Error(otherHouse.error);
    const input = addVersion(otherHouse.value.id, await clippedPng("bottom"), { source: "generated", label: "Cut generated", width: 1024, height: 1024, from: null });
    __setAgeCheckRunnerForTests(async (images) => images.map(() => AGE_WITHHELD)); __setPicturesFetchForTests((async (url, init) => { const target = String(url); if (target.endsWith("/v1/images/edits") && init?.method === "POST") return Response.json({ job: "complete-withheld-job" }, { status: 202 }); if (target.endsWith("/complete-withheld-job")) return Response.json({ job: "complete-withheld-job", state: "done", progress: 1, data: [] }); if (target.endsWith("/complete-withheld-job/0.png")) return new Response(await transparentPng(), { headers: { "content-type": "image/png" } }); return new Response("Not found", { status: 404 }); }) as typeof fetch);
    const count = readLook(otherHouse.value.id).versions.length, started = await request(`companions/${otherHouse.value.id}/look/complete`, adult, "POST", { version_id: input.id }), job = (await started.json() as { job: string }).job;
    const failed = await request(`companions/${otherHouse.value.id}/look/jobs/${job}`, adult); expect((await failed.json() as { state: string }).state).toBe("failed"); expect(readLook(otherHouse.value.id).versions).toHaveLength(count);
  });

  test("withheld picture approval leaves the selected starting picture unchanged", async () => {
    const adult = addPerson("approve-author", "adult"), made = createHouseholdCompanion({ ...fixture(), display_name: "Approve fixture" }, { display_name: "Author", person_id: "approve-author" }); if (!made.ok) throw new Error(made.error);
    const png = await transparentPng(), first = addVersion(made.value.id, png, { source: "upload", label: "First", width: 1024, height: 1024, from: null }), next = addVersion(made.value.id, new Uint8Array(await sharp(png).modulate({ hue: 12 }).png().toBuffer()), { source: "upload", label: "Next", width: 1024, height: 1024, from: null });
    setRest(made.value.id, first.id); __setAgeCheckRunnerForTests(async (images) => images.map(() => AGE_WITHHELD));
    const response = await request(`companions/${made.value.id}/look/approve`, adult, "POST", { version_id: next.id });
    expect(response.status).toBe(422); expect(readLook(made.value.id).rest).toBe(first.id); expect(readLook(made.value.id).sheet).toBeNull();
  });

  test("approving the picture that is already approved with a finished sheet starts nothing new", async () => {
    const adult = addPerson("reapprove-author", "adult"), made = createHouseholdCompanion({ ...fixture(), display_name: "Reapprove fixture" }, { display_name: "Author", person_id: "reapprove-author" }); if (!made.ok) throw new Error(made.error);
    const picture = addVersion(made.value.id, await transparentPng(), { source: "upload", label: "Only", width: 1024, height: 1024, from: null });
    setRest(made.value.id, picture.id); __setAgeCheckRunnerForTests(async (images) => images.map(() => AGE_OK)); __setPictureStatusForTests(readyStatusForTests());
    updateSheet(made.value.id, { views: { left: null, right: null, mouth: null }, card: { text: "A character", colours: [], species: "" }, key: readLook(made.value.id).key, state: "approved", approved_by: "Author", approved_at: new Date().toISOString() });
    let posts = 0; __setPicturesFetchForTests((async (_input, init) => { if (init?.method === "POST") posts++; return Response.json({ job: "never" }, { status: 202 }); }) as typeof fetch);
    const response = await request(`companions/${made.value.id}/look/approve`, adult, "POST", { version_id: picture.id });
    expect(response.status).toBe(202); expect(await response.json()).toEqual({ job: null }); expect(posts).toBe(0); expect(readLook(made.value.id).sheet?.state).toBe("approved");
  });

  test("approving a cut-off starting picture draws the missing body first and makes the drawn picture the starting picture", async () => {
    const adult = addPerson("approve-fill-author", "adult"), made = createHouseholdCompanion({ ...fixture(), display_name: "Approve fill fixture" }, { display_name: "Author", person_id: "approve-fill-author" }); if (!made.ok) throw new Error(made.error);
    const cut = await clippedPng("bottom"), returned = await transparentPng(); __setPictureStatusForTests(readyStatusForTests()); __setAgeCheckRunnerForTests(async (images) => images.map(() => AGE_OK));
    const instructions: string[] = [];
    __setPicturesFetchForTests((async (input, init) => {
      const url = String(input);
      if (url.endsWith("/v1/images/edits") && init?.method === "POST") { instructions.push(String((init.body as FormData).get("instruction"))); return Response.json({ job: "fill-job" }, { status: 202 }); }
      if (url.endsWith("/fill-job")) return Response.json({ job: "fill-job", state: "done", progress: 1, data: [] });
      if (url.endsWith("/fill-job/0.png")) return new Response(returned, { headers: { "content-type": "image/png" } });
      return new Response("Not found", { status: 404 });
    }) as typeof fetch);
    const source = addVersion(made.value.id, cut, { source: "upload", label: "Cut picture", width: 1024, height: 1024, from: null, style: "keep", clipped: ["bottom"] });
    await request(`companions/${made.value.id}/look/approve`, adult, "POST", { version_id: source.id });
    expect(instructions[0]).toContain("at the bottom");
    const look = readLook(made.value.id), rest = look.versions.find((version) => version.id === look.rest)!;
    expect(rest.id).not.toBe(source.id); expect(rest).toMatchObject({ source: "edit", from: source.id, clipped: [] });
  });

  test("restyle reuses the picture edit job and stores the selected style", async () => {
    const adult = addPerson("restyle-author", "adult"), made = createHouseholdCompanion({ ...fixture(), display_name: "Restyle fixture" }, { display_name: "Author", person_id: "restyle-author" }); if (!made.ok) throw new Error(made.error);
    const image = await transparentPng(), original = await keyedPicture(); __setPictureStatusForTests(readyStatusForTests()); __setAgeCheckRunnerForTests(async (images) => images.map(() => AGE_OK));
    __setPicturesFetchForTests((async (input, init) => { const url = String(input); if (url.endsWith("/v1/images/edits") && init?.method === "POST") return Response.json({ job: "restyle-job" }, { status: 202 }); if (url.endsWith("/restyle-job")) return Response.json({ job: "restyle-job", state: "done", progress: 1, data: [] }); if (url.endsWith("/restyle-job/0.png")) return new Response(image, { headers: { "content-type": "image/png" } }); return new Response("Not found", { status: 404 }); }) as typeof fetch);
    const source = addVersion(made.value.id, image, { source: "generated", label: "Source", width: 1024, height: 1024, from: null }, original);
    const response = await request(`companions/${made.value.id}/look/restyle`, adult, "POST", { version_id: source.id, style: "anime" }); expect(response.status).toBe(202);
    const job = (await response.json() as { job: string }).job, poll = await request(`companions/${made.value.id}/look/jobs/${job}`, adult), body = await poll.json() as { state: string; versions: Array<{ id: string }> };
    expect(body.state).toBe("done"); expect(readLook(made.value.id).versions.find((item) => item.id === body.versions[0]?.id)?.style).toBe("anime");
  });

  test("prepare reports the missing background remover sentence and stores nothing", async () => {
    const adult = addPerson("prepare-missing-tool", "adult"), made = createHouseholdCompanion({ ...fixture(), display_name: "Missing remover fixture" }, { display_name: "Author", person_id: "prepare-missing-tool" }); if (!made.ok) throw new Error(made.error);
    const image = await keyedPicture(), original = addVersion(made.value.id, image, { source: "upload", label: "Opaque source", width: 512, height: 512, from: null });
    __setImageToolsForTests({ state: "idle", phase: null, vision: false, models: { isnet: false, lama: true, esrgan: true }, limits: {}, operations: ["resize"], reason: null } satisfies StackImageToolsStatus);
    const response = await request(`companions/${made.value.id}/look/prepare`, adult, "POST", { version_id: original.id, remove_background: true });
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: "The background remover isn't installed. Install it from the engine's model list, then try again." }); expect(readLook(made.value.id).versions).toHaveLength(1);
  });
});

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHouseholdCompanion } from "@/lib/householdCompanions";
import { loadManifestOnly } from "@/lib/plugins";
import { addTake, readStates, __parseStatesForTests, takePath } from "@/lib/companionStates";
import { addVersion, readLook, updateSheet, setRest, versionPath } from "@/lib/companionLook";
import { resolveCompanionStillFromStatus, stackVideoModel, resolveCompanionClipFromStatus, resolveCompanionEdit, promptHash, COMPANION_MODEL_MISMATCH_LINE, __setCompanionArtStatusReadersForTests } from "@/lib/companionArt";
import { startLookGeneration, startLookEdit, __clearCompanionLookJobsForTests } from "@/lib/companionLookJobs";
import { startStateTakes, __clearCompanionTakeRunsForTests } from "@/lib/companionTakes";
import { __setPicturesFetchForTests } from "@/lib/pictures/stack";
import { __setVideosFetchForTests } from "@/lib/videos/stack";
import { readyStatusForTests, __setPictureStatusForTests } from "@/lib/pictures/ready";
import { readyVideoStatusForTests, __setVideoStatusForTests } from "@/lib/videos/ready";
import { __setStackClientForTests } from "@/lib/stackEngine";
import { db } from "@/db";
import { settingsValues } from "@/db/schema";
import { setHouseholdSettingValue } from "@/lib/settings";
import sharp from "sharp";
import media from "@maipai/spec/vocab/companion-media.json";

const dataRoot = process.env.MAIPAI_DATA_DIR!;
const root = join(dataRoot, "companions");
const fixture = loadManifestOnly("rivet");
if (!fixture.ok || !fixture.value.companion) throw new Error("rivet fixture is unavailable");

beforeEach(() => { rmSync(root, { recursive: true, force: true }); db.delete(settingsValues).run(); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); db.delete(settingsValues).run(); __setPictureStatusForTests(undefined); __setVideoStatusForTests(undefined); __setCompanionArtStatusReadersForTests(null); __setStackClientForTests(null); __setPicturesFetchForTests(null); __setVideosFetchForTests(null); __clearCompanionLookJobsForTests(); __clearCompanionTakeRunsForTests(); });

describe("companion art model resolution", () => {
  test("still honors household quality and refuses unavailable Detailed", () => {
    const set = (key: string, value: unknown) => setHouseholdSettingValue(key, value);
    set("generation.picture_quick_model", "ernie");
    const ernie = readyStatusForTests({ models: [{ id: "flux2-klein-4b", installed: true }, { id: "ernie-image-turbo", installed: true }] as never });
    expect(resolveCompanionStillFromStatus(ernie)).toEqual({ model: "ernie-image-turbo", quality: "quick" });
    set("generation.picture_quick_model", "klein");
    const klein = resolveCompanionStillFromStatus(readyStatusForTests());
    expect(klein.model).toBe("flux2-klein-4b");
    set("generation.picture_quality", "detailed"); set("generation.picture_quick_model", "ernie");
    const detailed = readyStatusForTests({ models: [{ id: "z-image-turbo", installed: true, available: true }] as never });
    expect(resolveCompanionStillFromStatus(detailed)).toEqual({ model: "z-image-turbo", quality: "detailed" });
    try { resolveCompanionStillFromStatus(readyStatusForTests({ models: [{ id: "z-image-turbo", installed: false, available: false }] as never })); throw new Error("expected refusal"); }
    catch (error) { expect((error as Error).message).toContain("Settings, AI and models"); expect((error as { status?: number }).status).toBe(503); }
  });

  test("the video request value is the Stack's own, never a status id", () => {
    expect(stackVideoModel({ model: "ltx-2-3-distilled-mlx", quality: "detailed" })).toBe("detailed");
    expect(stackVideoModel({ model: "fastwan2-2-ti2v-5b-mlx-bf16", quality: "quick" })).toBe("wan2.2-ti2v-5b-fastwan-mlx");
  });

  test("clip selects only picture-capable models and edit stays on Klein", () => {
    setHouseholdSettingValue("generation.video_quality", "quick");
    expect(resolveCompanionClipFromStatus(readyVideoStatusForTests())).toEqual({ model: "wan2.2-ti2v-5b-fastwan-mlx", quality: "quick" });
    setHouseholdSettingValue("generation.video_quality", "detailed");
    expect(resolveCompanionClipFromStatus(readyVideoStatusForTests({ detailed: "installed", detailedPicture: true }), "detailed")).toEqual({ model: "ltx-2-3-distilled-mlx", quality: "detailed" });
    // Teens and children are never sent to Detailed, even when the household default is Detailed.
    expect(resolveCompanionClipFromStatus(readyVideoStatusForTests({ detailed: "installed", detailedPicture: true }))).toEqual({ model: "fastwan2-2-ti2v-5b-mlx-bf16", quality: "quick" });
    expect(resolveCompanionClipFromStatus(readyVideoStatusForTests({ detailed: "installed" }), "detailed")).toEqual({ model: "fastwan2-2-ti2v-5b-mlx-bf16", quality: "quick" });
    expect(resolveCompanionEdit().model).toBe("flux2-klein-4b");
  });

  test("records model and prompt hash and old take JSON still parses", () => {
    const result = createHouseholdCompanion({ ...fixture.value.companion!, display_name: "Art test" }, { display_name: "Author", person_id: "art-test" });
    if (!result.ok) throw new Error(result.error);
    const id = result.value.id, hash = promptHash("fox");
    const version = addVersion(id, new Uint8Array([1]), { source: "generated", label: "Fox", width: 1024, height: 1024, from: null, model: "ernie-image-turbo", quality: "quick", prompt_hash: hash });
    const take = addTake(id, "idle", { source: "generated", label: "Fox", model: "wan2.2-ti2v-5b", quality: "quick", prompt_hash: hash });
    expect(readLook(id).versions[0]).toMatchObject({ model: "ernie-image-turbo", prompt_hash: hash });
    expect(readStates(id).states.idle?.takes[0]).toMatchObject({ model: "wan2.2-ti2v-5b", prompt_hash: hash });
    const json = JSON.parse(readFileSync(join(root, id, "states", "states.json"), "utf8"));
    delete json.states.idle.takes[0].model; delete json.states.idle.takes[0].quality; delete json.states.idle.takes[0].prompt_hash;
    expect(__parseStatesForTests(json).states.idle?.takes[0]?.model).toBeUndefined();
    expect(version.id).toBe("v-1"); expect(take.id).toBe("take-1");
  });

  test("guards submission source from implicit defaults", () => {
    const lookJobs = readFileSync(new URL("./companionLookJobs.ts", import.meta.url), "utf8");
    const takes = readFileSync(new URL("./companionTakes.ts", import.meta.url), "utf8");
    expect(lookJobs).not.toContain("QUICK_MODEL");
    expect(takes).toMatch(/submitVideo\(\{[\s\S]{0,400}?model:\s*stackVideoModel\(art\)/);
    expect(COMPANION_MODEL_MISMATCH_LINE).toBe("The engine used a different model than the one chosen. Try again.");
  });

  test("sends explicit models through generation, edit and take submissions", async () => {
    const result = createHouseholdCompanion({ ...fixture.value.companion!, display_name: "Submit model test" }, { display_name: "Author", person_id: "art-test" });
    if (!result.ok) throw new Error(result.error);
    const id = result.value.id, image = new Uint8Array(await sharp({ create: { width: 16, height: 16, channels: 4, background: "red" } }).png().toBuffer());
    const v = addVersion(id, image, { source: "upload", label: "Source", width: 16, height: 16, from: null });
    setHouseholdSettingValue("generation.picture_quality", "quick"); setHouseholdSettingValue("generation.picture_quick_model", "ernie");
    const imageStatus = readyStatusForTests({ models: [{ id: "flux2-klein-4b", installed: true, available: true }, { id: "ernie-image-turbo", installed: true, available: true }] as never });
    __setPictureStatusForTests(imageStatus); __setCompanionArtStatusReadersForTests({ picture: async () => imageStatus, video: async () => readyVideoStatusForTests() }); __setPictureStatusForTests(imageStatus);
    const calls: Array<{ kind: string; model?: string }> = [];
    __setPicturesFetchForTests((async (_input, init) => {
      if (init?.method === "POST" && String(_input).includes("/v1/images/generations")) { const body = JSON.parse(String(init.body)); calls.push({ kind: "generation", model: body.model }); return Response.json({ job: "pic-job", data: [] }, { status: 202 }); }
      if (init?.method === "POST" && String(_input).includes("/v1/images/edits")) { const form = init.body as FormData; calls.push({ kind: "edit", model: String(form.get("model")) }); return Response.json({ job: `edit-${calls.length}` }, { status: 202 }); }
      if (String(_input).includes("/v1/images/generations/pic-job")) return Response.json({ job: "pic-job", state: "queued", data: [] });
      return new Response(image, { status: 200 });
    }) as typeof fetch);
    const actor = { id: "art-test", role: "admin" } as never;
    await startLookGeneration({ actor, companionId: id, lookPrompt: "a red fox", count: 1 });
    __clearCompanionLookJobsForTests();
    await startLookEdit({ actor, companionId: id, versionId: v.id, instruction: "make it blue" });
    __clearCompanionLookJobsForTests();
    expect(calls.filter((call) => call.kind === "generation" || call.kind === "edit").every((call) => typeof call.model === "string" && call.model.length > 0)).toBe(true);

    const rest = addVersion(id, image, { source: "generated", label: "Rest", width: 16, height: 16, from: null }); setRest(id, rest.id);
    writeFileSync(join(root, id, "look", `${rest.id}.orig.png`), image);
    updateSheet(id, { views: { left: null, right: null, mouth: null }, card: { text: "red fox", species: "fox", colours: ["#CC3322"] }, key: media.key.default, state: "approved", approved_by: "Author", approved_at: new Date().toISOString() });
    const home = join(dataRoot, "companions");
    __setStackClientForTests({ mediaRoots: async () => ({ read: [home], write: [home] }), setMediaRoots: async () => ({ read: [home], write: [home] }), submitJob: async () => { throw new Error("unexpected finishing job"); } } as never);
    __setVideosFetchForTests((async (_input, init) => {
      if (init?.method === "POST") { const body = JSON.parse(String(init.body)); calls.push({ kind: "video", model: body.model }); return Response.json({ job: "video-job", data: [] }, { status: 202 }); }
      return Response.json({ job: "video-job", state: "done", data: [{ model: "wan2.2-ti2v-5b-fastwan-mlx" }] });
    }) as typeof fetch);
    const videoStatus = readyVideoStatusForTests();
    __setCompanionArtStatusReadersForTests({ picture: async () => imageStatus, video: async () => videoStatus });
    setHouseholdSettingValue("generation.video_quality", "quick");
    const runId = await startStateTakes({ actor, companionId: id, states: ["idle"], count: 1 });
    expect(runId).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(calls.find((call) => call.kind === "video")?.model).toBe("wan2.2-ti2v-5b-fastwan-mlx");
  });

  test("marks a take failed when the completed clip reports a different model", async () => {
    expect(COMPANION_MODEL_MISMATCH_LINE).toBe("The engine used a different model than the one chosen. Try again.");
    const result = createHouseholdCompanion({ ...fixture.value.companion!, display_name: "Mismatch test" }, { display_name: "Author", person_id: "art-test" });
    if (!result.ok) throw new Error(result.error);
    const id = result.value.id, image = new Uint8Array(await sharp({ create: { width: 8, height: 8, channels: 4, background: "red" } }).png().toBuffer());
    const rest = addVersion(id, image, { source: "generated", label: "Rest", width: 8, height: 8, from: null }); setRest(id, rest.id); writeFileSync(join(root, id, "look", `${rest.id}.orig.png`), image);
    updateSheet(id, { views: { left: null, right: null, mouth: null }, card: { text: "red fox", species: "fox", colours: ["#CC3322"] }, key: media.key.default, state: "approved", approved_by: "Author", approved_at: new Date().toISOString() });
    const videoStatus = readyVideoStatusForTests(); __setVideoStatusForTests(videoStatus); __setCompanionArtStatusReadersForTests({ picture: async () => readyStatusForTests(), video: async () => videoStatus });
    const home = join(dataRoot, "companions");
    __setStackClientForTests({ mediaRoots: async () => ({ read: [home], write: [home] }), setMediaRoots: async () => ({ read: [home], write: [home] }), submitJob: async () => { throw new Error("unexpected finish should not run"); } } as never);
    __setVideosFetchForTests((async (_input, init) => init?.method === "POST" ? Response.json({ job: "mismatch-job", data: [] }, { status: 202 }) : Response.json({ job: "mismatch-job", state: "done", data: [{ model: "wrong-model" }] })) as typeof fetch);
    setHouseholdSettingValue("generation.video_quality", "quick");
    await startStateTakes({ actor: { id: "art-test", role: "admin" } as never, companionId: id, states: ["idle"], count: 1 });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const take = readStates(id).states.idle?.takes[0];
    expect(take?.failure).toBe(COMPANION_MODEL_MISMATCH_LINE);
    expect(take?.model_reported).toBeUndefined();
    expect(takePath(id, "idle", take!.id, "source.mp4")).toBeTruthy();
  });
});

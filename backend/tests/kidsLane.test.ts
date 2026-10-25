// KIDS-CREATE-01 (owner ruling 2026-10-17: "Kids can make cartoon images and videos of safe content"): the strict child lane. A child makes
// cartoon pictures and videos of safe things, Quick only, with the cartoon look forced, a child-safe topic gate in ONE friendly line, no photos,
// no references, no real people, edits only of their own cartoons, a daily limit, a switch for the home and one per child, a child-safety check on
// every finished item that fails closed, and an admin log. A teen and an adult are unaffected.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { kidUsage, people as peopleTable, pictureJobs } from "@/db/schema";
import { setHouseholdSettingValue, setValue } from "@/lib/settings";
import { createBenchPeople, type BenchPeople } from "../scripts/bench/conversationRunner";
import { removeTemporaryChatImages, storeTemporaryChatImage } from "@/lib/attachments";
import { runGenerateImage } from "@/lib/pictures/tool";
import { runGenerateVideo } from "@/lib/videos/tool";
import { __resetVideoJobsForTests, startVideoJob } from "@/lib/videos/jobs";
import { releaseHouseholdQueue } from "@/lib/jobs/householdQueue";
import { getPictureJob } from "@/lib/pictures/jobs";
import { saveJob } from "@/lib/pictures/jobStore";
import { __setAgeCheckRunnerForTests, MINOR_VIEWER_LINE } from "@/lib/pictures/ageCheck";
import { CHILD_CONTENT_LINE, CHILD_LIMIT_LINE, CHILD_NEGATIVE_PROMPT, CHILD_NO_PHOTOS_LINE, CHILD_PROMPT_PREFIX, CHILD_VIDEO_LIMIT_LINE, childPromptUnsafe, laneOf, picturesMadeToday, teenPromptUnsafe, videoModelForLane, videosMadeToday, WAN_QUICK_VIDEO_MODEL } from "@/lib/pictures/lane";
import { __setChildSafetyRunnerForTests, type ChildSafetyCheck } from "@/lib/pictures/laneGate";
import { adapterAudiencesFor } from "@/lib/pictures/policy";
import { editToolsStatus, loadSource, startComment } from "@/lib/imageEdit";
import { __setPhotoInspectorForTests } from "@/lib/likeness/inspector";
import { __setStackTrustForTests } from "@/lib/likeness/proof";
import { __resetAttestationsForTests } from "@/lib/likeness/resolve";
import { toolSpecFor } from "@/lib/turnMachine/nodes/model";
import { TestClient } from "./client";
import { installFakeImageStack, testPng, until, type FakeImageStack } from "./pictureFixture";
import { installFakeVideoStack, type FakeVideoStack } from "./videoFixture";
import type { PersonRow } from "@/types";
import type { ToolExecutionOutcome } from "@/lib/turnMachine/contract";

let bench: BenchPeople;
let kid: PersonRow;
let teen: PersonRow;
let image: FakeImageStack;
let video: FakeVideoStack;

function addPerson(name: string, role: string): PersonRow {
  const now = new Date().toISOString();
  db.insert(peopleTable).values({ id: `p-${name.toLowerCase()}`, displayName: name, role, avatarSeed: name, source: "test", createdAt: now, updatedAt: now, hlc: "1:0:test00" }).run();
  return db.select().from(peopleTable).where(eq(peopleTable.id, `p-${name.toLowerCase()}`)).get()! as PersonRow;
}
const SAFE: ChildSafetyCheck = { ok: true, verdict: { is_cartoon: true, looks_like_photo: false, real_person_or_brand: false, violent_or_scary: false, sexual_or_romantic: false, weapons_drugs_or_alcohol: false, confidence: 0.9 } };
const safeRunner = (check: ChildSafetyCheck = SAFE) => async (images: readonly Uint8Array[]) => images.map(() => check);

beforeEach(() => {
  resetDb();
  bench = createBenchPeople();
  kid = addPerson("Pippa", "child");
  teen = addPerson("Rill", "teen");
  image = installFakeImageStack();
  video = installFakeVideoStack();
  __setStackTrustForTests({ ok: true });
  __setPhotoInspectorForTests(async () => ({ people: 1, faces: 1, under18: "yes" }));
  __resetAttestationsForTests();
  __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { people_count: 0, apparent_min_age_estimate: null, label: "none" as const, is_nude_or_sexual: false, confidence: 1 } })));
  __setChildSafetyRunnerForTests(safeRunner());
});
afterEach(() => { __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { people_count: 0, apparent_min_age_estimate: null, label: "none" as const, is_nude_or_sexual: false, confidence: 1 } }))); removeTemporaryChatImages("conv-1"); image.restore(); video.restore(); __setStackTrustForTests(null); __setPhotoInspectorForTests(undefined); __setChildSafetyRunnerForTests(null); setHouseholdSettingValue("generation.kids", true); setHouseholdSettingValue("generation.people_prompts", false); });

type Img = { id: string; name: string; width: number; height: number; media_type: string };
async function put(owner: PersonRow, id: string, generated = false): Promise<Img> {
  storeTemporaryChatImage({ id, turnId: "turn-1", conversationId: "conv-1", ownerPersonId: owner.id, name: `${id}.png`, mediaType: "image/png", width: 64, height: 64, bytes: await testPng(), ...(generated ? { generated: true as const } : {}) });
  return { id, name: `${id}.png`, width: 64, height: 64, media_type: "image/png" };
}
function stateFor(actor: PersonRow, images: Img[] = [], utterance = "") {
  return { actor, surface: "chat" as never, speakerEvidence: undefined, planBasis: { surfaceClass: "written" } as never, plan: undefined as never, conversationId: "conv-1", turnId: `turn-${Math.random()}`, temporary: true, ephemeral: false, images, utterance } as never;
}
const pic = (actor: PersonRow, args: Record<string, unknown>, images: Img[] = [], utterance = "") => runGenerateImage({ state: stateFor(actor, images, utterance), args, callId: "c1", spoken: false });
const vid = (actor: PersonRow, args: Record<string, unknown>, images: Img[] = [], utterance = "") => runGenerateVideo({ state: stateFor(actor, images, utterance), args, callId: "c2", spoken: false });
const text = (o: ToolExecutionOutcome) => (o.result?.reply as { text?: string } | undefined)?.text ?? "";
const jobId = (o: ToolExecutionOutcome) => (o.result?.data as { pictureJobId?: string }).pictureJobId!;
const finish = async (actor: PersonRow, o: ToolExecutionOutcome) => { await until(() => ["done", "failed"].includes(getPictureJob(actor, jobId(o))?.state ?? "")); return getPictureJob(actor, jobId(o))!; };

describe("a child makes cartoon pictures", () => {
  test("a friendly dragon works: the cartoon look is forced, Quick only, all-ages, no style, no friction text", async () => {
    expect(laneOf({ actor: kid, band: "child" })).toBe("child");
    setHouseholdSettingValue("generation.people_prompts", true);
    const o = await pic(kid, { prompt: "a friendly dragon", style: "Pixel Art", quality: "detailed", count: 4 });
    expect(o.status).toBe("succeeded");
    expect(text(o)).toContain("Do not add warnings");
    expect(toolSpecFor("generate_image", "child")!.description).toContain("Do not add warnings");
    const sent = image.submitted[0]! as { prompt: string; negative_prompt: string; audience: string; n: number; model?: string; loras?: unknown };
    expect(sent.prompt.startsWith(CHILD_PROMPT_PREFIX)).toBe(true);
    expect(sent.prompt).toContain("a friendly dragon");
    expect(sent.negative_prompt).toBe(CHILD_NEGATIVE_PROMPT);
    expect(sent).toMatchObject({ audience: "all-ages", n: 2, model: "flux2-klein-4b" });
    expect(sent.loras).toBeUndefined();
    const job = await finish(kid, o);
    expect(job.state).toBe("done");
    expect(adapterAudiencesFor({ actor: kid, band: "child", surface: "chat" as never, surfaceClass: "written" as never, spoken: false })).toEqual(["all-ages"]);
  });

  test("a photoreal request becomes a cartoon request", async () => {
    await pic(kid, { prompt: "a photorealistic photograph of a puppy in a park" });
    const sent = image.submitted[0]! as { prompt: string; negative_prompt: string };
    expect(sent.prompt.startsWith(CHILD_PROMPT_PREFIX)).toBe(true);
    expect(sent.negative_prompt).toContain("photograph");
  });

  test("a real person, a brand, violence and grown-up things are one friendly line, never a lecture, and nothing is sent", async () => {
    for (const args of [
      { prompt: "a picture of a famous singer", depicts_real_person: true },
      { prompt: "a dragon wearing a Disney princess dress" },
      { prompt: "a knight fight with swords and blood" },
      { prompt: "a scary zombie in a graveyard" },
      { prompt: "a sexy woman in lingerie" },
      { prompt: "a romantic dinner with wine" },
      { prompt: "a girl with no clothes on" },
    ]) {
      const o = await pic(kid, args);
      expect(text(o)).toContain(CHILD_CONTENT_LINE);
      expect(text(o).length).toBeLessThan(260);
    }
    expect(image.submitted).toHaveLength(0);
    expect(childPromptUnsafe("a friendly dragon with a balloon")).toBe(false);
  });

  test("nothing sexual involving a minor is still the absolute line first", async () => {
    // The absolute line runs first; a child reads the one kid-safe line, never the words about what was found.
    const refused = text(await pic(kid, { prompt: "a naked child on a beach" }));
    expect(refused).toContain(MINOR_VIEWER_LINE);
    expect(refused).not.toContain("sexual");
    expect(image.submitted).toHaveLength(0);
  });

  test("a photo cannot be used: attached, changed or animated", async () => {
    const photo = await put(kid, "photo-1");
    expect(text(await pic(kid, { prompt: "make the sky pink", change: "attached" }, [photo]))).toContain(CHILD_NO_PHOTOS_LINE);
    expect(text(await vid(kid, { prompt: "make it move", from_picture: "attached" }, [photo]))).toContain(CHILD_NO_PHOTOS_LINE);
    expect(text(await pic(kid, { prompt: "add her", change: "latest", reference: "attached", photo_subject: "me" }, [photo]))).toContain(CHILD_NO_PHOTOS_LINE);
    expect(image.submitted).toHaveLength(0);
    expect(image.edits).toHaveLength(0);
    expect(video.submitted).toHaveLength(0);
  });

  test("edits work only on their own generated cartoons, in words, and stay cartoon", async () => {
    await put(kid, "toon-1", true);
    const ok = await pic(kid, { prompt: "make the dragon green", change: "latest" });
    expect(ok.status).toBe("succeeded");
    expect(String(image.edits[0]!.instruction)).toContain("friendly children's cartoon");
    expect(image.edits[0]).toMatchObject({ image_source: "generated" });
    await finish(kid, ok);
    expect(text(await pic(kid, { prompt: "take off the dragon's clothes", change: "latest" }))).toContain(CHILD_CONTENT_LINE);
    // The editor: open on a cartoon, closed on a photo; no painted area, no second picture, no named person.
    const status = await editToolsStatus(kid);
    expect(status.tools.comment.enabled).toBe(true);
    expect(loadSource(kid, "conv-1", "toon-1", true).id).toBe("toon-1");
    await put(kid, "photo-2");
    expect(() => loadSource(kid, "conv-1", "photo-2", true)).toThrow();
    await expect(startComment(kid, "conv-1", "toon-1", { prompt: "make it blue", referenceId: "photo-2" })).rejects.toMatchObject({ status: 422 });
    await expect(startComment(kid, "conv-1", "toon-1", { prompt: "make it blue", maskPng: new Uint8Array([1, 2, 3]) })).rejects.toMatchObject({ status: 422 });
  });
});

describe("a child makes cartoon videos", () => {
  test("a short cartoon, Quick, no style, forced look, within a daily limit", async () => {
    const o = await vid(kid, { prompt: "a friendly dragon waving", seconds: 5, style: "Old Colour Film" });
    expect(o.status).toBe("succeeded");
    const sent = video.submitted[0]! as { prompt: string; seconds: number; audience: string; loras?: unknown; negative_prompt: string };
    expect(sent.prompt.startsWith(CHILD_PROMPT_PREFIX)).toBe(true);
    expect(sent.seconds).toBeLessThanOrEqual(3);
    expect(sent).toMatchObject({ audience: "all-ages", negative_prompt: CHILD_NEGATIVE_PROMPT });
    expect(sent.loras).toBeUndefined();
    setHouseholdSettingValue("generation.kids_daily_videos", 1);
    expect(text(await vid(kid, { prompt: "a friendly dragon dancing" }))).toContain(CHILD_VIDEO_LIMIT_LINE);
    expect(video.submitted).toHaveLength(1);
    expect(text(await vid(kid, { prompt: "a dragon with a sword and blood" }))).toContain(CHILD_CONTENT_LINE);
  });
});

describe("limits and switches", () => {
  test("the daily limit stops the next picture with one friendly line, and an admin can change it", async () => {
    setHouseholdSettingValue("generation.kids_daily_pictures", 2);
    const first = await pic(kid, { prompt: "a friendly dragon", count: 2 });
    expect(first.status).toBe("succeeded");
    await finish(kid, first);
    expect(text(await pic(kid, { prompt: "a friendly turtle" }))).toContain(CHILD_LIMIT_LINE);
    setHouseholdSettingValue("generation.kids_daily_pictures", 5);
    const more = await pic(kid, { prompt: "a friendly turtle" });
    expect(more.status).toBe("succeeded");
    // A teen has no such limit.
    setHouseholdSettingValue("generation.kids_daily_pictures", 0);
    expect((await pic(teen, { prompt: "a red fox" })).status).toBe("succeeded");
  });

  test("the home switch and the child's own switch each block, with the profile line", async () => {
    setHouseholdSettingValue("generation.kids", false);
    expect(text(await pic(kid, { prompt: "a friendly dragon" }))).toContain("off for this profile");
    expect(text(await vid(kid, { prompt: "a friendly dragon" }))).toContain("off for this profile");
    setHouseholdSettingValue("generation.kids", true);
    expect((await pic(kid, { prompt: "a friendly dragon" })).status).toBe("succeeded");
    await until(() => true);
    expect(setValue(bench.owner, `person:${kid.id}`, "generation.kid_enabled", false).ok).toBe(true);
    expect(text(await pic(kid, { prompt: "a friendly dragon" }))).toContain("off for this profile");
    expect(image.submitted).toHaveLength(1);
  });
});

describe("the finished item is checked and fails closed", () => {
  test("not a cartoon, a real photo, a brand, scary, sexual or no answer: withheld with one friendly line and an admin note", async () => {
    for (const check of [
      { ...SAFE, verdict: { ...SAFE.verdict!, is_cartoon: false } },
      { ...SAFE, verdict: { ...SAFE.verdict!, looks_like_photo: true } },
      { ...SAFE, verdict: { ...SAFE.verdict!, real_person_or_brand: true } },
      { ...SAFE, verdict: { ...SAFE.verdict!, violent_or_scary: true } },
      { ...SAFE, verdict: { ...SAFE.verdict!, sexual_or_romantic: true } },
      { ...SAFE, verdict: { ...SAFE.verdict!, confidence: 0.2 } },
      { ok: false as const, why: "unavailable" as const },
    ] as unknown as ChildSafetyCheck[]) {
      __setChildSafetyRunnerForTests(safeRunner(check));
      const job = await finish(kid, await pic(kid, { prompt: "a friendly dragon" }));
      expect(job.state).toBe("failed");
      expect(job.error).toBe(CHILD_CONTENT_LINE);
      expect(job.files).toEqual([]);
    }
    // The apparent-age check saying nude or sexual withholds too, and a check that could not run does.
    __setChildSafetyRunnerForTests(safeRunner());
    __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { people_count: 1, apparent_min_age_estimate: 30, label: "adult" as const, is_nude_or_sexual: true, confidence: 0.9 } })));
    expect((await finish(kid, await pic(kid, { prompt: "a friendly dragon" }))).error).toBe(CHILD_CONTENT_LINE);
    __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: false as const, why: "timeout" as const })));
    expect((await finish(kid, await pic(kid, { prompt: "a friendly dragon" }))).state).toBe("failed");
  });
});

describe("a teen and an adult are unaffected", () => {
  test("a teen's prompt is not made a cartoon and has no daily limit; an adult is untouched", async () => {
    await finish(teen, await pic(teen, { prompt: "a photo of a red fox in the snow" }));
    expect((image.submitted[0]! as { prompt: string }).prompt).toBe("a photo of a red fox in the snow");
    await finish(bench.owner, await pic(bench.owner, { prompt: "a battle scene with swords" }));
    expect((image.submitted[1]! as { prompt: string }).prompt).toBe("a battle scene with swords");
  });
});

describe("what the children made, for the admins", () => {
  test("an owner reads the words, the time and whether it was held back (no picture); a child cannot", async () => {
    resetDb();
    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const child = addPerson("Pippa", "child");
    const rill = addPerson("Rill", "teen");
    const now = new Date().toISOString();
    const base = { personId: child.id, conversationId: null, turnId: null, kind: "generate" as const, stackJob: null, percent: 100, phase: "ready", position: null, request: { size: "1024x1024", n: 1, seed: null, loras: [], source_file_id: null, audience: "all-ages" as const }, files: [], temporary: false, createdAt: now, updatedAt: now };
    saveJob({ ...base, id: "pj-1", state: "done", prompt: "a friendly dragon", error: null });
    saveJob({ ...base, id: "pj-2", state: "failed", prompt: "a friendly turtle", error: CHILD_CONTENT_LINE });
    db.insert(kidUsage).values([
      { id: "ku-1", personId: child.id, day: "2026-10-17", kind: "edit", units: 1, prompt: "make the dragon green", outcome: "asked", createdAt: now },
      { id: "ku-2", personId: child.id, day: "2026-10-17", kind: "edit", units: 1, prompt: "make the dragon scary", outcome: "withheld", createdAt: now },
      { id: "ku-3", personId: child.id, day: "2026-10-17", kind: "picture", units: 1, prompt: "a friendly dragon", outcome: "asked", createdAt: now },
      { id: "ku-4", personId: rill.id, day: "2026-10-17", kind: "photo", units: 0, prompt: "change my sweater to blue", outcome: "withheld", createdAt: now },
    ]).run();
    const res = await client.get("/api/pictures/admin/kids-activity");
    expect(res.status).toBe(200);
    const body = await res.json() as { items: Array<{ person: { name: string }; prompt: string; withheld: boolean; kind: string }>; daily_pictures: number; daily_videos: number };
    expect(body).toMatchObject({ daily_pictures: 20, daily_videos: 5 });
    expect(body.items.filter((i) => i.kind !== "photo").map((i) => [i.person.name, i.prompt, i.withheld]).sort()).toEqual([["Pippa", "a friendly dragon", false], ["Pippa", "a friendly turtle", true], ["Pippa", "make the dragon green", false], ["Pippa", "make the dragon scary", true]]);
    expect(JSON.stringify(body)).not.toContain("b64");
    expect(body.items.filter((i) => i.kind === "photo").map((i) => [i.person.name, i.prompt, i.withheld])).toEqual([["Rill", "change my sweater to blue", true]]);
    // A child cannot read it.
    db.update(peopleTable).set({ role: "child" }).where(eq(peopleTable.displayName, "Sage")).run();
    const { invalidateSessionCacheForPerson } = await import("@/middleware/auth");
    invalidateSessionCacheForPerson(db.select().from(peopleTable).where(eq(peopleTable.displayName, "Sage")).get()!.id);
    expect((await client.get("/api/pictures/admin/kids-activity")).status).toBe(403);
  });
});

// Lane safety review, 2026-10-17: edits count against the daily picture limit and are in the admin log; the limit is stored, counts every ask, and
// two asks at once cannot both pass.
describe("a child's edits count against the daily picture limit", () => {
  test("chat edits and editor edits take pictures from the same allowance and show in the admin log", async () => {
    setHouseholdSettingValue("generation.kids_daily_pictures", 3);
    await put(kid, "toon-1", true);
    const made = await pic(kid, { prompt: "a friendly dragon" });
    expect(made.status).toBe("succeeded");
    await finish(kid, made);
    const chatEdit = await pic(kid, { prompt: "make the dragon green", change: "latest" });
    expect(chatEdit.status).toBe("succeeded");
    await finish(kid, chatEdit);
    const editor = await startComment(kid, "conv-1", "toon-1", { prompt: "make it blue" });
    expect(editor.state).toBe("running");
    // Three used: one new, one chat edit, one editor edit.
    expect(picturesMadeToday(kid)).toBe(3);
    expect(text(await pic(kid, { prompt: "make the dragon red", change: "latest" }))).toContain(CHILD_LIMIT_LINE);
    await expect(startComment(kid, "conv-1", "toon-1", { prompt: "make it purple" })).rejects.toMatchObject({ status: 422, code: "daily_limit" });
    expect(text(await pic(kid, { prompt: "a friendly turtle" }))).toContain(CHILD_LIMIT_LINE);
    // A refused edit (a person, a photo) took nothing.
    expect(picturesMadeToday(kid)).toBe(3);
    // The admin log lists both edits with the words.
    const rows = db.select().from(kidUsage).where(eq(kidUsage.personId, kid.id)).all();
    expect(rows.filter((r) => r.kind === "edit").map((r) => r.prompt).sort()).toEqual(["make it blue", "make the dragon green"]);
  });

  test("an edit that was refused before it started gives the picture back", async () => {
    setHouseholdSettingValue("generation.kids_daily_pictures", 2);
    await put(kid, "toon-1", true);
    expect(text(await pic(kid, { prompt: "take off the dragon's clothes", change: "latest" }))).toContain(CHILD_CONTENT_LINE);
    expect(picturesMadeToday(kid)).toBe(0);
  });
});

describe("the daily limit is stored and atomic", () => {
  test("a failed ask, a deleted job and a restart give nothing back", async () => {
    setHouseholdSettingValue("generation.kids_daily_pictures", 2);
    const first = await pic(kid, { prompt: "a friendly dragon", count: 2 });
    expect(first.status).toBe("succeeded");
    await finish(kid, first);
    // Deleting the chat's jobs does not return the limit.
    db.delete(pictureJobs).run();
    expect(picturesMadeToday(kid)).toBe(2);
    expect(text(await pic(kid, { prompt: "a friendly turtle" }))).toContain(CHILD_LIMIT_LINE);
    // The count lives in the database, not in memory: a fresh read (as after a restart) sees it, and it belongs to today only.
    expect(picturesMadeToday(kid, new Date(Date.now() + 36 * 60 * 60 * 1000))).toBe(0);
  });

  test("a failed job still counts", async () => {
    setHouseholdSettingValue("generation.kids_daily_pictures", 1);
    image.failWith = { code: "failed", error: "The engine stopped." };
    const o = await pic(kid, { prompt: "a friendly dragon" });
    await finish(kid, o).catch(() => undefined);
    expect(picturesMadeToday(kid)).toBe(1);
    expect(text(await pic(kid, { prompt: "a friendly turtle" }))).toContain(CHILD_LIMIT_LINE);
  });

  test("two asks at once cannot both pass the last picture, for pictures and for videos", async () => {
    setHouseholdSettingValue("generation.kids_daily_pictures", 1);
    const both = await Promise.all([pic(kid, { prompt: "a friendly dragon" }), pic(kid, { prompt: "a friendly turtle" })]);
    expect(both.filter((o) => text(o).includes(CHILD_LIMIT_LINE))).toHaveLength(1);
    expect(image.submitted).toHaveLength(1);
    expect(picturesMadeToday(kid)).toBe(1);
    setHouseholdSettingValue("generation.kids_daily_videos", 1);
    const clips = await Promise.all([vid(kid, { prompt: "a friendly dragon waving" }), vid(kid, { prompt: "a friendly turtle waving" })]);
    expect(clips.filter((o) => text(o).includes(CHILD_VIDEO_LIMIT_LINE))).toHaveLength(1);
    expect(video.submitted).toHaveLength(1);
    expect(videosMadeToday(kid)).toBe(1);
  });

  test("a queued job refused by the Stack is recorded as a failed job and counts", async () => {
    setHouseholdSettingValue("generation.kids_daily_pictures", 1);
    image.refuseSubmit = { status: 503, code: "no_memory", error: "Not enough memory." };
    const o = await pic(kid, { prompt: "a friendly dragon" });
    expect(o.status).toBe("succeeded");
    const id = jobId(o);
    await until(() => getPictureJob(kid, id)?.state === "failed");
    expect(picturesMadeToday(kid)).toBe(1);
  });
});

describe("a child and a teen are only ever on the Quick video model", () => {
  test("the tool sends it for a child, and the job starter overrides any other model for a child or a teen, but not an adult", async () => {
    expect((await vid(kid, { prompt: "a friendly dragon waving" })).status).toBe("succeeded");
    expect((video.submitted[0] as { model?: string }).model).toBe(WAN_QUICK_VIDEO_MODEL);
    const start = async (actor: PersonRow, model?: string) => {
      const before = video.submitted.length;
      const job = await startVideoJob({ actor, conversationId: null, turnId: null, temporary: true, kind: "generate", prompt: "a friendly dragon", body: { prompt: "a friendly dragon", audience: "all-ages", ...(model ? { model } : {}) } });
      await releaseHouseholdQueue();
      await until(() => video.submitted.length > before);
      return job;
    };
    // Nothing a caller passes gets a young person onto another model (LTX with sound is not allowed to them).
    await start(teen, "ltx-2-sound");
    expect((video.submitted.at(-1) as { model?: string }).model).toBe(WAN_QUICK_VIDEO_MODEL);
    __resetVideoJobsForTests();
    await start(teen);
    expect((video.submitted.at(-1) as { model?: string }).model).toBe(WAN_QUICK_VIDEO_MODEL);
    expect(videoModelForLane("child", "ltx-2-sound")).toBe(WAN_QUICK_VIDEO_MODEL);
    expect(videoModelForLane("child")).toBe(WAN_QUICK_VIDEO_MODEL);
    // An adult's own choice stands, and no choice is left to the engine.
    expect(videoModelForLane("adult", "ltx-2-sound")).toBe("ltx-2-sound");
    expect(videoModelForLane("adult")).toBeUndefined();
    await start(bench.owner, "ltx-2-sound");
    expect((video.submitted.at(-1) as { model?: string }).model).toBe("ltx-2-sound");
  });
});

describe("VIDEO-LTX-01: Detailed (LTX, sound and speech) is unreachable for a teen or a child, on the server", () => {
  const sentModel = (i = -1) => (video.submitted.at(i) as { model?: string; size?: string; seconds?: number });
  test("the tool: asking for Detailed, a long clip or the household's Detailed default still sends a child the Quick model at the Quick size and the child's length", async () => {
    video.detailed = "installed";
    setHouseholdSettingValue("generation.video_quality", "detailed");
    const o = await vid(kid, { prompt: "a friendly dragon waving", quality: "detailed", seconds: 10 });
    expect(o.status).toBe("succeeded");
    expect(sentModel()).toMatchObject({ model: WAN_QUICK_VIDEO_MODEL, size: "832x480", seconds: 3 });
    expect(text(o)).not.toContain("Detailed video");
    setHouseholdSettingValue("generation.video_quality", "quick");
  });
  test("the job starter: a teen or a child asking for detailed (or the model's own id) is sent the Quick model; an adult's choice stands", async () => {
    video.detailed = "installed";
    const start = async (actor: PersonRow, model: string) => {
      const before = video.submitted.length;
      const job = await startVideoJob({ actor, conversationId: null, turnId: null, temporary: true, kind: "generate", prompt: "a friendly dragon", body: { prompt: "a friendly dragon", audience: "all-ages", model } as never });
      await releaseHouseholdQueue();
      await until(() => video.submitted.length > before);
      return job;
    };
    await start(teen, "detailed");
    expect(sentModel().model).toBe(WAN_QUICK_VIDEO_MODEL);
    __resetVideoJobsForTests();
    await start(kid, "ltx-2-3-distilled-mlx");
    expect(sentModel().model).toBe(WAN_QUICK_VIDEO_MODEL);
    __resetVideoJobsForTests();
    await start(bench.owner, "detailed");
    expect(sentModel().model).toBe("detailed");
    expect(videoModelForLane("teen", "detailed")).toBe(WAN_QUICK_VIDEO_MODEL);
  });
  test("the choice is forced to Quick for a teen or a child whatever was asked, and their card never offers Detailed", async () => {
    video.detailed = "installed";
    const { chooseVideoQuality } = await import("@/lib/videos/quality");
    const { readyVideoStatusForTests } = await import("@/lib/videos/ready");
    const { videoCardView } = await import("@/routes/videos");
    const engine = readyVideoStatusForTests({ detailed: "installed" });
    expect(chooseVideoQuality({ requested: "detailed", seconds: 10, engine, household: "detailed", quickOnly: true })).toMatchObject({ quality: "quick", seconds: 5, note: null });
    expect(chooseVideoQuality({ style: { base_model: "ltx-2.3" }, requested: "detailed", engine, quickOnly: true })).toMatchObject({ quality: "quick" });
    const o = await vid(teen, { prompt: "a dragon flying over a castle", quality: "detailed", seconds: 8 });
    expect(o.status).toBe("succeeded");
    expect(sentModel()).toMatchObject({ model: WAN_QUICK_VIDEO_MODEL, size: "832x480", seconds: 5 });
    const { getVideoJobFor } = await import("@/lib/videos/jobs");
    const id = (o.result?.data as { videoJobId: string }).videoJobId;
    const card = videoCardView(teen, getVideoJobFor(teen, id)!, true, { quick: true, detailed: false });
    expect(card.items[0]).toMatchObject({ quality: "quick", switch_to: null });
  });
});

describe("the child topic gate (lane review, 2026-10-17)", () => {
  const blocked = [
    "a knight with a sword", "a pirate with a cannon and a grenade", "a man with a chainsaw", "burning a village", "slaying the dragon", "a girl in a bikini", "a cartoon bong", "someone rolling a joint",
    "Pikachu at the beach", "Elsa building a snowman", "Mario jumping over a pipe", "Spider-Man on a roof", "a machine gun", "a vape pen", "a shotgun", "a robot in underwear", "dynamite blowing up a hill",
  ];
  const fine = ["a friendly dragon with a balloon", "a cat in a hat eating pizza", "a campfire with marshmallows", "a swordfish swimming", "a happy robot gardener", "a bunny who loves carrots", "a rocket ship to the moon", "a sunny day at the park"];
  test("each is one friendly line and nothing is sent", async () => {
    for (const prompt of blocked) {
      expect([prompt, childPromptUnsafe(prompt)]).toEqual([prompt, true]);
      expect([prompt, text(await pic(kid, { prompt })).includes(CHILD_CONTENT_LINE)]).toEqual([prompt, true]);
      expect([prompt, text(await vid(kid, { prompt })).includes(CHILD_CONTENT_LINE)]).toEqual([prompt, true]);
    }
    expect(image.submitted).toHaveLength(0);
    expect(video.submitted).toHaveLength(0);
  });
  test("ordinary safe ideas still pass", () => {
    for (const prompt of fine) expect([prompt, childPromptUnsafe(prompt)]).toEqual([prompt, false]);
  });
  test("a teen is not held to the character list, the weapons list or the child list, only to the adult and sexual gates", async () => {
    for (const prompt of ["Mario jumping over a pipe", "a knight with a sword", "Pikachu at the beach"]) {
      expect([prompt, teenPromptUnsafe(prompt)]).toEqual([prompt, false]);
    }
    expect((await pic(teen, { prompt: "Mario jumping over a pipe" })).status).toBe("succeeded");
    expect(teenPromptUnsafe("a girl in a bikini")).toBe(false);
    expect(teenPromptUnsafe("a naked woman")).toBe(true);
  });
});

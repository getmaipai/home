// VIDEO-CHAT-01 (C1 and C2, docs/design/video-chat-2026-11-02.md): the generate_video manifest declares what the Create page has, the old
// `quality` word still runs, and edit_video makes another take, a remix or a Max version through makeVideoFor (the Create page's own function),
// behind the same gates (rules 0, 1, 6).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { people, videoJobs } from "@/db/schema";
import sharp from "sharp";
import { createAttachment } from "@/lib/attachments";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { policyNode } from "@/lib/turnMachine/nodes/policy";
import { newConversationTurnId } from "@/lib/id";
import { logTurn, resolveOrCreateConversation } from "@/lib/conversationHistory";
import { getVideoJobFor, sourceVideoJob, type VideoJob } from "@/lib/videos/jobs";
import { VIDEO_LOOKS, VIDEO_RECIPES, VIDEO_VOICES, videoLookFor, videoRecipeFor } from "@/lib/videos/recipes";
import { EDIT_VIDEO_TOOL_ID, NO_CLIP_LINE, WHAT_TO_CHANGE_LINE, runEditVideo } from "@/lib/videos/editTool";
import { runGenerateVideo } from "@/lib/videos/tool";
import { MINOR_MAKE_LINE, bodyOfVideoJob } from "@/lib/videos/make";
import { MAX_NEEDS_ADMIN_LINE } from "@/lib/tiers";
import { __setVideoStatusForTests, readyVideoStatusForTests } from "@/lib/videos/ready";
import { __resetVideoAdapterCacheForTests } from "@/lib/videos/adapters";
import { installFakeVideoStack, type FakeVideoStack } from "./videoFixture";
import { until } from "./pictureFixture";
import type { PersonRow } from "@/types";
import type { TurnState } from "@/lib/turnMachine/contract";

let fake: FakeVideoStack;
beforeEach(() => {
  resetDb();
  __resetVideoAdapterCacheForTests();
  fake = installFakeVideoStack();
  fake.detailed = "installed";
  __setVideoStatusForTests(readyVideoStatusForTests({ detailed: "installed" }));
});
afterEach(() => { fake.restore(); __setVideoStatusForTests(undefined); });

function person(role: string, name = role): PersonRow {
  const now = new Date().toISOString();
  const id = `person-${name}xyz`;
  db.insert(people).values({ id, displayName: name, role, avatarSeed: name, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
  return db.select().from(people).where(eq(people.id, id)).get() as PersonRow;
}

function chatState(actor: PersonRow, conversationId?: string): TurnState {
  const conv = resolveOrCreateConversation(actor, "chat", conversationId, { temporary: false });
  if (!conv.ok) throw new Error("no conversation");
  const turnId = newConversationTurnId();
  // A clip waits for its turn's row before it is stored, as in a real chat where the row is written when the reply ends.
  logTurn(actor, "chat", "make a video", { reply: { text: "On its way." }, source: "plugin", plugin_id: "generate_video", routing: { tier: "tool", score: 1 }, safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() }, conversation_id: conv.value.id, turn_id: turnId });
  return { actor, surface: "chat", turnId, conversationId: conv.value.id, temporary: false, planBasis: { surfaceClass: "written" }, context: [], utterance: "make a video", persona: null, crisis: false } as unknown as TurnState;
}

const BOAT = "A paper boat floats down a rainy street, soft evening light";
const ids = (list: readonly { id: string }[]) => list.map((item) => item.id);

function manifest(id: string) {
  return JSON.parse(readFileSync(join(import.meta.dir, "..", "packages", id, "manifest.json"), "utf8")) as { version: string; offer: { gate: string; bench_row: string; reason: string }; min_role: string; args: { required: string[]; properties: Record<string, { enum?: string[]; minimum?: number; maximum?: number; description: string }> } };
}

/** Makes one clip in a chat and waits for it to finish; returns the job and the chat's state. */
async function makeClip(actor: PersonRow, args: Record<string, unknown> = { prompt: BOAT }): Promise<{ job: VideoJob; state: TurnState }> {
  const state = chatState(actor);
  const outcome = await runGenerateVideo({ state, args, callId: "make", spoken: false });
  const id = (outcome.result?.data as { videoJobId?: string } | undefined)?.videoJobId;
  if (!id) throw new Error(`no job: ${outcome.result?.reply?.text ?? outcome.detail}`);
  await until(() => getVideoJobFor(actor, id)?.state === "done");
  return { job: getVideoJobFor(actor, id)!, state: chatState(actor, state.conversationId!) };
}
const edit = (state: TurnState, args: Record<string, unknown>) => runEditVideo({ state, args, callId: "edit", spoken: false });
const jobOf = (actor: PersonRow, outcome: Awaited<ReturnType<typeof edit>>) => getVideoJobFor(actor, (outcome.result?.data as { videoJobId: string }).videoJobId)!;

describe("C1: generate_video declares what the Create page has", () => {
  test("look, camera, voices, tier and seconds are declared from the single lists; quality is no longer declared", () => {
    const m = manifest("generate_video");
    expect(m.version).toBe("0.3.0");
    const props = m.args.properties;
    expect(props.look!.enum).toEqual(ids(VIDEO_LOOKS));
    expect(props.camera!.enum).toEqual(ids(VIDEO_RECIPES));
    expect(props.voices!.enum).toEqual(ids(VIDEO_VOICES));
    expect(props.tier!.enum).toEqual(["standard", "boost", "max"]);
    expect(props.seconds).toMatchObject({ minimum: 1, maximum: 10 });
    expect(props.quality).toBeUndefined();
    expect(props.voices!.description).toContain("quotes");
    expect(props.voices!.description).toContain("one person speaks at a time");
    expect(props.look!.description).toContain("era and animation style");
  });

  test("an older call that sends quality still runs: detailed means Boost, quick means Standard", async () => {
    const actor = person("owner");
    const { job } = await makeClip(actor, { prompt: BOAT, quality: "detailed", seconds: 8 });
    expect(job.request.quality).toBe("detailed");
    expect(bodyOfVideoJob(job).tier).toBe("boost");
    expect(job.request.seconds).toBe(8);
    await until(() => getVideoJobFor(actor, job.id)?.state === "done");
    const quick = await makeClip(actor, { prompt: BOAT, quality: "quick" });
    expect(quick.job.request.quality).toBe("quick");
    expect(quick.job.request.tier).toBeUndefined();
  });

  test("camera wins over recipe; the look and camera wording reach the Stack and never the card", async () => {
    const actor = person("owner");
    const { job } = await makeClip(actor, { prompt: BOAT, look: "anime", camera: "handheld", recipe: "aerial", voices: "clean", tier: "boost" });
    expect(job.prompt).toBe(BOAT);
    const sent = String(fake.submitted[0]!.prompt);
    expect(sent).toStartWith(videoLookFor("anime")!.wording);
    expect(sent).toContain(videoRecipeFor("handheld")!.wording);
    expect(sent).not.toContain(videoRecipeFor("aerial")!.wording);
    expect(job.request.create).toMatchObject({ look: "anime", recipe: "handheld", voices: "clean" });
    const old = await makeClip(actor, { prompt: BOAT, recipe: "aerial" });
    expect(old.job.request.create?.recipe).toBe("aerial");
  });
});

describe("C2: edit_video", () => {
  test("the package declares the three changes, the gate, the bench row and a reason", () => {
    const m = manifest(EDIT_VIDEO_TOOL_ID);
    expect(m.args.required).toEqual(["clip", "change"]);
    expect(m.args.properties.change!.enum).toEqual(["another_take", "remix", "make_it_max"]);
    expect(m.args.properties.look!.enum).toEqual(ids(VIDEO_LOOKS));
    expect(m.args.properties.camera!.enum).toEqual(ids(VIDEO_RECIPES));
    expect(m.args.properties.voices!.enum).toEqual(ids(VIDEO_VOICES));
    for (const key of ["prompt", "tier", "seconds", "keep_seed"]) expect(m.args.properties[key]).toBeDefined();
    expect(m.offer).toMatchObject({ gate: "videoEditAllowed", bench_row: "video-edit-tool" });
    expect(m.offer.reason.length).toBeGreaterThan(10);
    expect(m.min_role).toBe("adult");
  });

  test("another_take: the same words and choices, a new job in the same chat, a new seed; the old clip stays", async () => {
    const actor = person("owner");
    const { job, state } = await makeClip(actor, { prompt: BOAT, look: "anime", camera: "dolly-in", orientation: "portrait" });
    const outcome = await edit(state, { clip: "latest", change: "another_take" });
    expect(outcome.status).toBe("succeeded");
    const next = jobOf(actor, outcome);
    expect(next.id).not.toBe(job.id);
    expect(next.conversationId).toBe(job.conversationId);
    expect(next.prompt).toBe(BOAT);
    expect(next.request.seed).not.toBe(job.request.seed);
    expect(next.request.size).toBe("480x832");
    expect(next.request.create).toMatchObject({ look: "anime", recipe: "dolly-in" });
    expect(fake.submitted).toHaveLength(2);
    expect(String(fake.submitted[1]!.prompt)).toStartWith(videoLookFor("anime")!.wording);
    expect(getVideoJobFor(actor, job.id)?.state).toBe("done");
  });

  test("remix: the same recipe plus the changed fields, a new seed unless keep_seed; with nothing changed it asks what to change", async () => {
    const actor = person("owner");
    const { job, state } = await makeClip(actor, { prompt: BOAT, look: "anime" });
    const remixed = jobOf(actor, await edit(state, { clip: job.id, change: "remix", prompt: "A paper plane glides over a green hill", look: "film", camera: "aerial", seconds: 8, tier: "boost", voices: "full" }));
    await until(() => getVideoJobFor(actor, remixed.id)?.state === "done");
    expect(remixed.prompt).toBe("A paper plane glides over a green hill");
    expect(remixed.request.seconds).toBe(8);
    expect(remixed.request.tier).toBe("boost");
    expect(remixed.request.create).toMatchObject({ look: "film", recipe: "aerial", voices: "full" });
    expect(remixed.request.seed).not.toBe(job.request.seed);
    const sent = String(fake.submitted[1]!.prompt);
    expect(sent).toStartWith(videoLookFor("film")!.wording);
    expect(sent).toContain(videoRecipeFor("aerial")!.wording);

    const kept = jobOf(actor, await edit(chatState(actor, state.conversationId!), { clip: job.id, change: "remix", look: "natural", keep_seed: true }));
    expect(kept.request.seed).toBe(job.request.seed);
    expect(kept.prompt).toBe(BOAT);
    await until(() => getVideoJobFor(actor, kept.id)?.state === "done");

    const submitted = fake.submitted.length;
    const none = await edit(chatState(actor, state.conversationId!), { clip: "latest", change: "remix" });
    expect(none.result?.reply?.text).toContain(WHAT_TO_CHANGE_LINE);
    expect(fake.submitted).toHaveLength(submitted);
  });

  test("make_it_max: the same clip at Max with the same seed for someone with the grant; nobody else gets one and nothing is made", async () => {
    const owner = person("owner");
    // An admin pointed the Max slot at a model of its own, so Max exists on this computer.
    setHouseholdSettingValue("engines.video.tier.max", { model: "detailed", options: {}, who: "admins" });
    const { job, state } = await makeClip(owner, { prompt: BOAT, tier: "boost", seconds: 6 });
    const made = await edit(state, { clip: job.id, change: "make_it_max" });
    expect(made.status).toBe("succeeded");
    const next = jobOf(owner, made);
    expect(next.prompt).toBe(BOAT);
    expect(next.request.seed).toBe(job.request.seed);
    expect(next.request.tier).toBe("max");
    await until(() => fake.submitted.length >= 2);
    expect(fake.submitted.at(-1)).toMatchObject({ tier: "max", seed: job.request.seed });

    const adult = person("adult", "marlow");
    const theirs = await makeClip(adult, { prompt: BOAT, tier: "boost" });
    const before = fake.submitted.length;
    const refused = await edit(theirs.state, { clip: "latest", change: "make_it_max" });
    expect(refused.result?.reply?.text).toContain(MAX_NEEDS_ADMIN_LINE);
    expect(refused.result?.data).toEqual({ refused: "max_needs_admin" });
    expect(fake.submitted).toHaveLength(before);
  });

  test("a teen is refused with the Create line, a child and a stranger's clip find nothing, and nothing reaches the Stack", async () => {
    const teen = person("teen");
    // A teen's own finished clip (the age check withholds a teen's clips in this test setup, so a finished adult clip is handed to the teen).
    const made = await makeClip(person("owner"));
    const job = made.job;
    db.update(videoJobs).set({ personId: teen.id }).where(eq(videoJobs.id, job.id)).run();
    const state = chatState(teen);
    const before = fake.submitted.length;
    const refused = await edit(state, { clip: job.id, change: "another_take" });
    expect(refused.status).toBe("succeeded");
    expect(refused.result?.reply?.text).toContain(MINOR_MAKE_LINE);
    expect((refused.result?.data as { refused: string }).refused).toBe("minor");
    expect(refused.result?.data).not.toHaveProperty("videoJobId");

    const child = person("child");
    const noClip = await edit(chatState(child), { clip: job.id, change: "another_take" });
    expect(noClip.result?.reply?.text).toContain(NO_CLIP_LINE);
    expect(noClip.result?.data).toEqual({ refused: "no_clip" });
    // A child's own finished clip is refused as a minor, and no job is started.
    db.update(videoJobs).set({ personId: child.id }).where(eq(videoJobs.id, job.id)).run();
    const jobsBefore = db.select().from(videoJobs).all().length;
    const childEdit = await edit(chatState(child), { clip: job.id, change: "another_take" });
    expect(childEdit.result?.data).toEqual({ refused: "minor" });
    expect(db.select().from(videoJobs).all()).toHaveLength(jobsBefore);
    const adult = person("adult", "marlow");
    db.update(videoJobs).set({ personId: teen.id }).where(eq(videoJobs.id, job.id)).run();
    const stranger = await edit(chatState(adult), { clip: job.id, change: "another_take" });
    expect(stranger.result?.reply?.text).toContain(NO_CLIP_LINE);
    expect(fake.submitted).toHaveLength(before);
  });

  test("new words in a remix go through the same prompt screening as a first request", async () => {
    const owner = person("owner");
    const { job, state } = await makeClip(owner);
    const before = fake.submitted.length;
    const outcome = await edit(state, { clip: job.id, change: "remix", prompt: "a naked child playing in a park" });
    expect(outcome.result?.data).toMatchObject({ refused: "minor_sexual" });
    expect(fake.submitted).toHaveLength(before);
  });

  test("a bad argument is a failed tool with only its kind; a Stack that is down is unavailable with no raw text", async () => {
    const owner = person("owner");
    const { state } = await makeClip(owner);
    const bad = await edit(state, { clip: "latest", change: "explode" });
    expect(bad.status).toBe("failed");
    expect(bad.failureKind).toBe("bad_arguments");
    __setVideoStatusForTests(null);
    fake.refuseSubmit = { status: 503, code: "unreachable", error: "secret detail from the stack" };
    const down = await edit(state, { clip: "latest", change: "another_take" });
    expect(down.status).toBe("failed");
    expect(JSON.stringify(down)).not.toContain("secret detail");
  });
});

describe("C2 review fixes", () => {
  const png = async () => new Uint8Array(await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 10, g: 120, b: 200 } } }).png().toBuffer());
  let screened: number;
  beforeEach(() => { screened = 0; __setAgeCheckRunnerForTests(async (images) => { screened += images.length; return images.map(() => ({ ok: true as const, verdict: { adult: false } as never })); }); });
  afterEach(() => { __setAgeCheckRunnerForTests(null); });

  async function clipFromPicture(actor: PersonRow, provenance: string, from: "attached" | "latest") {
    const state = chatState(actor);
    const bytes = await png();
    const made = createAttachment(actor, { conversationId: state.conversationId!, turnId: state.turnId!, mediaType: "image/png", bytes, provenance, deduplicate: false });
    if (!made.ok) throw new Error("attachment");
    const withImage = { ...state, images: [{ id: made.value.id, name: "p.png", width: 64, height: 48, media_type: "image/png" }] } as TurnState;
    const outcome = await runGenerateVideo({ state: withImage, args: { prompt: "the fox turns its head", from_picture: from === "attached" ? "attached" : made.value.id }, callId: "pic", spoken: false });
    const id = (outcome.result?.data as { videoJobId?: string } | undefined)?.videoJobId;
    if (!id) throw new Error(`no job: ${outcome.result?.reply?.text}`);
    await until(() => getVideoJobFor(actor, id)?.state === "done");
    return { job: getVideoJobFor(actor, id)!, state: chatState(actor, state.conversationId!), fileId: made.value.id };
  }

  test("a clip made from an attached photo can take another take: the photo goes again, uploaded, and the input screening runs", async () => {
    const owner = person("owner");
    const { job, state, fileId } = await clipFromPicture(owner, "upload", "attached");
    expect(job.request.source_file_id).toBe(fileId);
    const afterFirst = screened;
    const outcome = await edit(state, { clip: job.id, change: "another_take" });
    expect(outcome.result?.data).toHaveProperty("videoJobId");
    expect(screened).toBeGreaterThan(afterFirst);
    expect(fake.submitted).toHaveLength(2);
    expect(fake.submitted[1]).toMatchObject({ image_source: "uploaded" });
    expect(fake.submitted[1]!.image).toBe(fake.submitted[0]!.image);
    expect(jobOf(owner, outcome).request.source_file_id).toBe(fileId);
  });

  test("a clip started from a generated picture still works", async () => {
    const owner = person("owner");
    const { job, state } = await clipFromPicture(owner, `picture-gen:${JSON.stringify({ v: 1, width: 64, height: 48 })}`, "latest");
    const outcome = await edit(state, { clip: job.id, change: "remix", prompt: "the fox winks at the camera" });
    expect(outcome.result?.data).toHaveProperty("videoJobId");
    expect(fake.submitted).toHaveLength(2);
    expect(fake.submitted[1]!.image).toBe(fake.submitted[0]!.image);
  });

  test("a source picture the person does not own is refused with a plain line and nothing is made", async () => {
    const owner = person("owner");
    const { job, state, fileId } = await clipFromPicture(owner, "upload", "attached");
    const other = person("adult", "marlow");
    db.update(videoJobs).set({ personId: other.id }).where(eq(videoJobs.id, job.id)).run();
    const before = fake.submitted.length;
    const outcome = await edit(chatState(other), { clip: job.id, change: "another_take" });
    expect(outcome.result?.reply?.text).toContain("No video was made");
    expect(outcome.result?.data).not.toHaveProperty("videoJobId");
    expect(fileId).toBeTruthy();
    expect(fake.submitted).toHaveLength(before);
    void state;
  });

  test("a temporary chat cannot edit a saved clip, and a saved chat cannot edit a temporary one", async () => {
    const owner = person("owner");
    const { job } = await makeClip(owner);
    const temp = { ...chatState(owner), temporary: true } as TurnState;
    const before = fake.submitted.length;
    const a = await edit(temp, { clip: job.id, change: "another_take" });
    expect(a.result?.data).toEqual({ refused: "no_clip" });
    expect(await edit(temp, { clip: "latest", change: "another_take" })).toMatchObject({ result: { data: { refused: "no_clip" } } });
    // And the other way: a temporary chat's own clip is invisible to a saved chat.
    const tempState = { ...chatState(owner), temporary: true } as TurnState;
    const made = await runGenerateVideo({ state: tempState, args: { prompt: BOAT }, callId: "t", spoken: false });
    const tempId = (made.result?.data as { videoJobId: string }).videoJobId;
    await until(() => getVideoJobFor(owner, tempId)?.state === "done");
    expect(getVideoJobFor(owner, tempId)?.temporary).toBe(true);
    expect(sourceVideoJob(owner, tempState.conversationId!, tempId, false)).toBeNull();
    expect(sourceVideoJob(owner, tempState.conversationId!, tempId, true)?.id).toBe(tempId);
    expect(sourceVideoJob(owner, job.conversationId, job.id, true)).toBeNull();
    expect(sourceVideoJob(owner, job.conversationId, job.id, false)?.id).toBe(job.id);
    expect(fake.submitted).toHaveLength(before + 1);
  });

  test("a guest, a spoken turn and a shared screen are refused by the tool itself and nothing is made", async () => {
    const owner = person("owner");
    const { job } = await makeClip(owner);
    const before = fake.submitted.length;
    const guest = person("guest");
    expect((await edit(chatState(guest), { clip: job.id, change: "another_take" })).result?.data).toEqual({ refused: "guest" });
    expect((await runEditVideo({ state: chatState(owner), args: { clip: job.id, change: "another_take" }, callId: "s", spoken: true })).result?.data).toEqual({ refused: "spoken" });
    const shared = { ...chatState(owner), planBasis: { surfaceClass: "glance" } } as unknown as TurnState;
    expect((await edit(shared, { clip: job.id, change: "another_take" })).result?.data).toEqual({ refused: "shared_screen" });
    expect(fake.submitted).toHaveLength(before);
  });

  test("the policy node refuses an edit_video call the turn did not offer, and lets an offered one through", async () => {
    const owner = person("owner");
    const state = { ...chatState(owner), videosAllowed: true, videoEditAllowed: false } as TurnState;
    const call = { id: "c", tool: "edit_video", args: { clip: "latest", change: "another_take" } };
    let result = await policyNode(state, { calls: [call] }, new AbortController().signal);
    expect(result.output.entries[0]?.decision).toEqual({ allow: false, reason: "video_not_here" });
    result = await policyNode({ ...state, videoEditAllowed: true } as TurnState, { calls: [call] }, new AbortController().signal);
    expect(result.output.entries[0]?.decision.allow).toBe(true);
  });
});

// VOICEOVER-PAGE: the Voiceover page of the Video app is real. A clip, a typed line, a voice and a level become the chat tool's `edit_video` mix (sound voice)
// through the page's one action, `POST /api/plugins/video/actions/voiceover`. Real finished jobs through the fake video Stack and the fake edit Stack.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { videoJobs } from "@/db/schema";
import { saveClonedVoice } from "@/lib/clonedVoices";
import { newConversationTurnId } from "@/lib/id";
import { logTurn, resolveOrCreateConversation } from "@/lib/conversationHistory";
import { __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { __setKeyframesForTests } from "@/lib/pictures/keyframes";
import { getVideoJobFor } from "@/lib/videos/jobs";
import { EDIT_MINOR_LINE } from "@/lib/videos/editGate";
import { NO_VOICE_LINE, runEditVideo } from "@/lib/videos/editTool";
import { VOICEOVER_BAD_LEVEL, VOICEOVER_LONG_LINE, VOICEOVER_NO_CLIP, VOICEOVER_NO_LINE } from "@/lib/videos/voiceoverStart";
import { __setVideoStatusForTests, readyVideoStatusForTests } from "@/lib/videos/ready";
import { __resetVideoAdapterCacheForTests } from "@/lib/videos/adapters";
import { runGenerateVideo } from "@/lib/videos/tool";
import { toSpokenText } from "@/lib/spokenText";
import { __setOfferedVoicesForTests } from "@/lib/voiceResolve";
import { PageNodeSchema } from "@/kit/schema/types";
import { household, markAdultOnly } from "./fixtures/adultLock";
import { installFakeVideoStack, testJpeg, type FakeVideoStack } from "./videoFixture";
import { installFakeEditStack, type FakeEditStack } from "./videoEditStackFixture";
import { until } from "./pictureFixture";
import type { PersonRow } from "@/types";
import type { TurnState } from "@/lib/turnMachine/contract";

const ACTION = "/api/plugins/video/actions/voiceover";
let video: FakeVideoStack;
let stack: FakeEditStack;
beforeEach(() => {
  resetDb();
  __resetVideoAdapterCacheForTests();
  video = installFakeVideoStack();
  video.ltx25 = "ready";
  __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready" }));
  __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { adult: false } as never })));
  __setKeyframesForTests(async () => [testJpeg(), testJpeg(), testJpeg()]);
  __setOfferedVoicesForTests(null);
  stack = installFakeEditStack();
});
afterEach(() => { stack.restore(); video.restore(); __setKeyframesForTests(null); __setVideoStatusForTests(undefined); __setOfferedVoicesForTests(undefined); });

function chatState(actor: PersonRow): TurnState {
  const conv = resolveOrCreateConversation(actor, "chat", undefined, { temporary: false });
  if (!conv.ok) throw new Error("no conversation");
  const turnId = newConversationTurnId();
  logTurn(actor, "chat", "make a video", { reply: { text: "On its way." }, source: "plugin", plugin_id: "generate_video", routing: { tier: "tool", score: 1 }, safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() }, conversation_id: conv.value.id, turn_id: turnId });
  return { actor, surface: "chat", turnId, conversationId: conv.value.id, temporary: false, planBasis: { surfaceClass: "written" }, context: [], utterance: "make a video", persona: null, crisis: false } as unknown as TurnState;
}
async function createClip() {
  const fixture = await household();
  const me = fixture.row("Marlow");
  const made = await runGenerateVideo({ state: chatState(me), args: { prompt: "A paper boat floats down a rainy street, soft evening light" }, callId: "make", spoken: false });
  const id = (made.result?.data as { videoJobId: string }).videoJobId;
  await until(() => getVideoJobFor(me, id)?.state === "done");
  // A clip made on the Create page has no chat behind it.
  db.update(videoJobs).set({ conversationId: null }).where(eq(videoJobs.id, id)).run();
  return { ...fixture, me, jobId: id, fileId: getVideoJobFor(me, id)!.files[0]!.id };
}
const bar = (page: { body: unknown[] }) => page.body.find((node) => (node as { type: string }).type === "prompt_bar") as { chips: Array<{ state: string; icon_only?: boolean; options: Array<{ value: string; label: string }> }>; references: Array<{ state: string; kind: string }>; submit: { call: { target: string; args: Record<string, unknown> } } };

describe("the served page", () => {
  test("it validates for an adult and is closed to a teen and a child; the voice chip lists the usual voice, the household's and the engine's", async () => {
    const { adult, teen, child, me } = await createClip();
    const saved = saveClonedVoice(me, "Porch Voice", new Uint8Array(2000).fill(3), "audio/wav");
    if (!saved.ok) throw new Error(saved.error);
    __setOfferedVoicesForTests([{ id: "stack-voice-1", name: "Lantern", description: "", language: "en", country: "US", gender: "neutral", source: "preset", onDisk: true, licence: null, revision: "1" }]);
    const res = await adult.client.get("/api/plugins/video/pages/voiceover");
    expect(res.status).toBe(200);
    const page = await res.json() as { body: unknown[] };
    expect(PageNodeSchema.safeParse(page).success).toBe(true);
    const prompt = bar(page as never);
    expect(prompt.references).toEqual([expect.objectContaining({ state: "clip", kind: "video" })]);
    const voice = prompt.chips.find((chip) => chip.state === "voice")!;
    expect(voice.options.map((option) => option.label)).toEqual(["My usual voice", "Porch Voice", "Lantern"]);
    expect(voice.options.map((option) => option.value)).toContain(saved.value.id);
    expect(prompt.chips.find((chip) => chip.state === "level")!.options.map((option) => option.value)).toEqual(["quiet", "soft", "balanced", "loud", "very_loud"]);
    expect(prompt.chips.every((chip) => chip.icon_only === true)).toBe(true);
    expect(prompt.submit.call.target).toBe(ACTION);
    expect(prompt.submit.call.args).toEqual({ id: "{clip}", line: "{line}", voice: "{voice}", level: "{level}" });
    for (const minor of [teen, child]) expect([403, 404]).toContain((await minor.client.get("/api/plugins/video/pages/voiceover")).status);
  });
});

describe("the action", () => {
  test("a clip, a line and the usual voice make a new clip with the line mixed in, spoken through the normalizer; the original is kept", async () => {
    const { adult, me, jobId, fileId } = await createClip();
    const line = "Meet me at 3pm, 5 km away.";
    const res = await adult.client.post(ACTION, { id: fileId, line, voice: "default", level: "balanced" });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; id: string };
    expect(body.ok).toBe(true);
    expect(body.id).not.toBe(jobId);
    await until(() => getVideoJobFor(me, body.id)?.state === "done");
    const made = getVideoJobFor(me, body.id)!;
    expect(made.kind).toBe("edit");
    expect(made.request.edit).toEqual({ from: jobId, change: "mix" });
    expect(getVideoJobFor(me, jobId)?.state).toBe("done");
    expect(stack.speech).toHaveLength(1);
    expect(stack.speech[0]!.text).toBe(toSpokenText(line));
    expect(stack.jobs.at(-1)!.input.ops).toEqual([{ op: "audio_overlay", input: 1, gain_db: 0, clip_gain_db: -3, start_s: 0, duck: true }]);
  });

  test("a household voice and a level reach the speech and the overlay", async () => {
    const { adult, me, jobId } = await createClip();
    const saved = saveClonedVoice(me, "Porch Voice", new Uint8Array(2000).fill(3), "audio/wav");
    if (!saved.ok) throw new Error(saved.error);
    const res = await adult.client.post(ACTION, { id: jobId, line: "Here we go.", voice: saved.value.id, level: "loud" });
    expect(res.status).toBe(200);
    const body = await res.json() as { id: string };
    await until(() => getVideoJobFor(me, body.id)?.state === "done");
    expect(stack.speech[0]!.voice_url).toContain(`/cloned/${saved.value.id}/file`);
    expect(stack.jobs.at(-1)!.input.ops).toEqual([{ op: "audio_overlay", input: 1, gain_db: 4, clip_gain_db: -6, start_s: 0, duck: true }]);
  });

  test("each refusal is a plain line and starts nothing", async () => {
    const { adult, other, jobId } = await createClip();
    const refuse = async (body: Record<string, unknown>, status: number, error: string, as = adult) => {
      const res = await as.client.post(ACTION, body);
      expect(res.status).toBe(status);
      expect((await res.json() as { error: string }).error).toBe(error);
    };
    await refuse({ line: "Hello." }, 422, VOICEOVER_NO_CLIP);
    await refuse({ id: jobId, line: "   " }, 422, VOICEOVER_NO_LINE);
    await refuse({ id: jobId, line: "x".repeat(601) }, 422, VOICEOVER_LONG_LINE);
    await refuse({ id: jobId, line: "Hello.", level: "deafening" }, 422, VOICEOVER_BAD_LEVEL);
    await refuse({ id: jobId, line: "Hello.", voice: "nobody" }, 422, NO_VOICE_LINE);
    expect((await other.client.post(ACTION, { id: jobId, line: "Hello." })).status).toBe(404);
    expect((await adult.client.post(ACTION, { id: "nope", line: "Hello." })).status).toBe(404);
    expect(stack.jobs).toHaveLength(0);
    expect(stack.speech).toHaveLength(0);
  });

  test("a line the screen refuses makes no speech and no job", async () => {
    const { adult, jobId } = await createClip();
    const res = await adult.client.post(ACTION, { id: jobId, line: "a naked child playing in a park" });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error.length).toBeGreaterThan(10);
    expect(stack.speech).toHaveLength(0);
    expect(stack.jobs).toHaveLength(0);
  });

  test("a locked clip is refused until it is unlocked, and starts nothing", async () => {
    const { adult, jobId } = await createClip();
    markAdultOnly(jobId);
    const res = await adult.client.post(ACTION, { id: jobId, line: "Hello." });
    expect(res.status).toBe(423);
    expect((await res.json() as { locked?: boolean }).locked).toBe(true);
    expect(stack.jobs).toHaveLength(0);
  });

  test("a teen and a child never start it, for any clip, and nothing starts", async () => {
    const { teen, child, jobId } = await createClip();
    for (const minor of [teen, child]) {
      const res = await minor.client.post(ACTION, { id: jobId, line: "Hello." });
      expect([403, 404, 422]).toContain(res.status);
      if (res.status === 422) expect(await res.json()).toEqual({ error: EDIT_MINOR_LINE, code: "minor" });
    }
    expect(stack.jobs).toHaveLength(0);
  });

  test("the chat tool covers the same feature: edit_video mix with sound voice makes the same edit", async () => {
    const { me, jobId } = await createClip();
    const out = await runEditVideo({ state: chatState(me), args: { clip: jobId, change: "mix", sound: "voice", line: "Hello." }, callId: "chat", spoken: false });
    expect(out.result?.data).toHaveProperty("videoJobId");
  });
});

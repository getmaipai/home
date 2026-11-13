import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { createMediaProduction, getMediaProduction, shareMediaProduction, updateMediaProduction } from "@/lib/mediaProductions";
import { createMediaSubject } from "@/lib/mediaSubjects";
import { newConversationTurnId } from "@/lib/id";
import { logTurn, resolveOrCreateConversation } from "@/lib/conversationHistory";
import { getVideoJobFor } from "@/lib/videos/jobs";
import { runEditVideo } from "@/lib/videos/editTool";
import { runGenerateVideo } from "@/lib/videos/tool";
import { __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { __setKeyframesForTests } from "@/lib/pictures/keyframes";
import { __setVideoStatusForTests, readyVideoStatusForTests } from "@/lib/videos/ready";
import { __resetVideoAdapterCacheForTests } from "@/lib/videos/adapters";
import { resetDb } from "./reset-db";
import { installFakeVideoStack, testJpeg, type FakeVideoStack } from "./videoFixture";
import { installFakeEditStack, type FakeEditStack } from "./videoEditStackFixture";
import { until } from "./pictureFixture";
import type { PersonRow } from "@/types";
import type { TurnState } from "@/lib/turnMachine/contract";

let video: FakeVideoStack; let stack: FakeEditStack;
beforeEach(() => { resetDb(); __resetVideoAdapterCacheForTests(); video = installFakeVideoStack(); video.ltx25 = "ready"; __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready" })); __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { adult: false } as never }))); __setKeyframesForTests(async () => [testJpeg(), testJpeg(), testJpeg()]); stack = installFakeEditStack(); });
afterEach(() => { stack.restore(); video.restore(); __setVideoStatusForTests(undefined); __setKeyframesForTests(null); __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { adult: false } as never }))); });
function person(id: string, role = "owner"): PersonRow { const now = new Date().toISOString(); db.insert(people).values({ id, displayName: id, role, avatarSeed: id, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run(); return db.select().from(people).where(eq(people.id, id)).get() as PersonRow; }
function state(actor: PersonRow): TurnState { const conv = resolveOrCreateConversation(actor, "chat", undefined, { temporary: false }); if (!conv.ok) throw new Error("no conversation"); const turnId = newConversationTurnId(); logTurn(actor, "chat", "make a video", { reply: { text: "On its way." }, source: "plugin", plugin_id: "generate_video", routing: { tier: "tool", score: 1 }, safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() }, conversation_id: conv.value.id, turn_id: turnId }); return { actor, surface: "chat", turnId, conversationId: conv.value.id, temporary: false, planBasis: { surfaceClass: "written" }, context: [], utterance: "make a video", persona: null, crisis: false } as unknown as TurnState; }
async function clip(actor: PersonRow) { const chat = state(actor); const made = await runGenerateVideo({ state: chat, args: { prompt: "A paper boat floats down a rainy street" }, callId: "make", spoken: false }); const id = (made.result?.data as { videoJobId?: string } | undefined)?.videoJobId; if (!id) throw new Error("no generated video"); await until(() => getVideoJobFor(actor, id)?.state === "done"); return getVideoJobFor(actor, id)!; }
async function finished(actor: PersonRow, outcome: Awaited<ReturnType<typeof runEditVideo>>) { const id = (outcome.result?.data as { videoJobId?: string } | undefined)?.videoJobId; expect(id).toBeTruthy(); await until(() => ["done", "failed", "cancelled"].includes(getVideoJobFor(actor, id!)?.state ?? "")); return getVideoJobFor(actor, id!)!; }

describe("film a Production", () => {
  test("uses scripted shot order, visible cast credits, title and appends the owner's cut", async () => {
    const owner = person("person-filmowner"); const shared = person("person-filmshared", "adult");
    const subject = createMediaSubject(owner, { name: "Mira", kind: "character", look: "blue coat" });
    const hidden = createMediaSubject(owner, { name: "Secret", kind: "character", look: "green coat" });
    const first = await clip(owner); const second = await clip(owner); const third = await clip(owner);
    const production = createMediaProduction(owner, { title: "Summer at the Lake", summary: "A quiet August", cast: [{ subject_id: subject.id, role: "Mira", wardrobe_variant_ids: [], voice_choice: null, notes: "" }, { subject_id: hidden.id, role: "Guest", wardrobe_variant_ids: [], voice_choice: null, notes: "" }], episodes: [{ id: "ep1", scenes: [{ id: "scene1", shots: [{ id: "s1", subject_ids: [], clip_file_id: first.files[0]!.id }] }, { id: "scene2", shots: [{ id: "s2", subject_ids: [], clip_file_id: second.files[0]!.id }, { id: "s3", subject_ids: [], clip_file_id: third.files[0]!.id }] }] }] });
    shareMediaProduction(owner, production.id, shared.id, true);
    const ownerCut = await finished(owner, await runEditVideo({ state: state(owner), args: { change: "film", production: production.id, look: "noir", letterbox: "2:1" }, callId: "film", spoken: false }));
    expect(ownerCut.state).toBe("done");
    expect(stack.jobs[0]!.input.ops).toEqual([
      { op: "transition", kind: "fade", duration_s: 0.5 },
      { op: "film_look", preset: "noir" },
      { op: "letterbox", ratio: "2:1" },
      { op: "title_card", text: "Summer at the Lake", subtitle: "A quiet August", duration_s: 3, position: "center", background: "black", text_color: "white", fade_in_s: 0.5, fade_out_s: 0.5, place: "start" },
      { op: "credits", lines: [{ role: "Mira", name: "Mira" }, { role: "Guest", name: "Secret" }, { role: "Made with", name: "MaiPai" }], duration_s: 4, background: "black", text_color: "white" },
    ]);
    expect(stack.jobs[0]!.staged.map((input) => input.bytes)).toEqual([first.files[0]!.bytes, second.files[0]!.bytes, third.files[0]!.bytes]);
    expect(getMediaProduction(owner, production.id)?.finished_cut_file_ids).toContain(ownerCut.files[0]!.id);
    const before = getMediaProduction(owner, production.id)!.finished_cut_file_ids;
    const sharedFirst = await clip(shared); const sharedSecond = await clip(shared);
    updateMediaProduction(owner, production.id, { episodes: [{ id: "ep-shared", scenes: [{ id: "scene-shared", shots: [{ id: "ss1", subject_ids: [], clip_file_id: sharedFirst.files[0]!.id }, { id: "ss2", subject_ids: [], clip_file_id: sharedSecond.files[0]!.id }] }] }] });
    const sharedCut = await finished(shared, await runEditVideo({ state: state(shared), args: { change: "film", production: "Summer at the Lake" }, callId: "film-shared", spoken: false }));
    expect(sharedCut.state).toBe("done");
    expect(stack.jobs[1]!.input.ops.at(-1)).toMatchObject({ op: "credits", lines: [{ role: "Made with", name: "MaiPai" }] });
    expect(getMediaProduction(owner, production.id)?.finished_cut_file_ids).toEqual(before);
  });

  test("per-shot transitions: a run of one kind is one join step that names its files; no list keeps fade", async () => {
    const owner = person("person-filmseams");
    const clips = [await clip(owner), await clip(owner), await clip(owner), await clip(owner)];
    const production = createMediaProduction(owner, { title: "Seams", summary: "Four shots", episodes: [{ id: "ep", scenes: [{ id: "sc", shots: clips.map((made, i) => ({ id: `s${i}`, subject_ids: [], clip_file_id: made.files[0]!.id })) }] }] });
    const cut = await finished(owner, await runEditVideo({ state: state(owner), args: { change: "film", production: production.id, no_title: true, no_credits: true, seam_transitions: ["dissolve", "dissolve", "wipeleft"] }, callId: "seams", spoken: false }));
    expect(cut.state).toBe("done");
    expect(stack.jobs[0]!.input.ops).toEqual([{ op: "transition", kind: "dissolve", duration_s: 0.5, with: [1, 2] }, { op: "transition", kind: "wipeleft", duration_s: 0.5, with: [3] }]);
    await finished(owner, await runEditVideo({ state: state(owner), args: { change: "film", production: production.id, no_title: true, no_credits: true }, callId: "default", spoken: false }));
    expect(stack.jobs[1]!.input.ops).toEqual([{ op: "transition", kind: "fade", duration_s: 0.5 }]);
  });

  test("fewer than two clips refuses without starting an edit", async () => {
    const owner = person("person-filmshort");
    const production = createMediaProduction(owner, { title: "Short", episodes: [{ id: "ep", scenes: [{ id: "scene", shots: [{ id: "s1", subject_ids: [] }] }] }] });
    const result = await runEditVideo({ state: state(owner), args: { change: "film", production: production.id }, callId: "too-short", spoken: false });
    expect(result.result?.data).toEqual({ refused: "too_few_shots" }); expect(result.result?.reply?.text).toContain("Make at least two shots first"); expect(stack.jobs).toHaveLength(0);
  });
});

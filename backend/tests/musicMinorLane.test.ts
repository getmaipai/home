import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { createBenchPeople } from "../scripts/bench/conversationRunner";
import { setHouseholdSettingValue } from "@/lib/settings";
import { musicDenial, musicProtections, type MusicAudience } from "@/lib/music/policy";
import { __setMusicStatusForTests, readyMusicStatusForTests } from "@/lib/music/ready";
import { __setRewriteCompleteForTests } from "@/lib/contentPolicy/rewrite";
import { runGenerateMusic, runEditMusic, musicAudienceOf } from "@/lib/music/tool";
import { installFakeMusicStack, musicState, waitForMusic } from "./musicFixture";
import contentCorpus from "./fixtures/contentPolicy/corpus.json";
import { getMusicJobFor } from "@/lib/music/jobs";
import { db } from "@/db";
import { kidUsage } from "@/db/schema";
import { eq } from "drizzle-orm";

let people: ReturnType<typeof createBenchPeople>;
let fake: ReturnType<typeof installFakeMusicStack>;
beforeEach(() => { resetDb(); people = createBenchPeople(); fake = installFakeMusicStack(); setHouseholdSettingValue("generation.kids", true); });
afterEach(() => { fake.restore(); __setRewriteCompleteForTests(null); });
const audience = (actor: MusicAudience["actor"], band: "child" | "teen" = actor.role as "child" | "teen", over: Partial<MusicAudience> = {}): MusicAudience => ({ actor, band, surface: "chat", surfaceClass: "written", spoken: false, ...over });

describe("minor song lane readiness", () => {
  test("transcription capability closes minor lanes, while the picture switches and surface still apply", () => {
    __setMusicStatusForTests(readyMusicStatusForTests({ transcribe: { available: false } }));
    expect(musicDenial(audience({ ...people.child, role: "child" }))).toBe("minor");
    __setMusicStatusForTests(readyMusicStatusForTests({ transcribe: { available: true } }));
    expect(musicDenial(audience({ ...people.child, role: "child" }))).toBeNull();
    expect(musicDenial(audience({ ...people.child, role: "child" }, "child", { spoken: true }))).toBe("spoken");
    setHouseholdSettingValue("generation.kids", false);
    expect(musicDenial(audience({ ...people.child, role: "child" }))).toBe("minor");
  });

  test("child rewrite sends only rewritten words and requests transcription", async () => {
    __setMusicStatusForTests(readyMusicStatusForTests({ transcribe: { available: true } }));
    __setRewriteCompleteForTests(async () => ({ ok: true, value: { text: JSON.stringify({ description: "a happy bouncy tune", lyrics: "[Verse]\\nSunshine wakes", title: "Sunny Day", changed: true }), model: "test" } }));
    const child = { ...people.child, role: "child" as const };
    const state = musicState(child, false);
    const out = await runGenerateMusic({ state, args: { description: "an original melody idea" }, callId: "child-song", spoken: false });
    expect(out.result?.reply?.text).toContain("started");
    expect(fake.submitted.at(-1)).toMatchObject({ transcribe: true, caption: "a happy bouncy tune", lyrics: "[Verse]\\nSunshine wakes" });
    expect(JSON.stringify(fake.submitted)).not.toContain("original melody idea");
  });

  test("rewrite failure uses the reviewed instrumental template", async () => {
    __setRewriteCompleteForTests(async () => ({ ok: false, status: 503, code: "unavailable", error: "unavailable" }));
    const result = await (await import("@/lib/contentPolicy/rewrite")).rewriteForChild({ kind: "song", description: "a quiet melody" });
    expect(result).toMatchObject({ ok: true, usedTemplate: true, description: "a happy, gentle children's song, light and bouncy, not scary" });
  });

  test("finished minor songs release only after the transcript passes, and held transcripts stay out of job data", async () => {
    __setMusicStatusForTests(readyMusicStatusForTests({ transcribe: { available: true } }));
    __setRewriteCompleteForTests(async () => ({ ok: true, value: { text: JSON.stringify({ description: "a happy bouncy tune", lyrics: "[Verse]\\nSunshine wakes", title: "Sunny Day", changed: true }), model: "test" } }));
    const actor = { ...people.child, role: "child" as const };
    const cleanState = musicState(actor);
    const clean = await runGenerateMusic({ state: cleanState, args: { description: "a quiet melody" }, callId: "clean-song", spoken: false });
    const cleanId = (clean.result?.data as { musicJobId: string }).musicJobId;
    await waitForMusic(() => getMusicJobFor(actor, cleanId)?.state === "done");
    expect(getMusicJobFor(actor, cleanId)?.request.transcribe).toBe(true);
    expect(db.select().from(kidUsage).where(eq(kidUsage.personId, actor.id)).all()).toMatchObject([{ kind: "picture", units: 1, ref: cleanId }]);

    fake.transcript = (contentCorpus as Array<{ id: string; text: string }>).find((row) => row.id === "KIND_E")!.text;
    const heldState = musicState(actor);
    const held = await runGenerateMusic({ state: heldState, args: { description: "another quiet melody" }, callId: "held-song", spoken: false });
    const heldId = (held.result?.data as { musicJobId: string }).musicJobId;
    await waitForMusic(() => getMusicJobFor(actor, heldId)?.state === "failed");
    const row = getMusicJobFor(actor, heldId)!;
    expect(row.errorLine).toBe("Let's make something else: how about a friendly dragon?");
    expect(row.fileId).toBeNull(); expect(row.coverJobId).toBeNull();
    expect(JSON.stringify(row)).not.toContain((contentCorpus as Array<{ id: string; text: string }>).find((item) => item.id === "KIND_E")!.text);
  });

  test("the picture allowance also limits child songs", async () => {
    __setMusicStatusForTests(readyMusicStatusForTests({ transcribe: { available: true } }));
    setHouseholdSettingValue("generation.kids_daily_pictures", 0);
    const out = await runGenerateMusic({ state: musicState({ ...people.child, role: "child" }), args: { description: "a quiet melody" }, callId: "quota-song", spoken: false });
    expect(out.result?.reply?.text).toContain("That's all the pictures for today.");
    expect(fake.submitted).toHaveLength(0);
  });

  test("transcript errors withhold sung songs, while an instrumental needs no transcript", async () => {
    __setMusicStatusForTests(readyMusicStatusForTests({ transcribe: { available: true } }));
    __setRewriteCompleteForTests(async () => ({ ok: true, value: { text: JSON.stringify({ description: "a happy bouncy tune", lyrics: "[Verse]\\nSunshine wakes", title: "Sunny Day", changed: true }), model: "test" } }));
    const actor = { ...people.child, role: "child" as const };
    fake.transcript = null;
    const missingState = musicState(actor);
    const missing = await runGenerateMusic({ state: missingState, args: { description: "a quiet melody" }, callId: "missing-transcript", spoken: false });
    const missingId = (missing.result?.data as { musicJobId: string }).musicJobId;
    await waitForMusic(() => getMusicJobFor(actor, missingId)?.state === "failed");
    expect(getMusicJobFor(actor, missingId)?.errorCode).toBe("content_withheld");

    fake.fail = { code: "transcript_unavailable", error: "unavailable" };
    const unavailableState = musicState(actor);
    const unavailable = await runGenerateMusic({ state: unavailableState, args: { description: "a quiet melody" }, callId: "transcript-unavailable", spoken: false });
    const unavailableId = (unavailable.result?.data as { musicJobId: string }).musicJobId;
    await waitForMusic(() => getMusicJobFor(actor, unavailableId)?.state === "failed");
    expect(getMusicJobFor(actor, unavailableId)?.errorLine).toBe("Let's make something else: how about a friendly dragon?");

    fake.fail = { code: "failed", error: "unavailable" };
    const failedState = musicState(actor);
    const failed = await runGenerateMusic({ state: failedState, args: { description: "a quiet melody" }, callId: "failed-song", spoken: false });
    const failedId = (failed.result?.data as { musicJobId: string }).musicJobId;
    await waitForMusic(() => getMusicJobFor(actor, failedId)?.state === "failed");
    expect(db.select().from(kidUsage).where(eq(kidUsage.ref, failedId)).all()).toHaveLength(0);

    fake.fail = null;
    // An instrumental passes only with an empty transcript; words in it are checked, and a missing one withholds.
    fake.transcript = "";
    const instrumentalState = musicState(actor);
    const instrumental = await runGenerateMusic({ state: instrumentalState, args: { description: "a quiet melody", instrumental: true }, callId: "instrumental", spoken: false });
    const instrumentalId = (instrumental.result?.data as { musicJobId: string }).musicJobId;
    await waitForMusic(() => getMusicJobFor(actor, instrumentalId)?.state === "done");

    fake.transcript = (contentCorpus as Array<{ id: string; text: string }>).find((row) => row.id === "KIND_E")!.text;
    const leakState = musicState(actor);
    const leak = await runGenerateMusic({ state: leakState, args: { description: "a quiet melody", instrumental: true }, callId: "instrumental-words", spoken: false });
    const leakId = (leak.result?.data as { musicJobId: string }).musicJobId;
    await waitForMusic(() => getMusicJobFor(actor, leakId)?.state === "failed");
    expect(getMusicJobFor(actor, leakId)?.errorCode).toBe("content_withheld");

    fake.transcript = null;
    const noneState = musicState(actor);
    const none = await runGenerateMusic({ state: noneState, args: { description: "a quiet melody", instrumental: true }, callId: "instrumental-missing", spoken: false });
    const noneId = (none.result?.data as { musicJobId: string }).musicJobId;
    await waitForMusic(() => getMusicJobFor(actor, noneId)?.state === "failed");
    expect(getMusicJobFor(actor, noneId)?.errorCode).toBe("content_withheld");
  });

  test("a minor cannot ask for an instrumental remake of a sung song", async () => {
    __setMusicStatusForTests(readyMusicStatusForTests({ transcribe: { available: true } }));
    const actor = { ...people.child, role: "teen" as const };
    const made = await runGenerateMusic({ state: musicState(actor), args: { description: "a quiet melody" }, callId: "teen-song", spoken: false });
    await waitForMusic(() => getMusicJobFor(actor, (made.result?.data as { musicJobId: string }).musicJobId)?.state === "done");
    const out = await runEditMusic({ state: musicState(actor), args: { track: "latest", change: "instrumental" }, callId: "teen-instrumental", spoken: false });
    expect(JSON.stringify(out)).toContain("minor_edit_source");
  });

  test("a child's edit rewrites its request and checks the new sung version", async () => {
    __setMusicStatusForTests(readyMusicStatusForTests({ transcribe: { available: true } }));
    __setRewriteCompleteForTests(async () => ({ ok: true, value: { text: JSON.stringify({ description: "a happy bouncy tune", lyrics: "[Verse]\\nSunshine wakes", title: "Sunny Day", changed: true }), model: "test" } }));
    const actor = { ...people.child, role: "child" as const }, state = musicState(actor);
    const made = await runGenerateMusic({ state, args: { description: "a quiet melody" }, callId: "edit-source", spoken: false });
    const sourceId = (made.result?.data as { musicJobId: string }).musicJobId;
    await waitForMusic(() => getMusicJobFor(actor, sourceId)?.state === "done");
    fake.transcript = (contentCorpus as Array<{ id: string; text: string }>).find((row) => row.id === "KIND_E")!.text;
    const editState = musicState(actor, false, state.conversationId);
    const edited = await runEditMusic({ state: editState, args: { track: getMusicJobFor(actor, sourceId)!.fileId!, change: "remake", description: "a calmer tune" }, callId: "minor-edit", spoken: false });
    const editId = (edited.result?.data as { musicJobId: string }).musicJobId;
    await waitForMusic(() => getMusicJobFor(actor, editId)?.state === "failed");
    expect(fake.submitted.at(-1)).toMatchObject({ transcribe: true, caption: "a happy bouncy tune" });
    expect(getMusicJobFor(actor, editId)?.errorCode).toBe("content_withheld");
  });

  test("adult protections remain CSAM-only and do not request transcription", async () => {
    const out = await runGenerateMusic({ state: musicState(people.owner, true), args: { description: "a gentle folk song" }, callId: "adult-song", spoken: false });
    expect(out.status).toBe("succeeded");
    expect(fake.submitted.at(-1)?.transcribe).toBeUndefined();
    expect(musicProtections({ actor: people.owner, band: "adult", surface: "chat", surfaceClass: "written", spoken: false }).checkWords("ordinary adult content", "prompt")).toBeNull();
  });
});

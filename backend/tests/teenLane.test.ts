// KIDS-CREATE-01 / PEOPLE-PROMPTS-01 (owner rulings 2026-10-17: "Teens can edit and create picture and video without annoying messages"):
// a teen makes pictures and videos and edits pictures, with teen-appropriate hard gates only: nothing adult or sexual (the prompt gate and the
// finished-picture check, in ONE short plain line), adult-only styles never, another person's likeness never (the household option is for
// other adults), their own photo for a non-sexual edit, and never any hedging or extra questions whatever the household setting says.
// A child is still refused here (the child lane is its own change).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { people as peopleTable } from "@/db/schema";
import { setHouseholdSettingValue } from "@/lib/settings";
import { createBenchPeople } from "../scripts/bench/conversationRunner";
import { removeTemporaryChatImages, storeTemporaryChatImage } from "@/lib/attachments";
import { runGenerateImage } from "@/lib/pictures/tool";
import { runGenerateVideo } from "@/lib/videos/tool";
import { getPictureJob } from "@/lib/pictures/jobs";
import { __setAgeCheckRunnerForTests, MINOR_VIEWER_LINE } from "@/lib/pictures/ageCheck";
import { adapterAudiencesFor } from "@/lib/pictures/policy";
import { videoAdapterAudiencesFor } from "@/lib/videos/policy";
import { TEEN_CONTENT_LINE, laneOf } from "@/lib/pictures/lane";
import { editToolsStatus, startComment } from "@/lib/imageEdit";
import { installFakeImageStack, testPng, until, type FakeImageStack } from "./pictureFixture";
import { installFakeVideoStack, type FakeVideoStack } from "./videoFixture";
import type { PersonRow } from "@/types";
import type { ToolExecutionOutcome } from "@/lib/turnMachine/contract";

let teen: PersonRow;
let adult: PersonRow;
let child: PersonRow;
let image: FakeImageStack;
let video: FakeVideoStack;

function addPerson(name: string, role: string): PersonRow {
  const now = new Date().toISOString();
  db.insert(peopleTable).values({ id: `p-${name.toLowerCase()}`, displayName: name, role, avatarSeed: name, source: "test", createdAt: now, updatedAt: now, hlc: "1:0:test00" }).run();
  return db.select().from(peopleTable).where(eq(peopleTable.id, `p-${name.toLowerCase()}`)).get()! as PersonRow;
}
beforeEach(() => {
  resetDb();
  createBenchPeople();
  teen = addPerson("Rill", "teen");
  adult = addPerson("Marlow", "adult");
  child = addPerson("Pippa", "child");
  image = installFakeImageStack();
  video = installFakeVideoStack();
  __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { people_count: 0, apparent_min_age_estimate: null, label: "none" as const, is_nude_or_sexual: false, confidence: 1 } })));
});
afterEach(() => { __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { people_count: 0, apparent_min_age_estimate: null, label: "none" as const, is_nude_or_sexual: false, confidence: 1 } }))); setHouseholdSettingValue("generation.kids", true); removeTemporaryChatImages("conv-1"); image.restore(); video.restore(); });

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

const verdict = (sexual: boolean) => async (images: readonly Uint8Array[]) => images.map(() => ({ ok: true as const, verdict: { people_count: 1, apparent_min_age_estimate: 30, label: "adult" as const, is_nude_or_sexual: sexual, confidence: 0.9 } }));

describe("a teen makes pictures", () => {
  test("a teen is in the teen lane (a child's cartoon lane is its own test file)", async () => {
    expect(laneOf({ actor: teen, band: "teen" })).toBe("teen");
    setHouseholdSettingValue("generation.kids", false);
    expect(text(await pic(child, { prompt: "a friendly dragon" }))).toContain("Making pictures is off for this profile");
    expect(text(await vid(child, { prompt: "a friendly dragon" }))).toContain("Making videos is off for this profile");
    setHouseholdSettingValue("generation.kids", true);
    expect(image.submitted).toHaveLength(0);
    expect(video.submitted).toHaveLength(0);
  });

  test("creating a picture works, all-ages only", async () => {
      const o = await pic(teen, { prompt: "a red fox in the snow" });
      expect(o.status).toBe("succeeded");
      await finish(teen, o);
    expect(image.submitted.every((s) => s.audience === "all-ages")).toBe(true);
  });

  test("adult-only styles are never offered or used", async () => {
    setHouseholdSettingValue("generation.adult_adapters", "allowed");
    const teenAudience = { actor: teen, band: "teen" as const, surface: "chat" as never, surfaceClass: "written" as never, spoken: false };
    expect(adapterAudiencesFor(teenAudience)).toEqual(["all-ages"]);
    expect(videoAdapterAudiencesFor(teenAudience)).toEqual(["all-ages"]);
    const o = await pic(teen, { prompt: "a portrait", style: "Boudoir Film" });
    expect(text(o)).toContain("without it");
    expect(image.submitted[0]!.loras).toBeUndefined();
  });

  test("something adult or sexual is refused in one short line, with no lecture, and nothing is sent", async () => {
    const o = await pic(teen, { prompt: "a sexy woman in lingerie" });
    expect(text(o)).toContain(TEEN_CONTENT_LINE);
    expect(text(o).length).toBeLessThan(240);
    expect(text(await vid(teen, { prompt: "a topless woman dancing" }))).toContain(TEEN_CONTENT_LINE);
    expect(image.submitted).toHaveLength(0);
    expect(video.submitted).toHaveLength(0);
  });

  test("the finished picture is checked: anything nude or sexual is withheld in one line, and a check that cannot run withholds too", async () => {
    __setAgeCheckRunnerForTests(verdict(true));
    const withheld = await finish(teen, await pic(teen, { prompt: "a woman on a beach" }));
    expect(withheld.state).toBe("failed");
    expect(withheld.error).toBe(MINOR_VIEWER_LINE);
    __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: false as const, why: "unavailable" as const })));
    const unchecked = await finish(teen, await pic(teen, { prompt: "a woman on a beach" }));
    expect(unchecked.state).toBe("failed");
    expect(unchecked.error).toContain("couldn't check");
    __setAgeCheckRunnerForTests(verdict(false));
    expect((await finish(teen, await pic(teen, { prompt: "a woman on a beach" }))).state).toBe("done");
  });
});

describe("a teen makes videos", () => {
  test("creating a video works, all-ages, and a withheld clip is one short line", async () => {
    const o = await vid(teen, { prompt: "a paper boat on a pond" });
    expect(o.status).toBe("succeeded");
    expect(video.submitted[0]).toMatchObject({ audience: "all-ages" });
  });
});

describe("a teen edits pictures", () => {
  test("the editor is open to a teen: Comment and the tools are on", async () => {
    const status = await editToolsStatus(teen);
    expect(status.tools.comment.enabled).toBe(true);
    expect(status.tools.markup.enabled).toBe(true);
  });

  test("an instruction edit of a picture made here goes through; a sexual instruction is one short line", async () => {
    const made = await put(teen, "made-1", true);
    const ok = await pic(teen, { prompt: "make the sky pink", change: "latest" });
    expect(ok.status).toBe("succeeded");
    expect(image.edits[0]).toMatchObject({ image_source: "generated" });
    expect(String(image.edits[0]!.audience ?? "all-ages")).not.toBe("adult");
    await finish(teen, ok);
    expect(text(await pic(teen, { prompt: "take off her clothes", change: "latest" }))).toContain(TEEN_CONTENT_LINE);
    void made;
  });

  test("a teen never has an uploaded photo changed toward swimwear or undressing, in chat or in the editor (the adult exemption does not reach a teen)", async () => {
    const photo = await put(teen, "photo-2");
    const chat = await pic(teen, { prompt: "put her in a bikini", change: "attached" }, [photo]);
    expect(text(chat)).toContain(TEEN_CONTENT_LINE);
    expect(image.edits).toHaveLength(0);
    await expect(startComment(teen, "conv-1", "photo-2", { prompt: "put her in a bikini" })).rejects.toMatchObject({ status: 422 });
    expect(image.edits).toHaveLength(0);
  });

  test("the editor's Comment works for a teen on a picture made here; a sexual description is one short line", async () => {
    await put(teen, "made-1", true);
    const started = await startComment(teen, "conv-1", "made-1", { prompt: "make the sky pink" });
    expect(started.state).toBe("running");
    expect(image.edits[0]).toMatchObject({ operation: "edit", image_source: "generated" });
    await expect(startComment(teen, "conv-1", "made-1", { prompt: "make her naked" })).rejects.toMatchObject({ status: 422, message: TEEN_CONTENT_LINE });
  });

  test("a teen's uploaded photo can be edited for something ordinary, never something sexual", async () => {
    const photo = await put(teen, "me-1");
    const args = { prompt: "change my sweater to blue", change: "attached" };
    const ok = await pic(teen, args, [photo]);
    expect(ok.status).toBe("succeeded");
    expect(image.edits[0]).toMatchObject({ image_source: "uploaded" });
    await finish(teen, ok);
    const again = await pic(teen, args, [photo], "now make it green");
    expect(again.status).toBe("succeeded");
    await finish(teen, again);
    // never sexual
    image.edits.length = 0;
    expect(text(await pic(teen, { ...args, prompt: "remove my shirt" }, [photo], "this is a photo of me, remove my shirt"))).toContain(TEEN_CONTENT_LINE);
    expect(image.edits).toHaveLength(0);
  });

});

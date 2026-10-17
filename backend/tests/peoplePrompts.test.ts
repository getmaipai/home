// PEOPLE-PROMPTS-01 (owner ruling 2026-10-17: "it's annoying"): the household switch `generation.people_prompts` (default off) takes away the
// extra friction (hedging guidance to the model, the second ask about who is in a photo) and nothing else. Every safety line is asserted
// with the switch OFF and ON: a child is refused, nothing sexual involving a minor, a real person's likeness without the recorded
// consent, a photo that may show a child, the fail-closed freeze. And the model can never attest who is in a photo.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import sharp from "sharp";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { people as peopleTable } from "@/db/schema";
import { setHouseholdSettingValue, setValue } from "@/lib/settings";
import { createBenchPeople, type BenchPeople } from "../scripts/bench/conversationRunner";
import { removeTemporaryChatImages, storeTemporaryChatImage } from "@/lib/attachments";
import { __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { runGenerateImage } from "@/lib/pictures/tool";
import { runGenerateVideo } from "@/lib/videos/tool";
import { getPictureJob } from "@/lib/pictures/jobs";
import { __setPhotoInspectorForTests } from "@/lib/likeness/inspector";
import { __setStackTrustForTests } from "@/lib/likeness/proof";
import { __resetAttestationsForTests } from "@/lib/likeness/resolve";
import { toolSpecFor } from "@/lib/turnMachine/nodes/model";
import { __setStackClientForTests, __resetStackEngineForTests } from "@/lib/stackEngine";
import type { StackClient } from "@/lib/stack/client";
import { installFakeImageStack, testPng, until, type FakeImageStack } from "./pictureFixture";
import { installFakeVideoStack, type FakeVideoStack } from "./videoFixture";
import { eq } from "drizzle-orm";
import type { PersonRow } from "@/types";
import type { ToolExecutionOutcome } from "@/lib/turnMachine/contract";

let bench: BenchPeople;
let marlow: PersonRow;
let nadia: PersonRow;
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
  bench = createBenchPeople();
  marlow = addPerson("Marlow", "adult");
  nadia = addPerson("Nadia", "adult");
  child = addPerson("Pippa", "child");
  image = installFakeImageStack();
  video = installFakeVideoStack();
  __setStackTrustForTests({ ok: true });
  __setPhotoInspectorForTests(async () => ({ people: 1, faces: 1, under18: "no" }));
  __resetAttestationsForTests();
  __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { people_count: 0, apparent_min_age_estimate: null, label: "none" as const, is_nude_or_sexual: false, confidence: 1 } })));
});
afterEach(() => { removeTemporaryChatImages("conv-1"); image.restore(); video.restore(); __setStackTrustForTests(null); __setPhotoInspectorForTests(undefined); __setStackClientForTests(null); __resetStackEngineForTests(); setHouseholdSettingValue("generation.people_prompts", false); });

type Img = { id: string; name: string; width: number; height: number; media_type: string };
async function put(owner: PersonRow, id: string): Promise<Img> {
  storeTemporaryChatImage({ id, turnId: "turn-1", conversationId: "conv-1", ownerPersonId: owner.id, name: `${id}.png`, mediaType: "image/png", width: 64, height: 64, bytes: await testPng() });
  return { id, name: `${id}.png`, width: 64, height: 64, media_type: "image/png" };
}
function stateFor(actor: PersonRow, images: Img[] = [], utterance = "") {
  return { actor, surface: "chat" as never, speakerEvidence: undefined, planBasis: { surfaceClass: "written" } as never, plan: undefined as never, conversationId: "conv-1", turnId: `turn-${Math.random()}`, temporary: true, ephemeral: false, images, utterance } as never;
}
const pic = (actor: PersonRow, args: Record<string, unknown>, images: Img[] = [], utterance = "") => runGenerateImage({ state: stateFor(actor, images, utterance), args, callId: "c1", spoken: false });
const vid = (actor: PersonRow, args: Record<string, unknown>, images: Img[] = [], utterance = "") => runGenerateVideo({ state: stateFor(actor, images, utterance), args, callId: "c2", spoken: false });
const text = (o: ToolExecutionOutcome) => (o.result?.reply as { text?: string } | undefined)?.text ?? "";
const refusedWith = (o: ToolExecutionOutcome) => (o.result?.data as { refused?: string } | undefined)?.refused;
const jobId = (o: ToolExecutionOutcome) => (o.result?.data as { pictureJobId?: string }).pictureJobId!;

const BOTH = [false, true] as const;

describe("the switch takes away friction only", () => {
  test("off by default; while off the model is told not to hedge, while on it is not", async () => {
    const off = toolSpecFor("generate_image")!;
    expect(off.description).toContain("Do not add warnings");
    expect(toolSpecFor("generate_video")!.description).toContain("Do not add warnings");
    const ok = await pic(nadia, { prompt: "a red fox in the snow" });
    expect(text(ok)).toContain("Do not add warnings");
    await until(() => ["done", "failed"].includes(getPictureJob(nadia, jobId(ok))?.state ?? ""));
    setHouseholdSettingValue("generation.people_prompts", true);
    expect(toolSpecFor("generate_image")!.description).not.toContain("Do not add warnings");
    expect(text(await pic(nadia, { prompt: "a blue whale at dusk" }))).not.toContain("Do not add warnings");
  });

  test("ask at most once: what a person said about a photo is remembered while the switch is off, and asked again while it is on; the model never writes to it", async () => {
    const photo = await put(nadia, "photo-1");
    const ask = { prompt: "change her dress to red", change: "attached", affects_people: true, photo_subject: "me" };
    expect(refusedWith(await pic(nadia, ask, [photo], "change her dress to red"))).toBe("who_is_in_photo");
    const first = await pic(nadia, ask, [photo], "this is a photo of me, change my dress to red");
    expect(first.status).toBe("succeeded");
    await until(() => ["done", "failed"].includes(getPictureJob(nadia, jobId(first))?.state ?? ""));
    // Later, no claim in the message: remembered (off).
    const again = await pic(nadia, ask, [photo], "now make it blue");
    expect(refusedWith(again)).toBeUndefined();
    expect(again.status).toBe("succeeded");
    await until(() => ["done", "failed"].includes(getPictureJob(nadia, jobId(again))?.state ?? ""));
    // On: asked again whenever the message does not say.
    setHouseholdSettingValue("generation.people_prompts", true);
    expect(refusedWith(await pic(nadia, ask, [photo], "now make it green"))).toBe("who_is_in_photo");
    // Another person's own photo is not covered by Nadia's answer: the memory is per person and per photo.
    setHouseholdSettingValue("generation.people_prompts", false);
    const other = await put(marlow, "photo-2");
    expect(refusedWith(await pic(marlow, { ...ask, photo_subject: "me" }, [other], "make it blue"))).toBe("who_is_in_photo");
  });
});

describe("the hard lines hold with the switch off and on", () => {
  for (const on of BOTH) {
    describe(`people_prompts = ${on}`, () => {
      beforeEach(() => setHouseholdSettingValue("generation.people_prompts", on));

      test("a child is held to the cartoon lane whatever this says: refused with the home switch off, never a photo or a real person", async () => {
        setHouseholdSettingValue("generation.kids", false);
        expect(text(await pic(child, { prompt: "a friendly dragon" }))).toContain("Making pictures is off for this profile");
        expect(text(await vid(child, { prompt: "a friendly dragon waving" }))).toContain("Making videos is off for this profile");
        setHouseholdSettingValue("generation.kids", true);
        const real = await pic(child, { prompt: "a picture of a famous singer", depicts_real_person: true });
        expect(text(real)).toContain("how about a friendly dragon");
        const photo = await put(child, "photo-1");
        expect(text(await pic(child, { prompt: "make it pink", change: "attached" }, [photo]))).toContain("not from photos");
        expect(image.submitted).toHaveLength(0);
        expect(video.submitted).toHaveLength(0);
      });

      test("nothing sexual involving a minor, and no real person without consent", async () => {
        expect(text(await pic(nadia, { prompt: "a naked child on a beach" }))).toContain("never allowed");
        expect(text(await pic(nadia, { prompt: "a portrait of a famous senator", depicts_real_person: true }))).toContain("real person");
        expect(text(await vid(nadia, { prompt: "a famous senator waving", depicts_real_person: true }))).toContain("real person");
        expect(image.submitted).toHaveLength(0);
        expect(video.submitted).toHaveLength(0);
      });

      test("a household person's likeness needs their recorded consent and the signed proof", async () => {
        const photo = await put(nadia, "photo-1");
        const off = await pic(nadia, { prompt: "add her to the bench", change: "attached", affects_people: true, photo_subject: "Marlow" }, [photo], "the photo is Marlow");
        expect(text(off)).toContain("Marlow hasn't agreed");
        const v = await vid(nadia, { prompt: "she waves", from_picture: "attached", photo_subject: "Marlow" }, [photo], "animate this, it is Marlow");
        expect(text(v)).toContain("Marlow hasn't agreed");
        expect(image.edits).toHaveLength(0);
        expect(video.submitted).toHaveLength(0);
        expect(setValue(marlow, `person:${marlow.id}`, "likeness.adults", true).ok).toBe(true);
        const ok = await pic(nadia, { prompt: "change her dress to red", change: "attached", affects_people: true, photo_subject: "Marlow" }, [photo], "the photo is Marlow");
        expect(ok.status).toBe("succeeded");
        expect(image.edits[0]).toMatchObject({ image_source: "household_photo", audience: "adult" });
        expect(String(image.edits[0]!.consent_proof).split(".")).toHaveLength(2);
      });

      test("a photo that may show a child is never used for a person", async () => {
        const photo = await put(nadia, "photo-1");
        __setPhotoInspectorForTests(async () => ({ people: 1, faces: 1, under18: "yes" }));
        expect(text(await pic(nadia, { prompt: "change her dress", change: "attached", affects_people: true, photo_subject: "me" }, [photo], "a photo of me, change my dress"))).toContain("may show a child");
        expect(image.edits).toHaveLength(0);
      });

      test("the freeze fails closed: a finder that misses a person changes nothing", async () => {
        const photo = await put(nadia, "photo-1");
        __setPhotoInspectorForTests(async () => ({ people: 3, faces: 3, under18: "no" }));
        const mask = (await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer()).toString("base64");
        __setStackClientForTests({ imageTools: async () => ({}), roles: async () => ({ roles: [] }), imageEdit: async () => ({ kind: "done", job: "j", item: { b64_json: mask, width: 64, height: 64, content_type: "image/png", operation: "people_mask", people: [{ id: 1, x: 0, y: 0, w: 1, h: 1, area: 0.5 }] } }) } as unknown as StackClient);
        const o = await pic(nadia, { prompt: "make the sky clear", change: "attached" }, [photo]);
        await until(() => ["done", "failed"].includes(getPictureJob(nadia, jobId(o))?.state ?? ""));
        expect(getPictureJob(nadia, jobId(o))!.state).toBe("failed");
        expect(image.edits).toHaveLength(0);
      });

      test("the model's photo_subject never attests a stranger as the speaker", async () => {
        const photo = await put(nadia, "stranger");
        const o = await pic(nadia, { prompt: "change her dress", change: "attached", affects_people: true, photo_subject: "me" }, [photo], "change her dress");
        expect(refusedWith(o)).toBe("who_is_in_photo");
        expect(image.edits).toHaveLength(0);
      });
    });
  }
});

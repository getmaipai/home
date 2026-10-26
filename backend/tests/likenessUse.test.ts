import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createPublicKey, verify as verifySignature } from "node:crypto";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { people as peopleTable } from "@/db/schema";
import { setValue } from "@/lib/settings";
import { likenessStillAllowed } from "@/lib/likeness/guard";
import { preparePhotoUse, prepareStyleUse } from "@/lib/likeness/apply";
import { decideLikeness } from "@/lib/likeness/decide";
import { __setStackTrustForTests, proofPublicKey } from "@/lib/likeness/proof";
import { __setPhotoInspectorForTests } from "@/lib/likeness/inspector";
import { createBenchPeople, type BenchPeople } from "../scripts/bench/conversationRunner";
import { storeTemporaryChatImage } from "@/lib/attachments";
import { runGenerateImage } from "@/lib/pictures/tool";
import { getPictureJob } from "@/lib/pictures/jobs";
import { runGenerateVideo } from "@/lib/videos/tool";
import { installFakeImageStack, type FakeImageStack, testPng } from "./pictureFixture";
import { installFakeVideoStack, type FakeVideoStack } from "./videoFixture";
import { resolveDeclaredAdult, subjectEligibility } from "@/lib/likeness/resolve";
import { deletePerson } from "@/lib/personLifecycle";
import { declareStyleSubject, getStyleSubject } from "@/lib/likeness/adapters";
import { until } from "./pictureFixture";
import { attestedAdult } from "@/lib/likeness/resolve";
import { prepareEditSource } from "@/lib/pictures/editSources";
import type { PersonRow } from "@/types";
import type { ToolExecutionOutcome } from "@/lib/turnMachine/contract";

let bench: BenchPeople;
let subject: PersonRow;
let requester: PersonRow;
let imageStack: FakeImageStack;
let videoStack: FakeVideoStack;
const PIC_STYLE = "lora-cccccccccccccccc";
const VID_STYLE = "lora-dddddddddddddddd";

function addPerson(name: string, role: string): PersonRow {
  const now = new Date().toISOString();
  db.insert(peopleTable).values({ id: `p-${name.toLowerCase()}`, displayName: name, role, avatarSeed: name, source: "test", createdAt: now, updatedAt: now, hlc: "1:0:test00" }).run();
  return db.select().from(peopleTable).where(eq(peopleTable.id, `p-${name.toLowerCase()}`)).get()! as PersonRow;
}
const setHousehold = (on: boolean) => setValue(bench.owner, "household", "generation.household_likeness", on);

beforeEach(() => {
  resetDb();
  bench = createBenchPeople();
  subject = addPerson("Marlow", "adult");
  requester = addPerson("Nadia", "adult");
  imageStack = installFakeImageStack();
  videoStack = installFakeVideoStack();
  imageStack.loras.push({ id: PIC_STYLE, name: "Marlow portrait", sha256: "c".repeat(64), bytes: 100, base_model: "flux2-klein-4b", licence: "Apache-2.0", source_url: null, classification: "all-ages", trigger_words: [], strength_default: 1, added_at: "2026-10-17T00:00:00Z", likeness_subject: subject.id });
  videoStack.loras.push({ id: VID_STYLE, name: "Marlow motion", sha256: "d".repeat(64), bytes: 100, base_model: "wan2.2-ti2v-5b", licence: "Apache-2.0", source_url: null, classification: "all-ages", trigger_words: [], strength_default: 1, added_at: "2026-10-17T00:00:00Z", likeness_subject: subject.id });
  __setStackTrustForTests({ ok: true });
  __setPhotoInspectorForTests(async () => ({ people: 1, faces: 1, under18: "no" }));
});
afterEach(() => { imageStack.restore(); videoStack.restore(); __setStackTrustForTests(null); __setPhotoInspectorForTests(undefined); });

type Image = { id: string; name: string; width: number; height: number; media_type: string };
type StateOver = { images?: Image[]; utterance?: string };
function stateFor(actor: PersonRow, over: StateOver = {}) {
  return { actor, surface: "chat", speakerEvidence: undefined, planBasis: { surfaceClass: "written" }, plan: undefined, conversationId: "conv-1", turnId: "turn-1", temporary: true, ephemeral: false, images: over.images, utterance: over.utterance ?? "" } as never;
}
const text = (outcome: ToolExecutionOutcome) => (outcome.result?.reply as { text?: string } | undefined)?.text ?? "";
const audience = (actor: PersonRow, over: Partial<{ band: "adult" | "teen" | "child"; surface: string; surfaceClass: "written" | "glance" | "spoken"; spoken: boolean }> = {}) => ({ actor, band: "adult" as const, surface: "chat" as const, surfaceClass: "written" as const, spoken: false, ...over }) as never;

describe("household likeness jobs", () => {
  test("styles of another adult follow the household option", async () => {
    expect(setHousehold(false).ok).toBe(true);
    const off = await prepareStyleUse({ medium: "picture", audience: audience(requester), style: { id: PIC_STYLE, name: "Marlow portrait", likeness_subject: subject.id }, depictsRealPerson: true, source: "chat" });
    expect(off).toMatchObject({ kind: "refused" });
    expect(setHousehold(true).ok).toBe(true);
    const on = await prepareStyleUse({ medium: "picture", audience: audience(requester), style: { id: PIC_STYLE, name: "Marlow portrait", likeness_subject: subject.id }, depictsRealPerson: true, source: "chat" });
    expect(on).toMatchObject({ kind: "likeness", subjectId: subject.id });
  });

  test("Home proofs verify and are limited to the one style use", async () => {
    const prep = await prepareStyleUse({ medium: "picture", audience: audience(requester), style: { id: PIC_STYLE, name: "Marlow portrait", likeness_subject: subject.id }, depictsRealPerson: true, source: "chat" });
    expect(prep.kind).toBe("likeness");
    if (prep.kind !== "likeness") return;
    const [payload, signature] = prep.proof.split(".");
    const key = createPublicKey({ key: Buffer.from(proofPublicKey().spki, "base64"), format: "der", type: "spki" });
    expect(verifySignature(null, Buffer.from(payload!), key, Buffer.from(signature!, "base64url"))).toBe(true);
    expect(JSON.parse(Buffer.from(payload!, "base64url").toString("utf8"))).toMatchObject({ purpose: "style_use", subject: subject.id, requester: requester.id, bind: PIC_STYLE });
  });

  test("untrusted or too-old Stack creates no proof or job", async () => {
    __setStackTrustForTests({ ok: false, code: "stack_old", line: "The engine on this computer is too old." });
    const prep = await prepareStyleUse({ medium: "picture", audience: audience(requester), style: { id: PIC_STYLE, name: "Marlow portrait", likeness_subject: subject.id }, depictsRealPerson: true, source: "chat" });
    expect(prep).toMatchObject({ kind: "refused" });
    expect(imageStack.submitted).toHaveLength(0);
  });

  test("requester age and surface gates hold for both likeness ways", async () => {
    const teen = addPerson("Rill", "teen");
    const guest = addPerson("Visitor", "guest");
    for (const actor of [bench.child, teen, guest]) {
      expect(await prepareStyleUse({ medium: "picture", audience: audience(actor), style: { id: PIC_STYLE, name: "Marlow portrait", likeness_subject: subject.id }, depictsRealPerson: true, source: "chat" })).toMatchObject({ kind: "refused" });
      expect(await preparePhotoUse({ medium: "video", audience: audience(actor), declaredSubjectId: subject.id, bytes: new Uint8Array([1]), source: "chat" })).toMatchObject({ kind: "refused" });
    }
    for (const over of [{ surfaceClass: "spoken" as const, spoken: true }, { surfaceClass: "glance" as const, surface: "tv" }]) {
      expect(decideLikeness({ requester: audience(requester, over), subjectPersonId: subject.id })).toMatchObject({ ok: false });
    }
  });

  test("a child, teen, guest or departed subject is never eligible", async () => {
    const teen = addPerson("Rill", "teen");
    const guest = addPerson("Visitor", "guest");
    const gone = addPerson("Gone", "adult");
    db.update(peopleTable).set({ deletedAt: new Date().toISOString() }).where(eq(peopleTable.id, gone.id)).run();
    for (const id of [bench.child.id, teen.id, guest.id, gone.id]) {
      expect(subjectEligibility(id).ok).toBe(false);
      const prep = await prepareStyleUse({ medium: "picture", audience: audience(requester), style: { id: PIC_STYLE, name: "Marlow portrait", likeness_subject: id }, depictsRealPerson: true, source: "chat" });
      expect(prep).toMatchObject({ kind: "refused" });
    }
  });

  test("no engine-side nudity negative is added for another adult (models censor); a style of another adult is used as asked", async () => {
    const other = await prepareStyleUse({ medium: "picture", audience: audience(requester), style: { id: PIC_STYLE, name: "Marlow portrait", likeness_subject: subject.id }, depictsRealPerson: true, source: "chat" });
    expect(other).toMatchObject({ kind: "likeness", self: false });
    expect(other).not.toHaveProperty("negativePrompt");
    const outcome = await runGenerateImage({ state: stateFor(requester), args: { prompt: "Marlow in the bedroom", style: "Marlow portrait", depicts_real_person: true }, callId: "no-negative", spoken: false });
    expect(outcome.status).toBe("succeeded");
    expect((imageStack.submitted[0] as { negative_prompt?: string } | undefined)?.negative_prompt).toBeUndefined();
  });

  test("names shared with a child or guest resolve to nobody", () => {
    const child = db.select().from(peopleTable).where(eq(peopleTable.id, bench.child.id)).get()! as PersonRow;
    const guest = addPerson("Visitor", "guest");
    db.update(peopleTable).set({ displayName: subject.displayName }).where(eq(peopleTable.id, child.id)).run();
    expect(resolveDeclaredAdult(subject.displayName, requester)).toBeNull();
    db.update(peopleTable).set({ displayName: subject.displayName }).where(eq(peopleTable.id, guest.id)).run();
    expect(resolveDeclaredAdult(subject.displayName, requester)).toBeNull();
  });

  test("photo subject proposal is not an attestation, and ambiguous household names fail closed", () => {
    expect(attestedAdult("Marlow", "animate the photo", requester).attested).toBeNull();
    expect(attestedAdult("Marlow", "this photo is Marlow", requester).attested?.id).toBe(subject.id);
  });

  test("an undeclared subject, stranger and unrecognized name make no clip", async () => {
    const bytes = await testPng();
    const photo: Image = { id: "photo-names", name: "photo.png", width: 64, height: 64, media_type: "image/png" };
    storeTemporaryChatImage({ id: photo.id, turnId: "turn-1", conversationId: "conv-1", ownerPersonId: requester.id, name: photo.name, mediaType: "image/png", width: 64, height: 64, bytes });
    for (const proposal of [undefined, "someone else", "a stranger", "Nobody here"]) {
      const result = await runGenerateVideo({ state: stateFor(requester, { images: [photo], utterance: "animate this photo, it is my neighbor" }), args: { prompt: "they wave", from_picture: "attached", ...(proposal === undefined ? {} : { photo_subject: proposal }) }, callId: "photo-names", spoken: false });
      expect((result.result?.data as { refused?: string } | undefined)?.refused).toBe("likeness");
    }
    expect(videoStack.submitted).toHaveLength(0);
  });

  test("an adult-only generated picture of another adult can be edited as that adult's likeness (models censor)", async () => {
    const bytes = await testPng();
    const edit = await prepareEditSource({ audience: audience(requester), bytes, generated: true, rootLikeness: subject.id, declaredSubjectId: null, text: "make the background blue", source: "chat" });
    expect(edit).toMatchObject({ ok: true });
    expect(edit).not.toHaveProperty("negativePrompt");
  });

  test("a photo with multiple people, no face, uncertain age or no inspector answer fails closed", async () => {
    const bytes = await testPng();
    const photo: Image = { id: "photo-check", name: "photo.png", width: 64, height: 64, media_type: "image/png" };
    storeTemporaryChatImage({ id: photo.id, turnId: "turn-1", conversationId: "conv-1", ownerPersonId: requester.id, name: photo.name, mediaType: "image/png", width: 64, height: 64, bytes });
    for (const facts of [{ people: 2, faces: 2, under18: "no" }, { people: 1, faces: 0, under18: "no" }, { people: 1, faces: 1, under18: "unsure" }, { people: 1, faces: 1, under18: "yes" }, null] as const) {
      __setPhotoInspectorForTests(async () => facts as never);
      const result = await runGenerateVideo({ state: stateFor(requester, { images: [photo], utterance: "animate this photo, it is Marlow" }), args: { prompt: "she waves", from_picture: "attached", photo_subject: "Marlow" }, callId: "photo-check", spoken: false });
      expect((result.result?.data as { refused?: string } | undefined)?.refused).toBe("likeness");
    }
    expect(videoStack.submitted).toHaveLength(0);
  });

  test("deleting a subject stops a waiting job and queues that person's styles for removal", async () => {
    imageStack.pollsToFinish = 100;
    declareStyleSubject({ adapterId: PIC_STYLE, medium: "picture", subjectPersonId: subject.id, classification: "all-ages", declaredBy: requester.id });
    const outcome = await runGenerateImage({ state: stateFor(requester), args: { prompt: "a portrait", style: "Marlow portrait", depicts_real_person: true }, callId: "delete-subject", spoken: false });
    const id = (outcome.result?.data as { pictureJobId: string }).pictureJobId;
    expect(getStyleSubject("picture", PIC_STYLE)?.state).toBe("active");
    expect(deletePerson(bench.owner, subject.id).ok).toBe(true);
    await until(() => getPictureJob(requester, id)?.state === "failed");
    expect(getPictureJob(requester, id)?.error).toContain("can no longer be used as a subject");
    expect(getStyleSubject("picture", PIC_STYLE)?.state).not.toBe("active");
  });

  test("a queued job is withheld if the household option goes off", () => {
    const job = { subject: subject.id, requester: requester.id, way: "style" as const };
    expect(likenessStillAllowed(job)).toEqual({ ok: true });
    expect(setHousehold(false).ok).toBe(true);
    expect(likenessStillAllowed(job)).toMatchObject({ ok: false });
  });

  test("adult content of another adult is not refused by Home in picture and video style tools (the model decides)", async () => {
    const image = await runGenerateImage({ state: stateFor(requester), args: { prompt: "she undresses slowly", style: "Marlow portrait", depicts_real_person: true }, callId: "img-1", spoken: false });
    expect(image.status).toBe("succeeded");
    expect(imageStack.submitted).toHaveLength(1);
    const video = await runGenerateVideo({ state: stateFor(requester), args: { prompt: "she undresses slowly", style: "Marlow motion", depicts_real_person: true }, callId: "vid-1", spoken: false });
    expect(video.status).toBe("succeeded");
    expect(videoStack.submitted).toHaveLength(1);
  });

  test("an adult-only style of another adult is used as asked", async () => {
    const prep = await prepareStyleUse({ medium: "picture", audience: audience(requester), style: { id: PIC_STYLE, name: "Marlow portrait", likeness_subject: subject.id, classification: "adult-only" }, depictsRealPerson: true, source: "chat" });
    expect(prep).toMatchObject({ kind: "likeness", subjectId: subject.id });
  });

  test("a teen and a child can never make a likeness, with or without sexual wording, and a minor is never a subject", async () => {
    const teen = addPerson("Quill", "teen");
    const child = addPerson("Sprout", "child");
    for (const [person, band] of [[teen, "teen"], [child, "child"]] as const) {
      for (const style of [{ id: PIC_STYLE, name: "Marlow portrait", likeness_subject: subject.id }, { id: PIC_STYLE, name: "Marlow portrait", likeness_subject: subject.id, classification: "adult-only" as const }]) {
        expect(await prepareStyleUse({ medium: "picture", audience: audience(person, { band }), style, depictsRealPerson: true, source: "chat" })).toMatchObject({ kind: "refused" });
      }
      expect(decideLikeness({ requester: audience(person, { band }), subjectPersonId: subject.id })).toMatchObject({ ok: false, denial: "requester" });
      expect(decideLikeness({ requester: audience(requester), subjectPersonId: person.id })).toMatchObject({ ok: false, denial: "subject_minor" });
    }
    expect(imageStack.submitted).toHaveLength(0);
  });

  test("self adult content is allowed through likeness decision", async () => {
    const own = await prepareStyleUse({ medium: "picture", audience: audience(subject), style: { id: PIC_STYLE, name: "Marlow portrait", likeness_subject: subject.id }, depictsRealPerson: true, source: "chat" });
    expect(own).toMatchObject({ kind: "likeness", self: true });
  });

  test("the photo path no longer refuses adult wording for an adult", async () => {
    const prep = await preparePhotoUse({ medium: "video", audience: audience(subject), declaredSubjectId: subject.id, bytes: new Uint8Array([1]), source: "chat" });
    expect(prep).toMatchObject({ kind: "likeness", self: true });
  });
});

// LIKENESS-01: the rules for pictures and videos that look like a household adult (owner's ruling, 2026-10-17), run through
// the real tools against fake Stacks: consent off blocks, consent on allows, taking it back stops what waits, a minor or a
// guest or a spoken or shared screen never, a subject who is not an adult, an undeclared subject, a photo that is not one
// adult, the separate adult-content switch, the notification and the use log, and the signed proof Home sends.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createVerify, createPublicKey, verify as verifySig } from "node:crypto";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { likenessConsentEvents, people as peopleTable } from "@/db/schema";
import { declareStyleSubject, getStyleSubject } from "@/lib/likeness/adapters";
import { resolveDeclaredAdult } from "@/lib/likeness/resolve";
import { likenessStillAllowed } from "@/lib/likeness/guard";
import { prepareStylesUse } from "@/lib/likeness/apply";
import { consentHistory } from "@/lib/likeness/consent";
import { forgetLikenessOfPerson } from "@/lib/likeness/history";
import { setValue } from "@/lib/settings";
import "@/lib/likeness/revoke";
import { createBenchPeople, type BenchPeople } from "../scripts/bench/conversationRunner";
import { storeTemporaryChatImage } from "@/lib/attachments";
import { runGenerateImage } from "@/lib/pictures/tool";
import { runGenerateVideo } from "@/lib/videos/tool";
import { getPictureJob } from "@/lib/pictures/jobs";
import { getVideoJobFor } from "@/lib/videos/jobs";
import { __resetAttestationsForTests } from "@/lib/likeness/resolve";
import { __setPhotoInspectorForTests } from "@/lib/likeness/inspector";
import { __setStackTrustForTests, mintProof, proofPublicKey, photoBind } from "@/lib/likeness/proof";
import { checkStyleSubject } from "@/lib/likeness/importStyle";
import { likenessUseLog } from "@/lib/likeness/uses";
import { listPending } from "@/lib/notifications";
import { installFakeImageStack, type FakeImageStack, testPng, until } from "./pictureFixture";
import { installFakeVideoStack, type FakeVideoStack } from "./videoFixture";
import type { PersonRow } from "@/types";
import type { ToolExecutionOutcome } from "@/lib/turnMachine/contract";

let bench: BenchPeople;
let marlow: PersonRow;
let nadia: PersonRow;
let imageStack: FakeImageStack;
let videoStack: FakeVideoStack;
const STYLE_ID = "lora-cccccccccccccccc";

function addPerson(name: string, role: string): PersonRow {
  const now = new Date().toISOString();
  db.insert(peopleTable).values({ id: `p-${name.toLowerCase()}`, displayName: name, role, avatarSeed: name, source: "test", createdAt: now, updatedAt: now, hlc: "1:0:test00" }).run();
  return db.select().from(peopleTable).where(eq(peopleTable.id, `p-${name.toLowerCase()}`)).get()! as PersonRow;
}
const switchOn = (person: PersonRow, key = "likeness.adults") => expect(setValue(person, `person:${person.id}`, key, true).ok).toBe(true);
const switchOff = (person: PersonRow, key = "likeness.adults") => expect(setValue(person, `person:${person.id}`, key, false).ok).toBe(true);

beforeEach(() => {
  resetDb();
  __resetAttestationsForTests();
  bench = createBenchPeople();
  marlow = addPerson("Marlow", "adult");
  nadia = addPerson("Nadia", "adult");
  imageStack = installFakeImageStack();
  videoStack = installFakeVideoStack();
  imageStack.loras.push({ id: STYLE_ID, name: "Marlow portrait", sha256: "c".repeat(64), bytes: 100, base_model: "flux2-klein-4b", licence: "Apache-2.0", source_url: null, classification: "adult-only", trigger_words: [], strength_default: 1, added_at: "2026-10-17T00:00:00Z", likeness_subject: marlow.id });
  videoStack.loras.push({ id: "lora-dddddddddddddddd", name: "Marlow motion", sha256: "d".repeat(64), bytes: 100, base_model: "wan2.2-ti2v-5b", licence: "Apache-2.0", source_url: null, classification: "adult-only", trigger_words: [], strength_default: 1, added_at: "2026-10-17T00:00:00Z", likeness_subject: marlow.id });
  __setStackTrustForTests({ ok: true });
  __setPhotoInspectorForTests(async () => ({ people: 1, faces: 1, under18: "no" }));
});
afterEach(() => { imageStack.restore(); videoStack.restore(); __setStackTrustForTests(null); __setPhotoInspectorForTests(undefined); });

type StateOver = { surfaceClass?: "written" | "glance" | "spoken"; surface?: string; images?: Array<{ id: string; name: string; width: number; height: number; media_type: string }>; utterance?: string };
function stateFor(actor: PersonRow, over: StateOver = {}) {
  return { actor, surface: (over.surface ?? "chat") as never, speakerEvidence: undefined, planBasis: { surfaceClass: over.surfaceClass ?? "written" } as never, plan: undefined as never, conversationId: "conv-1", turnId: "turn-1", temporary: true, ephemeral: false, images: over.images, utterance: over.utterance ?? "" } as never;
}
const replyText = (outcome: ToolExecutionOutcome) => (outcome.result?.reply as { text?: string } | undefined)?.text ?? "";
const refusedWith = (outcome: ToolExecutionOutcome) => (outcome.result?.data as { refused?: string } | undefined)?.refused;
const portrait = { prompt: "a portrait in a garden at dusk", style: "Marlow portrait", depicts_real_person: true };
const run = (actor: PersonRow, args: Record<string, unknown>, over: StateOver = {}) => runGenerateImage({ state: stateFor(actor, over), args, callId: "c1", spoken: over.surfaceClass === "spoken" });

describe("a saved style of a household adult (pictures)", () => {
  test("consent off blocks it: nothing is sent to the Stack and the reply says who must agree", async () => {
    const outcome = await run(nadia, portrait);
    expect(imageStack.submitted).toHaveLength(0);
    expect(refusedWith(outcome)).toBe("likeness");
    expect(replyText(outcome)).toContain("Marlow hasn't agreed");
    expect(likenessUseLog(marlow.id)).toHaveLength(0);
  });

  test("consent on allows it: a signed proof for that style rides along, the picture is for an adult audience, the person is told and the use is logged", async () => {
    switchOn(marlow);
    const outcome = await run(nadia, portrait);
    expect(outcome.status).toBe("succeeded");
    expect(imageStack.submitted).toHaveLength(1);
    const sent = imageStack.submitted[0]! as { audience: string; negative_prompt?: string; loras: Array<{ id: string; likeness_proof?: string }> };
    expect(sent.audience).toBe("adult");
    expect(sent.loras[0]!.id).toBe(STYLE_ID);
    // The proof verifies against Home's public key, is for this style and this person, and ends within the Stack's cap.
    const [payload, signature] = sent.loras[0]!.likeness_proof!.split(".");
    const key = createPublicKey({ key: Buffer.from(proofPublicKey().spki, "base64"), format: "der", type: "spki" });
    expect(verifySig(null, Buffer.from(payload!), key, Buffer.from(signature!, "base64url"))).toBe(true);
    const body = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8")) as { purpose: string; subject: string; requester: string; bind: string; iat: number; exp: number };
    expect(body).toMatchObject({ purpose: "style_use", subject: marlow.id, requester: nadia.id, bind: STYLE_ID });
    expect(body.exp - body.iat).toBeLessThanOrEqual(29 * 60);
    // Without adult consent the engine is told to keep adult content out.
    expect(sent.negative_prompt).toContain("nude");
    const log = likenessUseLog(marlow.id);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ who: "Nadia", medium: "picture", way: "style", adult_content: false });
    const told = listPending(marlow);
    expect(told.some((n) => n.text.includes("Nadia made a picture with a saved style of you"))).toBe(true);
  });

  test("the second switch is separate: adult words need it, and it counts only beside the first", async () => {
    switchOn(marlow);
    const adult = { ...portrait, prompt: "a nude portrait in a garden at dusk" };
    const refused = await run(nadia, adult);
    expect(replyText(refused)).toContain("not to adult content");
    expect(imageStack.submitted).toHaveLength(0);
    switchOn(marlow, "likeness.adult_content");
    const allowed = await run(nadia, adult);
    expect(allowed.status).toBe("succeeded");
    expect(imageStack.submitted).toHaveLength(1);
    expect(likenessUseLog(marlow.id)[0]!.adult_content).toBe(true);
    // Only the second switch on, the first off: refused.
    switchOff(marlow);
    expect(replyText(await run(nadia, portrait))).toContain("hasn't agreed");
  });

  test("taking consent back while the picture waits stops it, and asking again is refused at once", async () => {
    imageStack.pollsToFinish = 50;
    switchOn(marlow);
    const outcome = await run(nadia, portrait);
    const jobId = (outcome.result?.data as { pictureJobId: string }).pictureJobId;
    expect(getPictureJob(nadia, jobId)!.state).not.toBe("done");
    switchOff(marlow);
    await until(() => getPictureJob(nadia, jobId)!.state === "failed", 3000);
    expect(getPictureJob(nadia, jobId)!.error).toContain("took back their agreement");
    expect(imageStack.jobs[0]!.deleted).toBe(true);
    const again = await run(nadia, portrait);
    expect(replyText(again)).toContain("hasn't agreed");
    expect(imageStack.submitted).toHaveLength(1);
  });

  test("a child, a teen, a guest, a spoken turn and a shared screen never, whatever anyone agreed to", async () => {
    switchOn(marlow); switchOn(marlow, "likeness.adult_content");
    const teen = addPerson("Rill", "teen");
    const guest = addPerson("Visitor", "guest");
    for (const actor of [bench.child, teen, guest]) expect((await run(actor, portrait)).result?.data).toMatchObject({ refused: expect.any(String) });
    expect(refusedWith(await run(nadia, portrait, { surfaceClass: "spoken" }))).toBe("spoken");
    expect(refusedWith(await run(nadia, portrait, { surfaceClass: "glance", surface: "tv" }))).toBe("shared_screen");
    expect(imageStack.submitted).toHaveLength(0);
  });

  test("a style whose subject is a child, a teen or someone who left is refused even with every switch on", async () => {
    switchOn(marlow);
    const teen = addPerson("Rill", "teen");
    for (const subject of [bench.child.id, teen.id, "p-nobody"]) {
      imageStack.loras.find((l) => l.id === STYLE_ID)!.likeness_subject = subject;
      const outcome = await run(nadia, portrait);
      expect(refusedWith(outcome)).toBe("likeness");
    }
    expect(imageStack.submitted).toHaveLength(0);
  });

  test("the person using their own style needs no one's agreement, and nobody is told", async () => {
    expect((await run(marlow, portrait)).status).toBe("succeeded");
    expect(imageStack.submitted).toHaveLength(1);
    expect(likenessUseLog(marlow.id)).toHaveLength(0);
  });

  test("a real person with no style: an adult on their own screen may make it (owner, 2026-10-25), sexual content and everyone else never", async () => {
    switchOn(marlow);
    const allowed = await run(nadia, { prompt: "a portrait of a famous actor", depicts_real_person: true });
    expect(refusedWith(allowed)).toBeUndefined();
    expect(imageStack.submitted).toHaveLength(1);
    const sexual = await run(nadia, { prompt: "a sexual portrait of a famous actor", depicts_real_person: true });
    expect(refusedWith(sexual)).toBe("real_person");
    const guest = addPerson("Visitor 2", "guest");
    expect(refusedWith(await run(guest, { prompt: "a portrait of a famous actor", depicts_real_person: true }))).toBeDefined();
    expect(imageStack.submitted).toHaveLength(1);
  });

  test("when the Stack does not trust this Home or is too old, nothing is made", async () => {
    switchOn(marlow);
    __setStackTrustForTests({ ok: false, code: "stack_old", line: "The engine on this computer is too old for pictures and videos of a person." });
    expect(replyText(await run(nadia, portrait))).toContain("too old");
    expect(imageStack.submitted).toHaveLength(0);
  });
});

// ---- a photo that was attached

async function attachPhoto(owner: PersonRow): Promise<{ id: string; name: string; width: number; height: number; media_type: string }> {
  const bytes = await testPng();
  storeTemporaryChatImage({ id: "photo-1", turnId: "turn-1", conversationId: "conv-1", ownerPersonId: owner.id, name: "photo.png", mediaType: "image/png", width: 64, height: 64, bytes });
  return { id: "photo-1", name: "photo.png", width: 64, height: 64, media_type: "image/png" };
}
// The person's own message is what attests who is in the photo (the model's `photo_subject` is only a proposal): by default the message says it.
const sayWho = (subject: unknown) => (typeof subject !== "string" || !subject ? "" : subject.toLowerCase() === "me" ? "animate this photo of me" : `animate this photo, it is ${subject}`);
const animate = async (actor: PersonRow, args: Record<string, unknown>, images?: StateOver["images"], utterance = sayWho(args.photo_subject)) =>
  runGenerateVideo({ state: stateFor(actor, { images, utterance }), args: { prompt: "she smiles and turns her head", from_picture: "attached", ...args }, callId: "c2", spoken: false });

describe("an attached photo of a household adult (video)", () => {
  test("allowed only when the requester names the adult, that adult agreed, and the photo shows exactly them: the photo's own hash is what the proof is for", async () => {
    const photo = await attachPhoto(nadia);
    const refusedOff = await animate(nadia, { photo_subject: "Marlow" }, [photo]);
    expect(replyText(refusedOff)).toContain("Marlow hasn't agreed");
    expect(videoStack.submitted).toHaveLength(0);
    switchOn(marlow);
    const ok = await animate(nadia, { photo_subject: "Marlow" }, [photo]);
    expect(ok.status).toBe("succeeded");
    const sent = videoStack.submitted[0]! as { image_source: string; consent_proof: string; audience: string; image: string };
    expect(sent).toMatchObject({ image_source: "household_photo", audience: "adult" });
    const payload = JSON.parse(Buffer.from(sent.consent_proof.split(".")[0]!, "base64url").toString("utf8")) as { purpose: string; subject: string; bind: string };
    expect(payload).toMatchObject({ purpose: "photo", subject: marlow.id, bind: photoBind(Buffer.from(sent.image, "base64")) });
    expect(likenessUseLog(marlow.id)[0]).toMatchObject({ medium: "video", way: "photo", who: "Nadia" });
    expect(listPending(marlow).some((n) => n.text.includes("a video from a photo of you"))).toBe(true);
  });

  test("undeclared, 'someone else', a child, a stranger or a name that is no one in the household is refused", async () => {
    switchOn(marlow);
    const photo = await attachPhoto(nadia);
    for (const subject of [undefined, "", "someone else", "my friend", "Bramble", "Taylor Swift"]) {
      const outcome = await animate(nadia, subject === undefined ? {} : { photo_subject: subject }, [photo]);
      expect(refusedWith(outcome)).toBe("likeness");
    }
    expect(videoStack.submitted).toHaveLength(0);
  });

  test("a photo with more than one person, no face, a possible child, an unsure age or no answer from the model is refused (fail closed)", async () => {
    switchOn(marlow);
    const photo = await attachPhoto(nadia);
    const facts = [{ people: 2, faces: 2, under18: "no" }, { people: 1, faces: 0, under18: "no" }, { people: 1, faces: 1, under18: "yes" }, { people: 1, faces: 1, under18: "unsure" }, { people: 0, faces: 0, under18: "no" }, null] as const;
    for (const answer of facts) {
      __setPhotoInspectorForTests(async () => (answer ? { ...answer } as never : null));
      expect(refusedWith(await animate(nadia, { photo_subject: "Marlow" }, [photo]))).toBe("likeness");
    }
    expect(videoStack.submitted).toHaveLength(0);
  });

  test("a photo of a real person is never turned into adult content, whatever anyone agreed to", async () => {
    switchOn(marlow); switchOn(marlow, "likeness.adult_content");
    const photo = await attachPhoto(nadia);
    const outcome = await animate(nadia, { photo_subject: "Marlow", prompt: "she undresses slowly" }, [photo]);
    expect(replyText(outcome)).toContain("never turn a photo of a real person into adult content");
    expect(videoStack.submitted).toHaveLength(0);
  });

  test("a child, a teen, a guest or a spoken turn cannot animate a photo of anyone", async () => {
    switchOn(marlow);
    const photo = await attachPhoto(nadia);
    const teen = addPerson("Rill", "teen");
    const guest = addPerson("Visitor", "guest");
    for (const actor of [bench.child, teen, guest]) expect(refusedWith(await animate(actor, { photo_subject: "Marlow" }, [photo]))).toBeDefined();
    const spoken = await runGenerateVideo({ state: stateFor(nadia, { surfaceClass: "spoken", images: [photo] }), args: { prompt: "she smiles", from_picture: "attached", photo_subject: "Marlow" }, callId: "c3", spoken: true });
    expect(refusedWith(spoken)).toBe("spoken");
    expect(videoStack.submitted).toHaveLength(0);
  });

  test("taking consent back while the clip waits stops it", async () => {
    videoStack.pollsToFinish = 200;
    switchOn(marlow);
    const photo = await attachPhoto(nadia);
    const ok = await animate(nadia, { photo_subject: "Marlow" }, [photo]);
    const jobId = (ok.result?.data as { videoJobId: string }).videoJobId;
    switchOff(marlow);
    await until(() => getVideoJobFor(nadia, jobId)!.state === "failed", 3000);
    expect(getVideoJobFor(nadia, jobId)!.error).toContain("took back their agreement");
    expect(videoStack.jobs[0]!.deleted).toBe(true);
  });

  test("the person animating a photo of themselves needs no one's agreement and nobody is told", async () => {
    const photo = await attachPhoto(marlow);
    const ok = await animate(marlow, { photo_subject: "me" }, [photo]);
    expect(ok.status).toBe("succeeded");
    expect(likenessUseLog(marlow.id)).toHaveLength(0);
  });
});

describe("a saved video style of a household adult", () => {
  test("is gated by the same consent and carries a proof for that style", async () => {
    const args = { prompt: "she walks along the shore at sunset", style: "Marlow motion", depicts_real_person: true };
    const off = await runGenerateVideo({ state: stateFor(nadia), args, callId: "c4", spoken: false });
    expect(replyText(off)).toContain("hasn't agreed");
    switchOn(marlow);
    const on = await runGenerateVideo({ state: stateFor(nadia), args, callId: "c5", spoken: false });
    expect(on.status).toBe("succeeded");
    const sent = videoStack.submitted[0]! as { audience: string; loras: Array<{ likeness_proof?: string }> };
    expect(sent.audience).toBe("adult");
    expect(sent.loras[0]!.likeness_proof).toBeDefined();
  });
});

describe("the answer to 'Who does this style look like?'", () => {
  test("nobody is fine; a consenting adult is fine; the adder themselves is fine; a child, a teen, a guest, a non-consenting adult or no answer is refused", () => {
    const teen = addPerson("Rill", "teen");
    const guest = addPerson("Visitor", "guest");
    expect(checkStyleSubject("nobody", nadia)).toMatchObject({ ok: true, kind: "nobody" });
    expect(checkStyleSubject("", nadia)).toMatchObject({ ok: false, code: "likeness_unconfirmed" });
    expect(checkStyleSubject(marlow.id, nadia)).toMatchObject({ ok: false, code: "consent_off" });
    switchOn(marlow);
    expect(checkStyleSubject(marlow.id, nadia)).toMatchObject({ ok: true, kind: "person" });
    expect(checkStyleSubject(nadia.id, nadia)).toMatchObject({ ok: true, kind: "person", self: true });
    for (const id of [bench.child.id, teen.id, guest.id, "p-unknown"]) expect(checkStyleSubject(id, nadia)).toMatchObject({ ok: false });
  });
});

test("a proof minted by Home verifies and is single purpose", () => {
  const token = mintProof({ purpose: "photo", subject: marlow.id, requester: nadia.id, bind: "a".repeat(64) });
  const [payload, signature] = token.split(".");
  const key = createPublicKey({ key: Buffer.from(proofPublicKey().spki, "base64"), format: "der", type: "spki" });
  expect(verifySig(null, Buffer.from(payload!), key, Buffer.from(signature!, "base64url"))).toBe(true);
  expect(createVerify).toBeDefined();
});

describe("review fixes", () => {
  test("a switch that was 'on' with no history (a restored backup) still stops what waits and queues styles when turned off", async () => {
    imageStack.pollsToFinish = 50;
    switchOn(marlow);
    declareStyleSubject({ adapterId: STYLE_ID, medium: "picture", subjectPersonId: marlow.id, classification: "adult-only", declaredBy: nadia.id });
    const outcome = await run(nadia, portrait);
    const jobId = (outcome.result?.data as { pictureJobId: string }).pictureJobId;
    db.delete(likenessConsentEvents).run();
    switchOff(marlow);
    await until(() => getPictureJob(nadia, jobId)!.state === "failed", 3000);
    expect(getStyleSubject("picture", STYLE_ID)!.state).not.toBe("active");
  });

  test("a name that a child or a guest shares with an adult is ambiguous and resolves to no one", () => {
    const samLee = addPerson("Sam Lee", "adult");
    expect(resolveDeclaredAdult("Sam", nadia)?.id).toBe(samLee.id);
    addPerson("Sam Park", "child");
    expect(resolveDeclaredAdult("Sam", nadia)).toBeNull();
    expect(resolveDeclaredAdult("Sam Lee", nadia)?.id).toBe(samLee.id);
    expect(resolveDeclaredAdult("Bramble", nadia)).toBeNull();
  });

  test("a person making it of themselves is stopped if they stop being an eligible adult while it waits", () => {
    const job = { subject: nadia.id, requester: nadia.id, way: "photo" as const, adult_content: false };
    expect(likenessStillAllowed(job).ok).toBe(true);
    db.update(peopleTable).set({ role: "teen" }).where(eq(peopleTable.id, nadia.id)).run();
    expect(likenessStillAllowed(job).ok).toBe(false);
  });

  test("several styles: two different people are refused, and another adult-only style beside the likeness counts as adult content", async () => {
    switchOn(marlow); switchOn(nadia);
    declareStyleSubject({ adapterId: "lora-111", medium: "picture", subjectPersonId: marlow.id, classification: "adult-only", declaredBy: nadia.id });
    declareStyleSubject({ adapterId: "lora-222", medium: "picture", subjectPersonId: nadia.id, classification: "adult-only", declaredBy: nadia.id });
    const audience = { actor: bench.owner, band: "adult" as const, surface: "chat" as const, surfaceClass: "written" as const, spoken: false };
    const two = await prepareStylesUse({ medium: "picture", audience, styles: [{ id: "lora-111", name: "A" }, { id: "lora-222", name: "B" }], text: "x", source: "chat" });
    expect(two.kind).toBe("refused");
    const withAdultStyle = await prepareStylesUse({ medium: "picture", audience, styles: [{ id: "lora-111", name: "A" }, { id: "lora-999", name: "Other", classification: "adult-only" }], text: "a portrait", source: "chat" });
    expect(withAdultStyle.kind).toBe("refused");
    switchOn(marlow, "likeness.adult_content");
    const allowed = await prepareStylesUse({ medium: "picture", audience, styles: [{ id: "lora-111", name: "A" }, { id: "lora-999", name: "Other", classification: "adult-only" }], text: "a portrait", source: "chat" });
    expect(allowed.kind).toBe("likeness");
    if (allowed.kind === "likeness") expect([...allowed.proofs.keys()]).toEqual(["lora-111"]);
  });

  test("deleting a person stops what waits for them, queues their styles and erases their consent history and use records", async () => {
    switchOn(marlow);
    declareStyleSubject({ adapterId: STYLE_ID, medium: "picture", subjectPersonId: marlow.id, classification: "adult-only", declaredBy: nadia.id });
    await run(nadia, portrait);
    expect(likenessUseLog(marlow.id)).toHaveLength(1);
    forgetLikenessOfPerson(marlow.id);
    expect(likenessUseLog(marlow.id)).toHaveLength(0);
    expect(consentHistory(marlow.id)).toHaveLength(0);
    expect(getStyleSubject("picture", STYLE_ID)!.state).not.toBe("active");
  });
});

describe("the model's photo_subject never attests who is in a video photo (safety review)", () => {
  test("a stranger's photo plus an invented 'me', a wrong name, and no claim at all ask who it is and start no clip; the person's own claim or the name works", async () => {
    const photo = await attachPhoto(nadia);
    switchOn(marlow);
    const noClaim = await animate(nadia, { photo_subject: "me" }, [photo], "make this photo move");
    expect(replyText(noClaim)).toContain("Who is in this photo?");
    const wrong = await animate(nadia, { photo_subject: "Marlow" }, [photo], "make this photo move, it is my neighbour");
    expect(replyText(wrong)).toContain("Who is in this photo?");
    expect(videoStack.submitted).toHaveLength(0);
    const self = await animate(nadia, { photo_subject: "me" }, [photo], "animate this photo of me");
    expect(self.status).toBe("succeeded");
    expect(videoStack.submitted).toHaveLength(1);
    expect(videoStack.submitted[0]).toMatchObject({ image_source: "household_photo" });
  });

  test("a named adult counts only when the message names them", async () => {
    const photo = await attachPhoto(nadia);
    switchOn(marlow);
    const named = await animate(nadia, { photo_subject: "Marlow" }, [photo], "animate this, the photo is Marlow");
    expect(named.status).toBe("succeeded");
    expect(videoStack.submitted[0]).toMatchObject({ image_source: "household_photo" });
  });
});

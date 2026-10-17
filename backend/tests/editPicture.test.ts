// IMGEDIT-01: the chat tool's edit half (`generate_image` with `change`), run through the real tool against fake Stacks.
// What it proves: a change in words reaches the Stack as an edit with the right source declaration; a photo of a person is
// used only for a household adult who agreed; nothing is sent when a rule refuses; "remove that person" finds the people,
// picks the one meant (or asks which), erases only those, and never draws anyone; the result is the next version of the
// picture so the original is kept.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { people as peopleTable } from "@/db/schema";
import { setValue } from "@/lib/settings";
import { createBenchPeople, type BenchPeople } from "../scripts/bench/conversationRunner";
import { removeTemporaryChatImages, storeTemporaryChatImage } from "@/lib/attachments";
import { runGenerateImage } from "@/lib/pictures/tool";
import { getPictureJob } from "@/lib/pictures/jobs";
import { listVersions } from "@/lib/imageEdit";
import { __setPhotoInspectorForTests } from "@/lib/likeness/inspector";
import { __setStackTrustForTests } from "@/lib/likeness/proof";
import { likenessUseLog } from "@/lib/likeness/uses";
import { __setPersonPickerForTests } from "@/lib/pictures/people";
import { __setPictureStatusForTests, readyStatusForTests } from "@/lib/pictures/ready";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import type { StackClient } from "@/lib/stack/client";
import { StackError } from "@/lib/stack/errors";
import { installFakeImageStack, testPng, until, type FakeImageStack } from "./pictureFixture";
import type { PersonRow } from "@/types";
import type { ToolExecutionOutcome } from "@/lib/turnMachine/contract";

let bench: BenchPeople;
let marlow: PersonRow;
let nadia: PersonRow;
let stack: FakeImageStack;

function addPerson(name: string, role: string): PersonRow {
  const now = new Date().toISOString();
  db.insert(peopleTable).values({ id: `p-${name.toLowerCase()}`, displayName: name, role, avatarSeed: name, source: "test", createdAt: now, updatedAt: now, hlc: "1:0:test00" }).run();
  return db.select().from(peopleTable).where(eq(peopleTable.id, `p-${name.toLowerCase()}`)).get()! as PersonRow;
}
const switchOn = (person: PersonRow, key = "likeness.adults") => expect(setValue(person, `person:${person.id}`, key, true).ok).toBe(true);

beforeEach(() => {
  resetDb();
  bench = createBenchPeople();
  marlow = addPerson("Marlow", "adult");
  nadia = addPerson("Nadia", "adult");
  stack = installFakeImageStack();
  __setStackTrustForTests({ ok: true });
  __setPhotoInspectorForTests(async () => ({ people: 0, faces: 0, under18: "no" }));
});
afterEach(() => { removeTemporaryChatImages("conv-1"); stack.restore(); __setStackTrustForTests(null); __setPhotoInspectorForTests(undefined); __setPersonPickerForTests(undefined); __setStackClientForTests(null); __resetStackEngineForTests(); });

type Img = { id: string; name: string; width: number; height: number; media_type: string };
async function put(owner: PersonRow, id: string, over: { generated?: true } = {}): Promise<Img> {
  const bytes = await testPng();
  storeTemporaryChatImage({ id, turnId: "turn-1", conversationId: "conv-1", ownerPersonId: owner.id, name: `${id}.png`, mediaType: "image/png", width: 64, height: 64, bytes, ...over });
  return { id, name: `${id}.png`, width: 64, height: 64, media_type: "image/png" };
}
function stateFor(actor: PersonRow, images: Img[] = []) {
  return { actor, surface: "chat" as never, speakerEvidence: undefined, planBasis: { surfaceClass: "written" } as never, plan: undefined as never, conversationId: "conv-1", turnId: "turn-1", temporary: true, ephemeral: false, images } as never;
}
const run = (actor: PersonRow, args: Record<string, unknown>, images: Img[] = []) => runGenerateImage({ state: stateFor(actor, images), args, callId: "c1", spoken: false });
const replyText = (outcome: ToolExecutionOutcome) => (outcome.result?.reply as { text?: string } | undefined)?.text ?? "";
const refusedWith = (outcome: ToolExecutionOutcome) => (outcome.result?.data as { refused?: string } | undefined)?.refused;
const jobIdOf = (outcome: ToolExecutionOutcome) => (outcome.result?.data as { pictureJobId?: string }).pictureJobId!;
const finished = async (actor: PersonRow, outcome: ToolExecutionOutcome) => {
  const id = jobIdOf(outcome);
  await until(() => ["done", "failed"].includes(getPictureJob(actor, id)?.state ?? ""));
  return getPictureJob(actor, id)!;
};

describe("a change in words", () => {
  test("a picture this home made goes to the Stack as an edit of a generated picture, and the result is the next version, the original kept", async () => {
    const made = await put(nadia, "made-1", { generated: true });
    const outcome = await run(nadia, { prompt: "make the sky clear blue with no clouds", change: "latest" }, []);
    expect(outcome.status).toBe("succeeded");
    expect(stack.edits).toHaveLength(1);
    expect(stack.edits[0]).toMatchObject({ operation: "edit", instruction: "make the sky clear blue with no clouds", image_source: "generated" });
    expect(stack.edits[0]!.reference).toBeUndefined();
    expect(stack.submitted).toHaveLength(0);
    const job = await finished(nadia, outcome);
    expect(job.state).toBe("done");
    expect(job.kind).toBe("edit");
    expect(job.files).toHaveLength(1);
    expect(job.files[0]!.id).not.toBe(made.id);
    const versions = listVersions(nadia, "conv-1", job.files[0]!.id);
    expect(versions.map((v) => v.label)).toEqual(["Original", "make the sky clear blue with no clouds"]);
    expect(versions[0]!.id).toBe(made.id);
  });

  test("an attached photo that shows no one is sent as an upload; one that shows a person is refused unless an adult who agreed is named", async () => {
    const photo = await put(nadia, "photo-1");
    const ok = await run(nadia, { prompt: "change the car to bright yellow", change: "attached" }, [photo]);
    expect(stack.edits[0]).toMatchObject({ image_source: "uploaded" });
    expect(ok.status).toBe("succeeded");
    stack.edits.length = 0;
    __setPhotoInspectorForTests(async () => ({ people: 2, faces: 2, under18: "no" }));
    const refused = await run(nadia, { prompt: "make the sky clear", change: "attached" }, [photo]);
    expect(refusedWith(refused)).toBe("photo_has_person");
    expect(stack.edits).toHaveLength(0);
    // The engine's own checker being down is a refusal too, never a guess.
    __setPhotoInspectorForTests(null);
    expect(refusedWith(await run(nadia, { prompt: "make the sky clear", change: "attached" }, [photo]))).toBe("photo_check_unavailable");
    expect(stack.edits).toHaveLength(0);
  });

  test("a photo of a person is never changed into something sexual, and the absolute lines still run first", async () => {
    const photo = await put(nadia, "photo-1");
    const undress = await run(nadia, { prompt: "take off her shirt", change: "attached" }, [photo]);
    expect(refusedWith(undress)).toBe("real_person");
    const minor = await run(nadia, { prompt: "make the 12 year old girl naked", change: "attached" }, [photo]);
    expect(replyText(minor)).toContain("Pictures of children in sexual situations are never allowed");
    expect(stack.edits).toHaveLength(0);
  });

  test("adding a person from a second picture needs that adult's agreement: the reference goes with its own proof, and the use is logged", async () => {
    const scene = await put(nadia, "scene-1", { generated: true });
    const portrait = await put(nadia, "portrait-1");
    __setPhotoInspectorForTests(async () => ({ people: 1, faces: 1, under18: "no" }));
    const off = await run(nadia, { prompt: "add the woman from the second picture to the bench", change: "attached", reference: "attached_2", photo_subject: "Marlow" }, [scene, portrait]);
    expect(replyText(off)).toContain("Marlow hasn't agreed");
    expect(stack.edits).toHaveLength(0);
    switchOn(marlow);
    const ok = await run(nadia, { prompt: "add the woman from the second picture to the bench", change: "attached", reference: "attached_2", photo_subject: "Marlow" }, [scene, portrait]);
    expect(ok.status).toBe("succeeded");
    expect(stack.edits[0]).toMatchObject({ image_source: "generated", reference_source: "household_photo", audience: "adult" });
    expect(String(stack.edits[0]!.reference_proof).split(".")).toHaveLength(2);
    expect(stack.edits[0]!.reference).toMatch(/^file:/);
    expect(likenessUseLog(marlow.id)).toHaveLength(1);
    const job = await finished(nadia, ok);
    expect(job.state).toBe("done");
    expect(job.request.likeness?.subject).toBe(marlow.id);
  });

  test("a second picture of someone who is not named, a child, or a stranger is refused and nothing is sent", async () => {
    const scene = await put(nadia, "scene-1", { generated: true });
    const portrait = await put(nadia, "portrait-1");
    __setPhotoInspectorForTests(async () => ({ people: 1, faces: 1, under18: "no" }));
    const unnamed = await run(nadia, { prompt: "add her to the picture", change: "attached", reference: "attached_2" }, [scene, portrait]);
    expect(unnamed.status).toBe("succeeded");
    expect(replyText(unnamed)).toContain("which adult");
    const stranger = await run(nadia, { prompt: "add her to the picture", change: "attached", reference: "attached_2", photo_subject: "my neighbour" }, [scene, portrait]);
    expect(replyText(stranger)).toContain("which adult");
    __setPhotoInspectorForTests(async () => ({ people: 1, faces: 1, under18: "yes" }));
    switchOn(marlow);
    const child = await run(nadia, { prompt: "add her to the picture", change: "attached", reference: "attached_2", photo_subject: "Marlow" }, [scene, portrait]);
    expect(replyText(child)).toContain("may show a child");
    expect(stack.edits).toHaveLength(0);
  });

  test("an older Stack that cannot take a second picture is told plainly; a missing picture is said; the same picture twice is refused", async () => {
    const scene = await put(nadia, "scene-1", { generated: true });
    const portrait = await put(nadia, "portrait-1");
    __setPictureStatusForTests(readyStatusForTests({ edit: { generative: true, masked: true } }));
    const old = await run(nadia, { prompt: "add her", change: "attached", reference: "attached_2", photo_subject: "me" }, [scene, portrait]);
    expect(replyText(old)).toContain("next update");
    __setPictureStatusForTests(undefined);
    __setPictureStatusForTests(readyStatusForTests());
    expect(replyText(await run(nadia, { prompt: "add her", change: "attached", reference: "attached_2" }, [scene]))).toContain("can't find that picture");
    removeTemporaryChatImages("conv-1");
    expect(replyText(await run(nadia, { prompt: "fix it", change: "latest" }, []))).toContain("no picture to change yet");
    const again = await put(nadia, "scene-1", { generated: true });
    expect(replyText(await run(nadia, { prompt: "add her", change: "attached", reference: "attached" }, [again]))).toContain("different picture");
    expect(stack.edits).toHaveLength(0);
  });
});

function toolsStub(handler: (form: FormData) => Promise<unknown>): { client: StackClient; forms: FormData[] } {
  const forms: FormData[] = [];
  const client = { imageTools: async () => ({}), roles: async () => ({ roles: [] }), imageEdit: async (form: FormData) => { forms.push(form); return handler(form); } } as unknown as StackClient;
  return { client, forms };
}
async function overlay(): Promise<string> { return (await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 10, g: 10, b: 10 } } }).png().toBuffer()).toString("base64"); }
const done = async (extra: Record<string, unknown>) => ({ kind: "done", job: "j", item: { b64_json: await overlay(), width: 64, height: 64, content_type: "image/png", operation: "x", engine: "apple-vision+lama", model: "big-lama-onnx", ms: 9, ...extra } });
const TWO = [{ id: 1, x: 0.1, y: 0.2, w: 0.3, h: 0.6, area: 0.1 }, { id: 2, x: 0.6, y: 0.2, w: 0.2, h: 0.5, area: 0.07 }];

describe("remove people", () => {
  test("the person meant is picked by number and only that one is erased; the photo can show people because nothing is drawn", async () => {
    const photo = await put(nadia, "photo-1");
    __setPhotoInspectorForTests(async () => ({ people: 2, faces: 2, under18: "unsure" }));
    const seen: Array<{ who: string; ids: number[] }> = [];
    __setPersonPickerForTests(async (_overlay, found, who) => { seen.push({ who, ids: found.map((p) => p.id) }); return [2]; });
    const { client, forms } = toolsStub(async (form) => (form.get("operation") === "find_people" ? done({ people: TWO, operation: "find_people" }) : done({ people: TWO, operation: "erase_people" })));
    __setStackClientForTests(client);
    const outcome = await run(nadia, { prompt: "remove the man in the red jacket", change: "attached", kind: "remove_people", who: "the man in the red jacket" }, [photo]);
    expect(outcome.status).toBe("succeeded");
    const job = await finished(nadia, outcome);
    expect(job.state).toBe("done");
    expect(seen).toEqual([{ who: "the man in the red jacket", ids: [1, 2] }]);
    expect(forms.map((f) => f.get("operation"))).toEqual(["find_people", "erase_people"]);
    expect(forms[1]!.get("people")).toBe("2");
    expect(stack.edits).toHaveLength(0);
    expect(listVersions(nadia, "conv-1", job.files[0]!.id).map((v) => v.label)).toEqual(["Original", "Removed: remove the man in the red jacket"]);
  });

  test("on a picture made here the chosen person's outline is filled by the picture model (a masked edit), and LaMa takes over if that fails", async () => {
    const made = await put(nadia, "made-1", { generated: true });
    __setPersonPickerForTests(async () => [2]);
    const { client, forms } = toolsStub(async (form) => done({ people: TWO, operation: String(form.get("operation")) }));
    __setStackClientForTests(client);
    const job = await finished(nadia, await run(nadia, { prompt: "remove the man", change: "latest", kind: "remove_people", who: "the man" }));
    expect(job.state).toBe("done");
    expect(forms.map((f) => f.get("operation"))).toEqual(["find_people", "people_mask"]);
    expect(stack.edits).toHaveLength(1);
    expect(stack.edits[0]).toMatchObject({ operation: "edit_masked", image_source: "generated" });
    expect(stack.edits[0]!.mask).toMatch(/^file:/);
    expect(listVersions(nadia, "conv-1", job.files[0]!.id)[0]!.id).toBe(made.id);
    // The picture model refusing the fill falls back to LaMa: the same person is erased instead.
    stack.edits.length = 0; forms.length = 0;
    stack.refuseSubmit = { status: 503, code: "no_memory", error: "Not enough free memory." };
    const fallback = await finished(nadia, await run(nadia, { prompt: "remove the man", change: "latest", kind: "remove_people", who: "the man" }));
    expect(fallback.state).toBe("done");
    expect(forms.map((f) => f.get("operation"))).toEqual(["find_people", "people_mask", "erase_people"]);
  });

  test("when the reader cannot tell which person, nothing is erased and the person is told how to point; everyone and a lone person need no reader", async () => {
    const photo = await put(nadia, "photo-1");
    __setPersonPickerForTests(async () => null);
    const { client, forms } = toolsStub(async (form) => done({ people: form.get("operation") === "find_people" ? TWO : TWO }));
    __setStackClientForTests(client);
    const unsure = await finished(nadia, await run(nadia, { prompt: "remove the tall one", change: "attached", kind: "remove_people", who: "the tall one" }, [photo]));
    expect(unsure.state).toBe("failed");
    expect(unsure.error).toContain("couldn't tell which one");
    expect(forms.map((f) => f.get("operation"))).toEqual(["find_people"]);
    forms.length = 0;
    const all = await finished(nadia, await run(nadia, { prompt: "take everyone out", change: "attached", kind: "remove_people", who: "everyone" }, [photo]));
    expect(all.state).toBe("done");
    expect(forms[1]!.get("people")).toBe("all");
    forms.length = 0;
    const lone = toolsStub(async () => done({ people: [TWO[0]] }));
    __setStackClientForTests(lone.client);
    const one = await finished(nadia, await run(nadia, { prompt: "remove her", change: "attached", kind: "remove_people", who: "her" }, [photo]));
    expect(one.state).toBe("done");
    expect(lone.forms[1]!.get("people")).toBe("1");
  });

  test("remove_background and upscale run the Stack's tools on the picture, draw nothing, and save the next version", async () => {
    const photo = await put(nadia, "photo-1");
    __setPhotoInspectorForTests(async () => ({ people: 3, faces: 3, under18: "yes" }));
    const { client, forms } = toolsStub(async () => done({}));
    __setStackClientForTests(client);
    const cut = await finished(nadia, await run(nadia, { prompt: "remove the background", change: "attached", kind: "remove_background" }, [photo]));
    expect(cut.state).toBe("done");
    const big = await finished(nadia, await run(nadia, { prompt: "make it bigger", change: "attached", kind: "upscale" }, [photo]));
    expect(big.state).toBe("done");
    expect(forms.map((f) => f.get("operation"))).toEqual(["remove_background", "upscale"]);
    expect(forms[1]!.get("scale")).toBe("2");
    expect(stack.edits).toHaveLength(0);
    expect(listVersions(nadia, "conv-1", cut.files[0]!.id).map((v) => v.label)).toContain("Background removed");
  });

  test("a picture with no one in it, or a computer without the person finder, ends with a plain line, not a broken card", async () => {
    const photo = await put(nadia, "photo-1");
    const none = toolsStub(async () => { throw new StackError("unexpected", "No people were found in this picture.", { status: 422, body: JSON.stringify({ error: "No people were found in this picture.", code: "no_people" }) }); });
    __setStackClientForTests(none.client);
    const job = await finished(nadia, await run(nadia, { prompt: "remove the man", change: "attached", kind: "remove_people", who: "the man" }, [photo]));
    expect(job.state).toBe("failed");
    expect(job.error).toContain("couldn't find anyone");
    const missing = toolsStub(async () => { throw new StackError("unexpected", "not found", { status: 404, body: "" }); });
    __setStackClientForTests(missing.client);
    const old = await finished(nadia, await run(nadia, { prompt: "remove the man", change: "attached", kind: "remove_people", who: "the man" }, [photo]));
    expect(old.error).toContain("paint over the person with Erase");
  });

  test("removing someone from a picture made to look like a household adult is decided again with that adult", async () => {
    // A picture whose provenance names a subject is stored (not temporary) in real chats; here the temporary store cannot carry it, so the rule is exercised through the shared source check.
    const { prepareEditSource } = await import("@/lib/pictures/editSources");
    const audience = { actor: nadia, band: "adult", surface: "chat", surfaceClass: "written", spoken: false } as never;
    const refused = await prepareEditSource({ audience, bytes: await testPng(), generated: true, rootLikeness: marlow.id, declaredSubjectId: null, text: "remove the dog", source: "chat" });
    expect(refused.ok).toBe(false);
    switchOn(marlow);
    const allowed = await prepareEditSource({ audience, bytes: await testPng(), generated: true, rootLikeness: marlow.id, declaredSubjectId: null, text: "remove the dog", source: "chat" });
    expect(allowed).toMatchObject({ ok: true, imageSource: "household_photo" });
  });
});

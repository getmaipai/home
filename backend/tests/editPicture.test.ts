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
import { __setPersonPickerForTests, freezePeople, FreezeError } from "@/lib/pictures/people";
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
let stubbedClient = false;
afterEach(() => {
  removeTemporaryChatImages("conv-1"); stack.restore(); __setStackTrustForTests(null); __setPhotoInspectorForTests(undefined); __setPersonPickerForTests(undefined);
  // Only undo what this file set: other files in the same run may have a Stack of their own in place.
  if (stubbedClient) { __setStackClientForTests(null); __resetStackEngineForTests(); stubbedClient = false; }
});

type Img = { id: string; name: string; width: number; height: number; media_type: string };
async function put(owner: PersonRow, id: string, over: { generated?: true } = {}): Promise<Img> {
  const bytes = await testPng();
  storeTemporaryChatImage({ id, turnId: "turn-1", conversationId: "conv-1", ownerPersonId: owner.id, name: `${id}.png`, mediaType: "image/png", width: 64, height: 64, bytes, ...over });
  return { id, name: `${id}.png`, width: 64, height: 64, media_type: "image/png" };
}
function stateFor(actor: PersonRow, images: Img[] = [], utterance = "") {
  return { actor, surface: "chat" as never, speakerEvidence: undefined, planBasis: { surfaceClass: "written" } as never, plan: undefined as never, conversationId: "conv-1", turnId: "turn-1", temporary: true, ephemeral: false, images, utterance } as never;
}
const run = (actor: PersonRow, args: Record<string, unknown>, images: Img[] = [], utterance = "") => runGenerateImage({ state: stateFor(actor, images, utterance), args, callId: "c1", spoken: false });
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
    const refused = await run(nadia, { prompt: "change her dress", change: "attached", affects_people: true }, [photo]);
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
    const SAYS = "add the woman from the second picture to the bench, the photo is Marlow";
    const off = await run(nadia, { prompt: "add the woman from the second picture to the bench", change: "attached", reference: "attached_2", photo_subject: "Marlow" }, [scene, portrait], SAYS);
    expect(replyText(off)).toContain("Marlow hasn't agreed");
    expect(stack.edits).toHaveLength(0);
    switchOn(marlow);
    const ok = await run(nadia, { prompt: "add the woman from the second picture to the bench", change: "attached", reference: "attached_2", photo_subject: "Marlow" }, [scene, portrait], SAYS);
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
    const child = await run(nadia, { prompt: "add her to the picture", change: "attached", reference: "attached_2", photo_subject: "Marlow" }, [scene, portrait], "add her to the picture, she is Marlow");
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
  stubbedClient = true;
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

async function solid(r: number, g: number, b: number, size = 64): Promise<Uint8Array> {
  return new Uint8Array(await sharp({ create: { width: size, height: size, channels: 3, background: { r, g, b } } }).png().toBuffer());
}
async function squareMask(x0: number, y0: number, x1: number, y1: number, size = 64): Promise<Uint8Array> {
  const raw = Buffer.alloc(size * size);
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) raw[y * size + x] = 255;
  return new Uint8Array(await sharp(raw, { raw: { width: size, height: size, channels: 1 } }).png().toBuffer());
}
async function pixels(png: Uint8Array): Promise<{ data: Buffer; width: number }> {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width };
}

describe("freezing the people (IMGEDIT-05)", () => {
  test("every pixel inside a person's outline is the original's, the rest is the edit, and a mask that cannot be kept is an error", async () => {
    const original = await solid(10, 20, 200);
    const edited = await solid(240, 120, 30);
    const kept = await freezePeople(original, edited, await squareMask(10, 10, 30, 40));
    const { data, width } = await pixels(kept);
    const at = (x: number, y: number) => [...data.subarray((y * width + x) * 3, (y * width + x) * 3 + 3)];
    for (let y = 10; y < 40; y += 1) for (let x = 10; x < 30; x += 1) expect(at(x, y)).toEqual([10, 20, 200]);
    expect(at(55, 55)).toEqual([240, 120, 30]);
    await expect(freezePeople(original, edited, await squareMask(0, 0, 0, 0))).rejects.toBeInstanceOf(FreezeError);
  });

  test("a sky, colour or background edit of a photo that shows several people runs, with the people put back exactly; an edit about a person still needs the rules", async () => {
    const photo = await put(nadia, "photo-1");
    // The attached photo is a different picture from the engine's answer so the freeze is visible: blue photo, orange edit.
    storeTemporaryChatImage({ id: "photo-1", turnId: "turn-1", conversationId: "conv-1", ownerPersonId: nadia.id, name: "photo.png", mediaType: "image/png", width: 64, height: 64, bytes: await solid(10, 20, 200) });
    __setPhotoInspectorForTests(async () => ({ people: 2, faces: 2, under18: "yes" }));
    const outline = Buffer.from(await squareMask(8, 8, 36, 60)).toString("base64");
    const { client, forms } = toolsStub(async () => ({ kind: "done", job: "j", item: { b64_json: outline, width: 64, height: 64, content_type: "image/png", operation: "people_mask", people: TWO } }));
    __setStackClientForTests(client);
    const outcome = await run(nadia, { prompt: "make the sky clear and blue", change: "attached" }, [photo]);
    expect(outcome.status).toBe("succeeded");
    const job = await finished(nadia, outcome);
    expect(job.state).toBe("done");
    expect(forms.map((f) => f.get("operation"))).toEqual(["people_mask"]);
    expect(stack.edits[0]).toMatchObject({ operation: "edit_masked", image_source: "uploaded", feather: "0" });
    expect(stack.edits[0]!.mask).toMatch(/^file:/);
    expect(String(stack.edits[0]!.instruction)).toContain("Do not change any person");
    const saved = (await import("@/lib/imageEdit")).readPicture(nadia, "conv-1", job.files[0]!.id);
    const { data, width } = await pixels(saved.bytes);
    for (let y = 8; y < 60; y += 1) for (let x = 8; x < 36; x += 1) expect([...data.subarray((y * width + x) * 3, (y * width + x) * 3 + 3)]).toEqual([10, 20, 200]);
    // An edit that targets a person is refused for a photo that shows several people.
    stack.edits.length = 0;
    const about = await run(nadia, { prompt: "change her sweater to red", change: "attached", affects_people: true }, [photo]);
    expect(refusedWith(about)).toBe("photo_has_person");
    expect(stack.edits).toHaveLength(0);
  });

  test("when the person finder finds no one although the household's model saw people, nothing is changed", async () => {
    const photo = await put(nadia, "photo-1");
    __setPhotoInspectorForTests(async () => ({ people: 2, faces: 2, under18: "no" }));
    const none = toolsStub(async () => { throw new StackError("unexpected", "No people were found in this picture.", { status: 422, body: JSON.stringify({ code: "no_people" }) }); });
    __setStackClientForTests(none.client);
    const job = await finished(nadia, await run(nadia, { prompt: "make the sky clear", change: "attached" }, [photo]));
    expect(job.state).toBe("failed");
    expect(job.error).toContain("won't change it");
    expect(stack.edits).toHaveLength(0);
  });
});

describe("fail closed and attestation (safety review of IMGEDIT-05)", () => {
  const mask = async () => Buffer.from(await squareMask(8, 8, 36, 60)).toString("base64");
  const finder = (people: unknown[], b64: string) => toolsStub(async () => ({ kind: "done", job: "j", item: { b64_json: b64, width: 64, height: 64, content_type: "image/png", operation: "people_mask", people } }));

  test("a finder that outlines fewer people than the household's model counts changes nothing, and the engine is never asked", async () => {
    const photo = await put(nadia, "photo-1");
    __setPhotoInspectorForTests(async () => ({ people: 3, faces: 3, under18: "no" }));
    __setStackClientForTests(finder(TWO, await mask()).client);
    const job = await finished(nadia, await run(nadia, { prompt: "make the sky clear", change: "attached" }, [photo]));
    expect(job.state).toBe("failed");
    expect(job.error).toContain("every person");
    expect(stack.edits).toHaveLength(0);
  });

  test("an empty outline changes nothing", async () => {
    const photo = await put(nadia, "photo-1");
    __setPhotoInspectorForTests(async () => ({ people: 2, faces: 2, under18: "no" }));
    __setStackClientForTests(finder(TWO, Buffer.from(await squareMask(0, 0, 0, 0)).toString("base64")).client);
    const job = await finished(nadia, await run(nadia, { prompt: "make the sky clear", change: "attached" }, [photo]));
    expect(job.state).toBe("failed");
    expect(stack.edits).toHaveLength(0);
  });

  test("the engine can only change the background: the mask it gets is the inverse of the people's outline", async () => {
    const photo = await put(nadia, "photo-1");
    __setPhotoInspectorForTests(async () => ({ people: 2, faces: 2, under18: "no" }));
    __setStackClientForTests(finder(TWO, await mask()).client);
    await finished(nadia, await run(nadia, { prompt: "make the sky clear", change: "attached" }, [photo]));
    expect(stack.edits[0]).toMatchObject({ operation: "edit_masked", feather: "0" });
    const { inverseMask, maskCoverage } = await import("@/lib/pictures/people");
    const outline = await squareMask(8, 8, 36, 60);
    const background = await inverseMask(outline);
    const { data, width } = await pixels(background);
    expect(data[(20 * width + 20) * 3]).toBe(0);
    expect(data[(2 * width + 2) * 3]).toBe(255);
    expect(Math.round((await maskCoverage(outline)) * 1000)).toBe(Math.round(((28 * 52) / 4096) * 1000));
  });

  test("the model's photo_subject alone never attests who is in a photo: no claim in the person's own message asks who it is and sends nothing", async () => {
    const stranger = await put(nadia, "stranger-1");
    __setPhotoInspectorForTests(async () => ({ people: 1, faces: 1, under18: "no" }));
    const noClaim = await run(nadia, { prompt: "change her dress to red", change: "attached", affects_people: true, photo_subject: "me" }, [stranger], "change her dress to red");
    expect(refusedWith(noClaim)).toBe("who_is_in_photo");
    expect(replyText(noClaim)).toContain("Who is in this photo?");
    switchOn(marlow);
    const wrongName = await run(nadia, { prompt: "change her dress to red", change: "attached", affects_people: true, photo_subject: "Marlow" }, [stranger], "change her dress to red");
    expect(refusedWith(wrongName)).toBe("who_is_in_photo");
    expect(stack.edits).toHaveLength(0);
    // The person's own claim counts: it is a photo of the speaker, or the message names the adult.
    const claimed = await run(nadia, { prompt: "change her dress to red", change: "attached", affects_people: true, photo_subject: "me" }, [stranger], "this is a photo of me, change my dress to red");
    expect(claimed.status).toBe("succeeded");
    expect(stack.edits[0]).toMatchObject({ image_source: "household_photo", audience: "adult" });
    await finished(nadia, claimed);
    stack.edits.length = 0;
    const named = await run(nadia, { prompt: "change her dress to red", change: "attached", affects_people: true, photo_subject: "Marlow" }, [stranger], "change Marlow's dress to red");
    expect(named.status).toBe("succeeded");
    expect(stack.edits[0]).toMatchObject({ image_source: "household_photo" });
  });

  test("messageAttests: a self claim only for the speaker, a name only for that adult, a bare 'me' or 'show me' never", async () => {
    const { messageAttests } = await import("@/lib/likeness/resolve");
    expect(messageAttests("this is a photo of me", nadia, nadia)).toBe(true);
    expect(messageAttests("it's me in the picture", nadia, nadia)).toBe(true);
    expect(messageAttests("make the sky clear and show me", nadia, nadia)).toBe(false);
    expect(messageAttests("this is a photo of me", nadia, marlow)).toBe(false);
    expect(messageAttests("this is Marlow", nadia, marlow)).toBe(true);
    expect(messageAttests("this is Marlowe", nadia, marlow)).toBe(false);
    expect(messageAttests("remove the car", nadia, null)).toBe(false);
  });

  test("freezePeople reads a mask with an alpha channel as one grey channel (no half-width mask)", async () => {
    const original = await solid(10, 20, 200);
    const edited = await solid(240, 120, 30);
    const raw = Buffer.alloc(64 * 64 * 4);
    for (let y = 10; y < 40; y += 1) for (let x = 10; x < 30; x += 1) { const k = (y * 64 + x) * 4; raw[k] = raw[k + 1] = raw[k + 2] = 255; raw[k + 3] = 255; }
    const rgba = new Uint8Array(await sharp(raw, { raw: { width: 64, height: 64, channels: 4 } }).png().toBuffer());
    const { data, width } = await pixels(await freezePeople(original, edited, rgba));
    expect([...data.subarray((20 * width + 15) * 3, (20 * width + 15) * 3 + 3)]).toEqual([10, 20, 200]);
    expect([...data.subarray((55 * width + 55) * 3, (55 * width + 55) * 3 + 3)]).toEqual([240, 120, 30]);
  });
});

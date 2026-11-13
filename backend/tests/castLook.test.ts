// CREATOR-06 (CREATOR-PORT-2026-11-13): one look capture for any cast member through the one sheet builder.
import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { db } from "@/db";
import { attachments, mediaSubjects, people } from "@/db/schema";
import { createSynth, linkSynthSubject, synthById, type SynthRecord } from "@/lib/synths";
import { createMediaSubject, shareMediaSubject, getMediaSubject, subjectsForNames } from "@/lib/mediaSubjects";
import { storeFile } from "@/lib/attachments";
import { listCast, resolveCast } from "@/lib/cast";
import { captureLook, type LookSheetMaker, type LookPortraitMaker } from "@/lib/castLook";
import { sheetNote } from "@/lib/castLookKey";
import { LIKENESS_OFF_LINE } from "@/lib/likeness";
import { setHouseholdSettingValue } from "@/lib/settings";
import { makeSheetFromPictures, cutOutPause, type SheetTools } from "@/lib/films/sheetMaker";
import { resetDb } from "./reset-db";
import { child, owner, teen } from "./support/testAuth";
import type { PersonRow } from "@/types";

cutOutPause.ms = 0;
const persona = { display_name: "Marlow Fox", formality: "neutral", complexity: "standard", engagement: "balanced", filler_density: "light", audience: "all", examples: ["I like a good plan.", "Let us try that.", "Fine by me."], status: "ready" } as never;
const none = { kind: "none", person_id: null, name: null, refresh: "7d", minor: false } as const;
const solid = async (r: number, g: number, b: number) => new Uint8Array(await sharp({ create: { width: 120, height: 160, channels: 3, background: { r, g, b } } }).png().toBuffer());
const tools: SheetTools = { removeBackground: async (bytes) => bytes, findFaces: async () => [] };
// The real one builder with fake picture tools, recording what it was handed.
const calls: Array<{ names: string[]; roles: string[] }> = [];
const maker: LookSheetMaker = async (pictures) => { calls.push({ names: pictures.map((p) => p.name), roles: pictures.map((p) => p.role) }); return makeSheetFromPictures(pictures, tools); };
const portrait: LookPortraitMaker = async () => ({ bytes: await solid(10, 120, 40), mediaType: "image/png" });
async function photo(actor: PersonRow, shade: number): Promise<string> {
  const stored = storeFile(actor, { conversationId: null, turnId: null, mediaType: "image/png", bytes: await solid(shade, 90, 30), provenance: "composer:upload", retention: "kept", name: `p${shade}.png` });
  if (!stored.ok) throw new Error(stored.error);
  return stored.value.id;
}
async function world() {
  const { client, row: sage } = await owner();
  const kid = (await child(client)).row;
  await teen(client);
  const teenRow = db.select().from(people).where(eq(people.role, "teen")).get()! as PersonRow;
  const adult2 = db.select().from(people).all().find((p) => p.role === "adult" && p.id !== sage.id) as PersonRow | undefined;
  return { sage, kid, teenRow, adult2 };
}
const sheetFiles = (subjectId: string) => (JSON.parse(db.select().from(mediaSubjects).where(eq(mediaSubjects.id, subjectId)).get()!.referenceIds) as string[]).filter((id) => { const f = db.select().from(attachments).where(eq(attachments.id, id)).get(); return !!f && !!sheetNote(f.provenance); });
const created = new Set<string>();
async function makeSynth(actor: PersonRow, name: string): Promise<SynthRecord> {
  const made = await createSynth(actor, { persona: { ...(persona as object), display_name: name } as never, based_on: none, life: { enabled: false, seed: "" } });
  if (!made.ok) throw new Error(made.error);
  created.add(made.value.synth.id);
  return made.value.synth;
}
beforeEach(() => { resetDb(); calls.length = 0; created.clear(); });

describe("one sheet per cast member, reused", () => {
  test("a saved subject is captured once; the second capture and a feature read reuse the same stored sheet", async () => {
    const { sage } = await world();
    const subject = createMediaSubject(sage, { name: "Moss", kind: "character", look: "A green fox in a red scarf", referenceIds: [await photo(sage, 40)] });
    const first = await captureLook(sage, subject.id, { sheetMaker: maker });
    expect(first.ok && first.reused).toBe(false);
    const again = await captureLook(sage, "Moss", { sheetMaker: maker });
    expect(again.ok && again.reused).toBe(true);
    expect(calls).toHaveLength(1);                                    // the one builder ran once
    if (!first.ok || !again.ok) throw new Error("not ok");
    expect(again.sheet_file_id).toBe(first.sheet_file_id);
    expect(sheetFiles(subject.id)).toEqual([first.sheet_file_id]);
    const stored = db.select().from(attachments).where(eq(attachments.id, first.sheet_file_id)).get()!;
    expect(sheetNote(stored.provenance)).toMatchObject({ role: "sheet", maker: "films/sheetMaker" });
    expect(first.description.startsWith("Reference sheet: ")).toBe(true);
    // every feature reads it through resolveCast and through the subject reader a still or a video uses
    const resolved = (await resolveCast(sage, ["Moss"])).members[0]!;
    expect(resolved.look.sheet_file_id).toBe(first.sheet_file_id);
    expect(resolved.locked_description).toBe("A green fox in a red scarf");
    expect(subjectsForNames(sage, ["Moss"])![0]!.sheet?.id).toBe(first.sheet_file_id);
    expect(listCast(sage).find((e) => e.name === "Moss")!.look.sheet_stale).toBe(false);
  });

  test("a made-up character with no picture gets one portrait, then a sheet from it", async () => {
    const { sage } = await world();
    const subject = createMediaSubject(sage, { name: "Lamp", kind: "prop", look: "A brass lamp" });
    const made = await captureLook(sage, subject.id, { sheetMaker: maker, portraitMaker: portrait });
    expect(made.ok).toBe(true);
    expect(calls[0]!.roles).toEqual(["prop"]);
    expect(getMediaSubject(sage, subject.id)!.reference_ids).toHaveLength(2); // the portrait and the sheet
    const again = await captureLook(sage, subject.id, { sheetMaker: maker, portraitMaker: portrait });
    expect(again.ok && again.reused).toBe(true);
  });

  test("two captures at once build one sheet", async () => {
    const { sage } = await world();
    const subject = createMediaSubject(sage, { name: "Moss", kind: "character", look: "A green fox", referenceIds: [await photo(sage, 40)] });
    const [a, b] = await Promise.all([captureLook(sage, subject.id, { sheetMaker: maker }), captureLook(sage, subject.id, { sheetMaker: maker })]);
    expect(calls).toHaveLength(1);
    expect(a.ok && b.ok && a.sheet_file_id === b.sheet_file_id).toBe(true);
  });
});

describe("rebuild when the source pictures change", () => {
  test("a new reference picture marks the sheet stale and the next capture rebuilds it once", async () => {
    const { sage } = await world();
    const subject = createMediaSubject(sage, { name: "Moss", kind: "character", look: "A green fox", referenceIds: [await photo(sage, 40)] });
    const first = await captureLook(sage, subject.id, { sheetMaker: maker });
    const extra = await photo(sage, 80);
    const second = await captureLook(sage, subject.id, { sheetMaker: maker, photoFileIds: [extra] });
    expect(second.ok && !second.reused).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.names).toHaveLength(2);
    if (!first.ok || !second.ok) throw new Error("not ok");
    expect(second.sheet_file_id).not.toBe(first.sheet_file_id);
    expect(sheetFiles(subject.id)).toEqual([second.sheet_file_id]);        // one sheet on the subject, the old one is only left in the Library
    expect(listCast(sage).find((e) => e.name === "Moss")!.look.sheet_stale).toBe(false);
  });

  test("deleting a source picture shows the sheet as stale before any rebuild", async () => {
    const { sage } = await world();
    const a = await photo(sage, 40), b = await photo(sage, 80);
    const subject = createMediaSubject(sage, { name: "Moss", kind: "character", look: "A green fox", referenceIds: [a, b] });
    await captureLook(sage, subject.id, { sheetMaker: maker });
    db.update(attachments).set({ deletedAt: new Date().toISOString() }).where(eq(attachments.id, b)).run();
    expect(listCast(sage).find((e) => e.name === "Moss")!.look.sheet_stale).toBe(true);
    const redo = await captureLook(sage, subject.id, { sheetMaker: maker });
    expect(redo.ok && !redo.reused).toBe(true);
    expect(calls[1]!.names).toHaveLength(1);
  });

  test("a synth's new rest picture rebuilds the sheet; force rebuilds an unchanged one", async () => {
    const { sage } = await world();
    const synth = await makeSynth(sage, "Marlow Fox");
    const subject = createMediaSubject(sage, { name: "Marlow Fox", kind: "character", look: "A fox", referenceIds: [await photo(sage, 40)] });
    linkSynthSubject(sage, synth.id, subject.id);
    const first = await captureLook(sage, synth.id, { sheetMaker: maker });
    expect(first.ok).toBe(true);
    const forced = await captureLook(sage, synth.id, { sheetMaker: maker, force: true });
    expect(forced.ok && !forced.reused).toBe(true);
    expect(calls).toHaveLength(2);
  });

  test("a hand-written locked sentence survives a rebuild", async () => {
    const { sage } = await world();
    const subject = createMediaSubject(sage, { name: "Moss", kind: "character", look: "A green fox", referenceIds: [await photo(sage, 40)] });
    await captureLook(sage, subject.id, { sheetMaker: maker });
    db.update(mediaSubjects).set({ lockedDescription: "Always a red scarf, never a hat." }).where(eq(mediaSubjects.id, subject.id)).run();
    await captureLook(sage, subject.id, { sheetMaker: maker, force: true });
    expect(getMediaSubject(sage, subject.id)!.locked_description).toBe("Always a red scarf, never a hat.");
  });
});

describe("gates per band, exactly as the cast resolver applies them", () => {
  test("an adult captures a household member from photos they supply; no persona or synth is made; the child's own path stays closed", async () => {
    const { sage, kid, adult2 } = await world();
    const target = adult2 ?? sage;
    const none1 = await captureLook(sage, target.id, { sheetMaker: maker });
    if (target.id !== sage.id) expect(none1).toMatchObject({ ok: false, line: expect.stringMatching(/add one or more clear photos/i) });
    const made = await captureLook(sage, target.id, { sheetMaker: maker, photoFileIds: [await photo(sage, 40)] });
    expect(made.ok).toBe(true);
    const row = db.select().from(mediaSubjects).where(eq(mediaSubjects.personId, target.id)).get()!;
    expect(row.synthId).toBeNull();
    expect(calls.at(-1)!.roles).toEqual(["actor"]);
    // a person-linked row never becomes visible through the subject paths (canUseSubject), the CREATOR-04 review condition
    expect(getMediaSubject(sage, row.id)).toBeNull();
    expect(getMediaSubject(kid, row.id)).toBeNull();
  });

  test("a child or teen household member is never turned into a sheet, and a child or teen cannot capture a real person", async () => {
    const { sage, kid, teenRow } = await world();
    const photos = [await photo(sage, 40)];
    expect(await captureLook(sage, kid.id, { sheetMaker: maker, photoFileIds: photos })).toMatchObject({ ok: false, line: expect.stringMatching(/child's or teen's pictures/) });
    expect(await captureLook(sage, teenRow.id, { sheetMaker: maker, photoFileIds: photos })).toMatchObject({ ok: false, line: expect.stringMatching(/child's or teen's pictures/) });
    expect(await captureLook(kid, sage.id, { sheetMaker: maker, photoFileIds: [await photo(kid, 40)] })).toMatchObject({ ok: false, line: expect.stringMatching(/Real-person subjects are not available/) });
    expect(await captureLook(teenRow, sage.id, { sheetMaker: maker })).toMatchObject({ ok: false, line: expect.stringMatching(/Real-person subjects are not available/) });
    expect(calls).toHaveLength(0);
    expect(db.select().from(mediaSubjects).where(eq(mediaSubjects.personId, kid.id)).get()?.referenceIds ?? "[]").toBe("[]"); // the child's photos were never stored on the subject
  });

  test("household_likeness off refuses capturing another member with the existing line; capturing yourself still works", async () => {
    const { sage, adult2 } = await world();
    if (!adult2) return;
    setHouseholdSettingValue("generation.household_likeness", false);
    expect(await captureLook(sage, adult2.id, { sheetMaker: maker, photoFileIds: [await photo(sage, 40)] })).toMatchObject({ ok: false, line: LIKENESS_OFF_LINE });
    expect((await captureLook(sage, sage.id, { sheetMaker: maker, photoFileIds: [await photo(sage, 41)] })).ok).toBe(true);
  });

  test("a child captures their own shared fictional subject only if they made it; a shared subject belongs to its maker", async () => {
    const { sage, kid } = await world();
    const shared = createMediaSubject(sage, { name: "Red kite", kind: "prop", look: "A red kite", referenceIds: [await photo(sage, 40)] });
    shareMediaSubject(sage, shared.id, kid.id, true);
    expect(await captureLook(kid, shared.id, { sheetMaker: maker })).toMatchObject({ ok: false, line: expect.stringMatching(/Only the person who saved this/) });
    const own = createMediaSubject(kid, { name: "Kid kite", kind: "prop", look: "A blue kite", referenceIds: [await photo(kid, 50)] });
    expect((await captureLook(kid, own.id, { sheetMaker: maker })).ok).toBe(true);
  });

  test("an adult-only source keeps the sheet adult-only so a child never reads it", async () => {
    const { sage, kid } = await world();
    const stored = storeFile(sage, { conversationId: null, turnId: null, mediaType: "image/png", bytes: await solid(9, 9, 9), provenance: 'picture-gen:{"audience":"adult-only"}', retention: "kept", name: "a.png" });
    if (!stored.ok) throw new Error(stored.error);
    const subject = createMediaSubject(sage, { name: "Noir", kind: "character", look: "A noir fox", referenceIds: [stored.value.id] });
    const made = await captureLook(sage, subject.id, { sheetMaker: maker });
    if (!made.ok) throw new Error(made.line);
    const note = sheetNote(db.select().from(attachments).where(eq(attachments.id, made.sheet_file_id)).get()!.provenance);
    expect(note!.audience).toBe("adult-only");
    shareMediaSubject(sage, subject.id, kid.id, true);
    expect(listCast(kid).some((e) => e.name === "Noir")).toBe(false);
  });
});

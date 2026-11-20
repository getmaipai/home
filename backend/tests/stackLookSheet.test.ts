// PLACE-SHEET-01e: a place's or a prop's look sheet made by the Stack (kind place/object, compose), with Home's gate on the composed sheet. Fake Stack; no engine, no model.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { db } from "@/db";
import { attachments, mediaSubjects } from "@/db/schema";
import { storeFile } from "@/lib/attachments";
import { createMediaSubject } from "@/lib/mediaSubjects";
import { captureLook } from "@/lib/castLook";
import { __setStackLookToolsForTests, makeStackLookSheet, stackLookSheetEnabled, type StackLookTools } from "@/lib/stackLookSheet";
import { resetDb } from "./reset-db";
import { owner } from "./support/testAuth";
import type { PersonRow } from "@/types";

const solid = async (r: number, g: number, b: number) => new Uint8Array(await sharp({ create: { width: 120, height: 80, channels: 3, background: { r, g, b } } }).png().toBuffer());
async function photo(actor: PersonRow, shade: number): Promise<string> {
  const stored = storeFile(actor, { conversationId: null, turnId: null, mediaType: "image/png", bytes: await solid(shade, 90, 30), provenance: "composer:upload", retention: "kept", name: `p${shade}.png` });
  if (!stored.ok) throw new Error(stored.error);
  return stored.value.id;
}

let bodies: Array<Record<string, unknown>> = [];
let gated: string[] = [];
const sheetPng = async () => solid(200, 200, 200);
const fake = (over: Partial<StackLookTools> = {}): Partial<StackLookTools> => ({
  available: async () => true,
  make: async (body) => { bodies.push(body as never); return { ok: true, done: true, composed: "/v1/images/edits/abc", files: ["/v1/images/edits/p1"], notes: [] }; },
  fetch: async () => sheetPng(),
  gate: async ({ jobId }) => { gated.push(jobId); },
  ...over,
});
const savedFlag = process.env.MAIPAI_LOOK_SHEET_VIA_STACK;
beforeEach(() => { resetDb(); bodies = []; gated = []; process.env.MAIPAI_LOOK_SHEET_VIA_STACK = "1"; });
afterEach(() => { __setStackLookToolsForTests(null); if (savedFlag === undefined) delete process.env.MAIPAI_LOOK_SHEET_VIA_STACK; else process.env.MAIPAI_LOOK_SHEET_VIA_STACK = savedFlag; });
const sheetsOf = (subjectId: string) => (JSON.parse(db.select().from(mediaSubjects).where(eq(mediaSubjects.id, subjectId)).get()!.referenceIds) as string[]);

describe("a place's look through the Stack", () => {
  test("a place is sent as kind place with compose, the composed sheet is gated, then stored as the subject's sheet", async () => {
    const { row: sage } = await owner();
    __setStackLookToolsForTests(fake());
    const subject = createMediaSubject(sage, { name: "Harbor", kind: "place", look: "A quiet harbor at dawn", referenceIds: [await photo(sage, 40)] });
    const made = await captureLook(sage, subject.id);
    expect(made.ok).toBe(true);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ job: "character_sheet", kind: "place", compose: true, audience: "minor", level: "standard" }); // not adult-only, so the all-ages list (rule E6)
    expect((bodies[0]!.references as string[])[0]!.startsWith("data:image/png;base64,")).toBe(true);
    expect(gated).toEqual([`look-sheet:${subject.id}`]);
    if (!made.ok) return;
    expect(made.reused).toBe(false);
    const stored = db.select().from(attachments).where(eq(attachments.id, made.sheet_file_id)).get()!;
    expect(stored.mediaType).toBe("image/png");
    expect(sheetsOf(subject.id)).toContain(made.sheet_file_id);
  });

  test("a prop is sent as kind object", async () => {
    const { row: sage } = await owner();
    __setStackLookToolsForTests(fake());
    const subject = createMediaSubject(sage, { name: "Lamp", kind: "prop", look: "A brass lamp", referenceIds: [await photo(sage, 55)] });
    expect((await captureLook(sage, subject.id)).ok).toBe(true);
    expect(bodies[0]).toMatchObject({ kind: "object", compose: true });
  });

  test("the gate withholding the composed sheet ends the capture and stores nothing (fail closed)", async () => {
    const { row: sage } = await owner();
    __setStackLookToolsForTests(fake({ gate: async () => { throw new Error("That picture is not available."); } }));
    const subject = createMediaSubject(sage, { name: "Harbor", kind: "place", look: "A quiet harbor", referenceIds: [await photo(sage, 40)] });
    const before = sheetsOf(subject.id).length;
    const made = await captureLook(sage, subject.id);
    expect(made).toEqual({ ok: false, line: "That picture is not available." });
    expect(sheetsOf(subject.id)).toHaveLength(before);
  });

  test("a gate that errors with no message still withholds with a plain line", async () => {
    const { row: sage } = await owner();
    __setStackLookToolsForTests(fake({ gate: async () => { throw new Error(""); } }));
    const subject = createMediaSubject(sage, { name: "Harbor", kind: "place", look: "A quiet harbor", referenceIds: [await photo(sage, 40)] });
    const made = await captureLook(sage, subject.id);
    expect(made.ok).toBe(false);
    if (!made.ok) expect(made.line.length).toBeGreaterThan(10);
  });

  test("a Stack refusal, a sheet still running and a missing composed file are plain failures that store nothing", async () => {
    const { row: sage } = await owner();
    const subject = createMediaSubject(sage, { name: "Harbor", kind: "place", look: "A quiet harbor", referenceIds: [await photo(sage, 40)] });
    const before = sheetsOf(subject.id).length;
    __setStackLookToolsForTests(fake({ make: async () => ({ ok: false, refusal: { code: "input_not_supported", line: "A place sheet is not available with this picture model." } }) }));
    expect(await captureLook(sage, subject.id)).toEqual({ ok: false, line: "A place sheet is not available with this picture model." });
    __setStackLookToolsForTests(fake({ make: async () => ({ ok: true, done: false, composed: null, files: [], notes: [] }) }));
    expect((await captureLook(sage, subject.id)).ok).toBe(false);
    __setStackLookToolsForTests(fake({ make: async () => ({ ok: true, done: true, composed: null, files: [], notes: [] }) }));
    expect((await captureLook(sage, subject.id)).ok).toBe(false);
    expect(sheetsOf(subject.id)).toHaveLength(before);
  });
});

describe("dark by default: the old builder keeps every case the Stack path does not take", () => {
  const oldMaker = async () => ({ png: await sheetPng(), description: "Reference sheet: old", panels: [], notes: [] });
  test("with the flag off the Stack is never asked", async () => {
    const { row: sage } = await owner();
    delete process.env.MAIPAI_LOOK_SHEET_VIA_STACK;
    __setStackLookToolsForTests(fake());
    expect(stackLookSheetEnabled()).toBe(false);
    const subject = createMediaSubject(sage, { name: "Harbor", kind: "place", look: "A quiet harbor", referenceIds: [await photo(sage, 40)] });
    const real = await captureLook(sage, subject.id, { sheetMaker: oldMaker });
    expect(real.ok).toBe(true);
    expect(bodies).toHaveLength(0);
  });

  test("a Stack that does not offer the composed sheet, and a character, use the old builder", async () => {
    const { row: sage } = await owner();
    __setStackLookToolsForTests(fake({ available: async () => false }));
    const place = createMediaSubject(sage, { name: "Harbor", kind: "place", look: "A quiet harbor", referenceIds: [await photo(sage, 40)] });
    expect((await captureLook(sage, place.id, { sheetMaker: oldMaker })).ok).toBe(true);
    __setStackLookToolsForTests(fake());
    const fox = createMediaSubject(sage, { name: "Moss", kind: "character", look: "A green fox", referenceIds: [await photo(sage, 41)] });
    expect((await captureLook(sage, fox.id, { sheetMaker: oldMaker })).ok).toBe(true);
    expect(bodies).toHaveLength(0);
  });
});

describe("makeStackLookSheet", () => {
  test("sends at most four pictures and the look words, and returns the gated sheet", async () => {
    const { row: sage } = await owner();
    __setStackLookToolsForTests(fake());
    const pictures = await Promise.all([1, 2, 3, 4, 5, 6].map(async (n) => ({ bytes: await solid(n * 10, 20, 30), mediaType: "image/png" })));
    const sheet = await makeStackLookSheet(pictures, { actor: sage, adultOnly: false, kind: "place", look: "A hall", subjectId: "s1" });
    expect((bodies[0]!.references as string[])).toHaveLength(4);
    expect(bodies[0]).toMatchObject({ audience: "minor", description: "A hall" });
    expect(sheet.description).toBe("A hall");
  });
});

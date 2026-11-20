// PLACE-SHEET-01e: capture the look of a place or a prop through the Stack's `character_sheet` job (kind `place` or `object`, `compose: true`), so Elements places and props get a
// multi-angle reference sheet. The Stack makes the views and composes the sheet; Home keeps everything that is Home's: who may capture (castLook), the age check and the finished-picture
// gate on the composed sheet before it is stored or shown (checkImages + gateFinished, fail closed: any error withholds), and every plain line.
//
// Dark by default: it runs only when MAIPAI_LOOK_SHEET_VIA_STACK=1 AND the Stack's catalog says the job is available and lists `compose` among its request fields. Otherwise castLook keeps
// building the sheet with films/sheetMaker as before. No real run has been done (the GPU is parked), so the flag stays off until one is.
import type { MadeSheet } from "@/lib/films/sheetMaker";
import type { PersonRow } from "@/types";
import type { StackMakeSheetRequest } from "@/lib/stack/makeShape";

export const stackLookSheetEnabled = (): boolean => process.env.MAIPAI_LOOK_SHEET_VIA_STACK === "1";
export const LOOK_SHEET_BLOCKED_LINE = "The look sheet could not be made. Try again in a moment.";
/** The most reference pictures sent to the Stack for one sheet. */
export const STACK_SHEET_MAX_REFERENCES = 4;

export interface StackLookTools {
  /** The catalog lists `character_sheet` as available for this list and its request fields include `compose`. */
  available(adultOnly: boolean): Promise<boolean>;
  make(body: StackMakeSheetRequest): ReturnType<typeof import("@/lib/pictures/stack").makeSheetJob>;
  fetch(path: string): Promise<Uint8Array>;
  /** The age check and the finished-picture gate for one composed sheet: the picture's bytes when it may be kept, else a thrown error carrying the plain line. */
  gate(input: { actor: PersonRow; adultOnly: boolean; jobId: string; bytes: Uint8Array; prompt: string }): Promise<void>;
}

const realTools: StackLookTools = {
  async available(adultOnly) {
    const { jobsCatalogFor } = await import("@/lib/pictures/stack");
    const catalog = await jobsCatalogFor(adultOnly ? "adult" : "minor");
    const entry = catalog?.jobs.find((job) => job.job === "character_sheet");
    return !!entry && entry.available !== false && Array.isArray(entry.request_fields) && entry.request_fields.includes("compose");
  },
  async make(body) { return (await import("@/lib/pictures/stack")).makeSheetJob(body); },
  async fetch(path) { return (await import("@/lib/pictures/stack")).fetchStackPicture(path); },
  async gate({ actor, adultOnly, jobId, bytes, prompt }) {
    const [{ checkImages }, { gateFinished }] = await Promise.all([import("@/lib/pictures/ageCheck"), import("@/lib/pictures/laneGate")]);
    const checks = await checkImages([bytes], "picture");
    const decision = await gateFinished({ actor, kind: "picture", jobId, adultOnly, checks, images: [bytes], prompt });
    if (decision.action === "withhold") throw new Error(decision.line);
  },
};
let toolsOverride: Partial<StackLookTools> | null = null;
/** Test seam: replaces any of the Stack tools (the real ones need the Stack and the age models). */
export function __setStackLookToolsForTests(tools: Partial<StackLookTools> | null): void { toolsOverride = tools; }
const tools = (): StackLookTools => ({ ...realTools, ...(toolsOverride ?? {}) });

const toDataUrl = (bytes: Uint8Array, mediaType: string) => `data:${mediaType};base64,${Buffer.from(bytes).toString("base64")}`;

/** Whether this capture goes to the Stack: the flag is on, the subject is a place or a prop, and the Stack offers the composed sheet. Any doubt means the old builder. */
export async function useStackLookSheet(kind: string, adultOnly: boolean): Promise<boolean> {
  if (!stackLookSheetEnabled() || (kind !== "place" && kind !== "prop")) return false;
  try { return await tools().available(adultOnly); } catch { return false; }
}

/** The sheet of one place or prop, made by the Stack from the member's own pictures and gated here. Throws an Error whose message is the plain line when it cannot be made or may not be kept. */
export async function makeStackLookSheet(pictures: ReadonlyArray<{ bytes: Uint8Array; mediaType: string }>, ctx: { actor: PersonRow; adultOnly: boolean; kind: "place" | "prop"; look: string; subjectId: string }): Promise<MadeSheet> {
  const t = tools();
  const references = pictures.slice(0, STACK_SHEET_MAX_REFERENCES).map((picture) => toDataUrl(picture.bytes, picture.mediaType));
  if (!references.length) throw new Error(LOOK_SHEET_BLOCKED_LINE);
  const description = ctx.look.trim().slice(0, 400);
  const body: StackMakeSheetRequest = { job: "character_sheet", audience: ctx.adultOnly ? "adult" : "minor", references, kind: ctx.kind === "place" ? "place" : "object", level: "standard", compose: true, ...(description ? { description } : {}), wait: 120 };
  const made = await t.make(body);
  if (!made.ok) throw new Error(made.refusal.line || LOOK_SHEET_BLOCKED_LINE);
  if (!made.done || !made.composed) throw new Error(LOOK_SHEET_BLOCKED_LINE);
  const png = await t.fetch(made.composed);
  // Fail closed: the sheet is stored only after the age check and the gate both pass; a check that errors withholds it.
  try { await t.gate({ actor: ctx.actor, adultOnly: ctx.adultOnly, jobId: `look-sheet:${ctx.subjectId}`, bytes: png, prompt: description }); }
  catch (error) { throw new Error(error instanceof Error && error.message ? error.message : LOOK_SHEET_BLOCKED_LINE); }
  return { png, description: description || (ctx.kind === "place" ? "a place" : "a prop"), panels: [], notes: made.notes };
}

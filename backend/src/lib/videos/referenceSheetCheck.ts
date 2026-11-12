// REFVIDEO-01: is an attached picture ALREADY a usable reference sheet? A usable sheet is one composite image of several clean, separate panels (people and objects on
// plain backgrounds, a place panel) with no text labels. One call per picture to the same local vision model the picture roles use (the same reader, the same
// `completeViaStackRequest` pattern), asking for a strict JSON answer. A picture is used as the sheet only when the model says so AND names at least two panels; a
// plain photo, a labelled collage and a failed check all mean "not a sheet", and the picture is then built into a sheet like any other (never a refusal).
import sharp from "sharp";
import { completeViaStackRequest, type LlmMessage } from "@/lib/llm";
import { downscaleForCheck, pictureReader, type PictureReader } from "@/lib/pictures/ageCheck";

/** The size the Stack takes a sheet at (the same as films/sheetMaker.ts). */
export const REFERENCE_SHEET_W = 768, REFERENCE_SHEET_H = 448;
export const MIN_SHEET_PANELS = 2;
export const SHEET_KINDS = ["Character", "Prop", "Setting"] as const;
export type SheetPanelKind = (typeof SHEET_KINDS)[number];
export interface SheetCheckPanel { position: string; kind: SheetPanelKind; view: string; look: string }
export interface SheetCheck { isSheet: boolean; panels: SheetCheckPanel[] }

const SCHEMA = {
  name: "reference_sheet_check",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["is_sheet", "panels"],
    properties: {
      is_sheet: { type: "boolean" },
      panels: {
        type: "array",
        maxItems: 8,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["position", "kind", "view", "look"],
          properties: {
            position: { type: "string", maxLength: 30 },
            kind: { type: "string", enum: [...SHEET_KINDS] },
            view: { type: "string", maxLength: 30 },
            look: { type: "string", maxLength: 300 },
          },
        },
      },
    },
  },
} as const;

const SYSTEM = [
  "You look at one picture and decide whether it is already a reference sheet for making a video.",
  "A reference sheet is ONE composite image made of several clean, separate panels in a grid: each panel shows one person or one object on a plain background, or one place, and there are no text labels on it.",
  "A normal photo (even of several people), a single scene, a screenshot, a poster, a collage with captions or labels, or a picture with only one subject is NOT a sheet: answer is_sheet false and an empty panels list.",
  "When it is a sheet, list every panel. position: where the panel sits, such as Top Left, Top Middle, Top Right, Middle Left, Bottom Right or Far Right. kind: Character for a person or animal, Prop for an object, Setting for a place. view: such as Front View, Side View, Back View, Face Close-up or Setting.",
  "look: one plain sentence of positive facts about that panel's subject itself (colours, materials, clothing, shapes), never its background. Never name or identify any real person. Never read out writing, words, logos or numbers: say \"printed lettering\" or \"a logo\" instead.",
  "Reply with one JSON object that has exactly the fields is_sheet and panels.",
].join("\n");

let visionForTests: ((dataUrl: string) => Promise<string>) | null = null;
/** Test seam: answers the check with a raw JSON string instead of the local vision model. */
export function __setSheetVisionForTests(fn: ((dataUrl: string) => Promise<string>) | null): void { visionForTests = fn; }

export function parseSheetCheck(text: string): SheetCheck | null {
  try {
    const start = text.indexOf("{"), end = text.lastIndexOf("}");
    const json = JSON.parse(start >= 0 && end > start ? text.slice(start, end + 1) : text) as Record<string, unknown>;
    if (typeof json.is_sheet !== "boolean" || !Array.isArray(json.panels)) return null;
    const panels: SheetCheckPanel[] = [];
    for (const raw of json.panels.slice(0, 8)) {
      const item = raw as Record<string, unknown>;
      const position = typeof item.position === "string" ? item.position.trim().slice(0, 30) : "";
      const kind = (SHEET_KINDS as readonly string[]).includes(item.kind as string) ? (item.kind as SheetPanelKind) : null;
      const view = typeof item.view === "string" ? item.view.trim().slice(0, 30) : "";
      const look = typeof item.look === "string" ? item.look.trim().slice(0, 300) : "";
      if (position && kind && view && look) panels.push({ position, kind, view, look });
    }
    return { isSheet: json.is_sheet, panels };
  } catch { return null; }
}

async function ask(dataUrl: string, reader: PictureReader, signal: AbortSignal): Promise<string> {
  if (visionForTests) return visionForTests(dataUrl);
  const messages: LlmMessage[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: "Is this picture already a reference sheet?", images: [{ id: "sheet", name: "image", url: dataUrl, reservedTokens: 2560 }] },
  ];
  const result = await completeViaStackRequest(reader, { model: reader, messages, stream: false, temperature: 0, max_tokens: 700, response_format: { type: "json_schema", json_schema: SCHEMA }, chat_template_kwargs: { enable_thinking: false } }, signal);
  if (!result.ok) throw new Error(result.failure.error);
  const content = (result.data as { choices?: Array<{ message?: { content?: string | null } }> }).choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("no answer");
  return content;
}

/** Whether the picture is a ready sheet. A sheet needs `is_sheet` true and at least two panels; any failure of the check answers "not a sheet" (never throws). */
export async function checkPictureIsSheet(bytes: Uint8Array): Promise<SheetCheck> {
  const no: SheetCheck = { isSheet: false, panels: [] };
  try {
    const reader: PictureReader | null = visionForTests ? "chat" : await pictureReader();
    if (!reader) return no;
    const jpeg = await downscaleForCheck(bytes);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const parsed = parseSheetCheck(await ask(`data:image/jpeg;base64,${Buffer.from(jpeg).toString("base64")}`, reader, controller.signal));
      return parsed && parsed.isSheet && parsed.panels.length >= MIN_SHEET_PANELS ? parsed : no;
    } finally { clearTimeout(timer); }
  } catch { return no; }
}

/** Fits a picture to the 768x448 sheet size without cropping any panel away: scaled to fit, padded with the picture's own corner colour (white when it cannot be read). */
export async function fitToSheetSize(bytes: Uint8Array): Promise<Uint8Array> {
  const source = Buffer.from(bytes);
  let background = { r: 255, g: 255, b: 255 };
  try {
    const corner = await sharp(source).flatten({ background: "white" }).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
    if (corner.length >= 3) background = { r: corner[0]!, g: corner[1]!, b: corner[2]! };
  } catch { /* white */ }
  const png = await sharp(source).flatten({ background: "white" }).resize(REFERENCE_SHEET_W, REFERENCE_SHEET_H, { fit: "contain", background }).png().toBuffer();
  return new Uint8Array(png);
}

/** The "Reference sheet: ..." text for a sheet that was provided, in the same "Top Left (Character, Side View): look" format the sheet maker writes. */
export function describeProvidedSheet(panels: readonly SheetCheckPanel[]): string {
  return `Reference sheet: ${panels.map((panel) => `${panel.position} (${panel.kind}, ${panel.view}): ${panel.look}`).join(" ")}`;
}

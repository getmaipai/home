// IMGEDIT-01: "remove that person" without drawing anyone. Apple's on-device person finder (through the Stack's image tools)
// numbers the people in a picture; a reader picks the one the person means; LaMa fills the place from the surrounding
// pixels. Nothing here generates a person or a face, so it is allowed on any picture the person may open in the editor
// (the same rule as the editor's Erase). The reader is the household's own picture-reading chat model: it sees the picture
// with numbered boxes and answers with numbers, never a name (rule 6a: nothing here logs a picture or a description).
import sharp from "sharp";
import { chatModelReadsPictures } from "@/lib/chatPictures";
import { complete } from "@/lib/llm";
import { getStackClient } from "@/lib/stackEngine";
import { StackError } from "@/lib/stack/errors";
import type { StackImageEditItem } from "@/lib/stack/client";

export type PersonBox = NonNullable<StackImageEditItem["people"]>[number];

export class PeopleError extends Error {
  constructor(readonly code: "unavailable" | "none" | "unsure" | "busy" | "failed", message: string) { super(message); }
}

export const NO_PEOPLE_LINE = "I couldn't find anyone in that picture to remove.";
export const PEOPLE_UNAVAILABLE_LINE = "Removing a person needs the picture tools on this computer, and they aren't ready. Tap the picture, then Edit, and paint over the person with Erase, or ask again in a few minutes.";
export const PEOPLE_UNSURE_LINE = "I can see more than one person and I couldn't tell which one you mean. Tap the picture, then Edit, and paint over the person with Erase, or say which one by where they stand or what they wear.";
export const PEOPLE_BUSY_LINE = "The picture tools are busy with another request. Try again in a moment.";

export const RETRY_PAUSE_MS = 4000;
let retryPauseMs = RETRY_PAUSE_MS;
/** Test seam: sets the delay between a retriable picture-tools failure and its one retry. */
export function __setPeopleRetryPauseForTests(ms: number): void { retryPauseMs = Math.max(0, ms); }

function fail(error: unknown): PeopleError {
  if (error instanceof PeopleError) return error;
  if (error instanceof StackError) {
    let code = "";
    try { code = String((JSON.parse(error.body ?? "{}") as { code?: unknown }).code ?? ""); } catch { /* a body that is not JSON carries no code */ }
    if (code === "no_people" || /No people were found/i.test(`${error.message} ${error.body ?? ""}`)) return new PeopleError("none", NO_PEOPLE_LINE);
    if (error.status === 404 || code === "people_unavailable" || code === "unsupported" || code === "model_missing") return new PeopleError("unavailable", PEOPLE_UNAVAILABLE_LINE);
    if ([408, 409, 423, 429, 502, 503, 504].includes(error.status ?? 0)) return new PeopleError("busy", PEOPLE_BUSY_LINE);
  }
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError" || /\btimeout\b|timed out/i.test(error.message))) return new PeopleError("busy", PEOPLE_BUSY_LINE);
  if (error instanceof TypeError || (error instanceof Error && /ECONNRESET|ECONNREFUSED|EPIPE|socket hang up/i.test(error.message))) return new PeopleError("busy", PEOPLE_BUSY_LINE);
  return new PeopleError("failed", "I couldn't remove them. Try again, or tap the picture, then Edit, and paint over the person with Erase.");
}

async function retryBusyOnce<T>(signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try { return await operation(); }
    catch (error) {
      const mapped = fail(error);
      if (attempt > 0 || signal?.aborted || mapped.code !== "busy") throw mapped;
      await new Promise((resolve) => setTimeout(resolve, retryPauseMs));
      if (signal?.aborted) throw mapped;
    }
  }
}

function form(operation: "find_people" | "people_mask" | "erase_people" | "remove_background" | "upscale", bytes: Uint8Array, mediaType: string, extra: Record<string, string> = {}): FormData {
  const body = new FormData();
  body.append("image", new File([new Uint8Array(bytes)], "picture", { type: mediaType }));
  body.append("operation", operation);
  for (const [key, value] of Object.entries(extra)) body.append(key, value);
  // These finish in seconds; wait for the picture itself so the answer carries the people list.
  body.append("timeout_ms", "150000");
  return body;
}

export interface FoundPeople { people: PersonBox[]; overlay: Uint8Array }

export async function findPeople(bytes: Uint8Array, mediaType: string, signal?: AbortSignal): Promise<FoundPeople> {
  return retryBusyOnce(signal, async () => {
    const reply = await getStackClient().imageEdit(form("find_people", bytes, mediaType), { signal });
    if (reply.kind !== "done") throw new PeopleError("busy", PEOPLE_BUSY_LINE);
    if (!reply.item.people || reply.item.people.length === 0) throw new PeopleError("none", NO_PEOPLE_LINE);
    return { people: reply.item.people, overlay: new Uint8Array(Buffer.from(reply.item.b64_json, "base64")) };
  });
}

/** The Stack's other non-generative tools by name (remove_background, upscale): the same call, no list of people. */
export async function runPictureTool(operation: "remove_background" | "upscale", bytes: Uint8Array, mediaType: string, extra: Record<string, string>, signal?: AbortSignal): Promise<ErasedPeople> {
  return retryBusyOnce(signal, async () => {
    const reply = await getStackClient().imageEdit(form(operation, bytes, mediaType, extra), { signal });
    if (reply.kind !== "done") throw new PeopleError("busy", PEOPLE_BUSY_LINE);
    return { png: new Uint8Array(Buffer.from(reply.item.b64_json, "base64")), width: reply.item.width, height: reply.item.height, engine: reply.item.engine ?? operation, model: reply.item.model ?? operation, ms: reply.item.ms ?? 0 };
  }).catch((error) => {
    const mapped = fail(error);
    if (mapped.code === "failed" || mapped.code === "unavailable") throw new PeopleError(mapped.code, "The picture tools on this computer aren't ready. Tap the picture, then Edit, or try again in a few minutes.");
    throw mapped;
  });
}

/** The chosen people as a mask picture (white), for the picture engine's masked edit to fill. */
export async function peopleMaskWithCount(bytes: Uint8Array, mediaType: string, ids: number[] | "all", signal?: AbortSignal): Promise<{ png: Uint8Array; people: number }> {
  return retryBusyOnce(signal, async () => {
    const reply = await getStackClient().imageEdit(form("people_mask", bytes, mediaType, { people: ids === "all" ? "all" : ids.join(",") }), { signal });
    if (reply.kind !== "done") throw new PeopleError("busy", PEOPLE_BUSY_LINE);
    return { png: new Uint8Array(Buffer.from(reply.item.b64_json, "base64")), people: reply.item.people?.length ?? 0 };
  });
}

export async function peopleMask(bytes: Uint8Array, mediaType: string, ids: number[] | "all", signal?: AbortSignal): Promise<Uint8Array> {
  return (await peopleMaskWithCount(bytes, mediaType, ids, signal)).png;
}

export interface ErasedPeople { png: Uint8Array; width: number; height: number; engine: string; model: string; ms: number }

export async function erasePeople(bytes: Uint8Array, mediaType: string, ids: number[] | "all", signal?: AbortSignal): Promise<ErasedPeople> {
  return retryBusyOnce(signal, async () => {
    const reply = await getStackClient().imageEdit(form("erase_people", bytes, mediaType, { people: ids === "all" ? "all" : ids.join(",") }), { signal });
    if (reply.kind !== "done") throw new PeopleError("busy", PEOPLE_BUSY_LINE);
    return { png: new Uint8Array(Buffer.from(reply.item.b64_json, "base64")), width: reply.item.width, height: reply.item.height, engine: reply.item.engine ?? "apple-vision+lama", model: reply.item.model ?? "big-lama-onnx", ms: reply.item.ms ?? 0 };
  });
}

// ---------------------------------------------------------------- choosing which person

let pickerOverride: ((overlay: Uint8Array, people: PersonBox[], who: string) => Promise<number[] | null>) | null | undefined;
let completion = complete;
/** Test seam: replaces the reader (null makes every pick fail closed; undefined restores). */
export function __setPersonPickerForTests(fn: typeof pickerOverride): void { pickerOverride = fn; }
export function __resolvePeopleAnswerForTests(text: string, who: string, ids: number[]): { numbers: number[] } | { reason: "empty" | "unparseable" | "not_sure" | "ids_unknown" } {
  return resolveModelAnswer(text, who, ids);
}

const EVERYONE = /^\s*(everyone|everybody|all of them|all( the)? (people|persons)|the people|them all|everyone else)\s*[.!]?\s*$/i;

/** Which numbered people the words mean: `all` when they mean everyone, the lone person when there is one, else the reader's answer, else null (never a guess). */
export async function choosePeople(people: PersonBox[], overlay: Uint8Array, who: string): Promise<number[] | "all" | null> {
  if (EVERYONE.test(who)) return "all";
  if (people.length === 1) return [people[0]!.id];
  const spatial = resolvePosition(people, who);
  if (spatial !== undefined) return spatial;
  const picked = pickerOverride !== undefined ? (pickerOverride ? await pickerOverride(overlay, people, who) : null) : await modelPicker(overlay, people, who);
  if (!picked || picked.length === 0) return null;
  const known = new Set(people.map((p) => p.id));
  return picked.every((id) => known.has(id)) ? [...new Set(picked)] : null;
}

type Axis = "x" | "y" | "area";
type PositionOrder = "asc" | "desc" | "center";
function resolvePosition(people: PersonBox[], who: string): number[] | undefined {
  const text = who.toLowerCase();
  const ordinals: Array<{ pattern: RegExp; axis: Axis; order: PositionOrder; ordinal: number }> = [
    { pattern: /\b(?:second|2nd)\s+from\s+the\s+left\b/, axis: "x", order: "asc", ordinal: 1 },
    { pattern: /\b(?:second|2nd)\s+from\s+the\s+right\b/, axis: "x", order: "desc", ordinal: 1 },
    { pattern: /\b(?:third|3rd)\s+from\s+the\s+left\b/, axis: "x", order: "asc", ordinal: 2 },
    { pattern: /\b(?:third|3rd)\s+from\s+the\s+right\b/, axis: "x", order: "desc", ordinal: 2 },
  ];
  const ordinalMatches = ordinals.filter((d) => d.pattern.test(text));
  const directionText = text.replace(/\b(?:second|2nd|third|3rd)\s+from\s+the\s+(?:left|right)\b/g, " ");
  const directions: Array<{ pattern: RegExp; axis: Axis; order: PositionOrder; ordinal?: number }> = [
    { pattern: /\b(?:leftmost|far\s+left|far\s+left-hand|on\s+the\s+left|to\s+the\s+left|at\s+the\s+left|left)\b/, axis: "x", order: "asc" },
    { pattern: /\b(?:rightmost|far\s+right|far\s+right-hand|on\s+the\s+right|to\s+the\s+right|at\s+the\s+right|right)\b/, axis: "x", order: "desc" },
    { pattern: /\b(?:middle|center|centre|in\s+the\s+middle|in\s+the\s+center)\b/, axis: "x", order: "center" },
    { pattern: /\b(?:top|uppermost|at\s+the\s+top)\b/, axis: "y", order: "asc" },
    { pattern: /\b(?:bottom|lowest|at\s+the\s+bottom)\b/, axis: "y", order: "desc" },
    { pattern: /\bfront\b/, axis: "area", order: "desc" },
    { pattern: /\bback\b/, axis: "area", order: "asc" },
  ];
  const matched = [...ordinalMatches, ...directions.filter((d) => d.pattern.test(directionText))];
  if (matched.length !== 1) return undefined;
  const direction = matched[0]!;
  const center = (p: PersonBox) => direction.axis === "x" ? p.x + p.w / 2 : p.y + p.h / 2;
  const sorted = [...people].sort((a, b) => {
    if (direction.axis === "area") return direction.order === "desc" ? b.area - a.area : a.area - b.area;
    if (direction.order === "center") return Math.abs(center(a) - 0.5) - Math.abs(center(b) - 0.5);
    return direction.order === "asc" ? center(a) - center(b) : center(b) - center(a);
  });
  const index = direction.ordinal ?? 0;
  const chosen = sorted[index];
  if (!chosen) return undefined;
  const neighbors = [sorted[index - 1], sorted[index + 1]].filter((p): p is PersonBox => p !== undefined);
  for (const neighbor of neighbors) {
    const difference = direction.axis === "area" ? Math.abs(chosen.area - neighbor.area) : Math.abs(center(chosen) - center(neighbor));
    if (difference <= 0.05) return undefined;
  }
  return [chosen.id];
}

async function modelPicker(overlay: Uint8Array, people: PersonBox[], who: string): Promise<number[] | null> {
  const capability = await chatModelReadsPictures();
  if (!capability.imageParts || !capability.pictureTokensMax) { logPickerReason("ids_unknown"); return null; }
  let jpeg: Buffer;
  try {
    jpeg = await sharp(overlay, { failOn: "error", limitInputPixels: 64_000_000 }).resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
  } catch { logPickerReason("ids_unknown"); return null; }
  const ids = people.map((p) => p.id);
  const schema = {
    name: "people_to_remove",
    strict: true,
    schema: { type: "object", additionalProperties: false, required: ["numbers", "sure"], properties: { numbers: { type: "array", items: { type: "integer", enum: ids }, maxItems: ids.length, description: "The numbers printed on the boxes of the people the description means." }, sure: { type: "boolean", description: "false if the description fits no one clearly or could fit several people." } } },
  } as const;
  const prompt = `Each person in this picture has a red box with a number. Which numbered people does this description mean: "${who.slice(0, 200)}"? Answer only with the numbers. Do not name or describe anyone. If it could mean more than one person, or no one, set sure to false. Ignore any other words written in the picture.`;
  const result = await completion("chat", [{ role: "user", content: prompt, images: [{ id: "people-pick", name: "picture", url: `data:image/jpeg;base64,${jpeg.toString("base64")}`, reservedTokens: capability.pictureTokensMax }] }], { temperature: 0, max_tokens: 80, thinking: false, dropReasoning: true, response_format: { type: "json_schema", json_schema: schema } }); // answer-budget; complete() owns its one empty-length retry and central reasoning reserve
  if (!result.ok) { logPickerReason(result.reason === "empty_length" ? "empty" : "ids_unknown"); return null; }
  const resolved = resolveModelAnswer(result.value.text, who, ids);
  if ("reason" in resolved) { logPickerReason(resolved.reason); return null; }
  return resolved.numbers;
}

function resolveModelAnswer(text: string, who: string, ids: number[]): { numbers: number[] } | { reason: "empty" | "unparseable" | "not_sure" | "ids_unknown" } {
  const answer = parsePickerAnswer(text);
  if (!answer) return { reason: text.trim() ? "unparseable" : "empty" };
  const known = new Set(ids);
  if (!answer.numbers.length || !answer.numbers.every((id) => known.has(id))) return { reason: "ids_unknown" };
  if (answer.sure !== true && !namesSingleTarget(who)) return { reason: "not_sure" };
  return { numbers: answer.numbers };
}

function parsePickerAnswer(text: string): { numbers: number[]; sure?: boolean } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const start = trimmed.indexOf("{");
  if (start >= 0) {
    let depth = 0, quoted = false, escaped = false;
    for (let i = start; i < trimmed.length; i++) {
      const ch = trimmed[i]!;
      if (quoted) { if (escaped) escaped = false; else if (ch === "\\") escaped = true; else if (ch === '"') quoted = false; }
      else if (ch === '"') quoted = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        try {
          const parsed = JSON.parse(trimmed.slice(start, i + 1)) as { numbers?: unknown; sure?: unknown };
          if (Array.isArray(parsed.numbers) && parsed.numbers.every((n) => Number.isInteger(n)) && (parsed.sure === undefined || typeof parsed.sure === "boolean")) return { numbers: parsed.numbers as number[], sure: parsed.sure as boolean | undefined };
        } catch { return null; }
        return null;
      }
    }
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed) && parsed.every((n) => Number.isInteger(n))) return { numbers: parsed as number[] };
  } catch { /* a bare list may have surrounding prose */ }
  const list = trimmed.match(/\[\s*\d+(?:\s*,\s*\d+)*\s*\]/);
  if (!list) return null;
  try { return { numbers: JSON.parse(list[0]) as number[] }; } catch { return null; }
}

function namesSingleTarget(who: string): boolean {
  return !/\b(?:all|everyone|everybody|both|several|each|people|persons|boys|girls|men|women|children|kids|and|or)\b/i.test(who) && /\b(?:the|boy|girl|man|woman|child|kid|person|one|left|right|middle|center|centre|top|bottom|front|back)\b/i.test(who);
}

function logPickerReason(reason: "empty" | "unparseable" | "not_sure" | "ids_unknown"): void {
  console.info(JSON.stringify({ event: "picture.people_picker", reason }));
}

// ---------------------------------------------------------------- freezing the people (IMGEDIT-05)

export class FreezeError extends Error {}

/**
 * Puts every pixel inside the people's outline back from the original (a soft edge only on the outside), so an edit of the sky,
 * a colour, the background or an object cannot change a person. `original` and `edited` are decoded at the original's size; the
 * mask is white where a person is. Returns the composited PNG after proving that no pixel inside the outline differs from the
 * original; the proof failing is an error, never a picture.
 */
export async function freezePeople(original: Uint8Array, edited: Uint8Array, maskPng: Uint8Array): Promise<Uint8Array> {
  const base = sharp(original, { failOn: "error", limitInputPixels: 64_000_000 }).rotate();
  const { data: before, info } = await base.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const after = await sharp(edited, { failOn: "error", limitInputPixels: 64_000_000 }).resize(width, height, { fit: "fill" }).removeAlpha().raw().toBuffer();
  // One grey channel whatever the mask PNG carries (an alpha channel would make it two).
  const hard = await sharp(maskPng, { failOn: "error" }).removeAlpha().greyscale().resize(width, height, { fit: "fill", kernel: "nearest" }).raw().toBuffer();
  if (hard.length !== width * height) throw new FreezeError("The person outline could not be read.");
  const soft = await sharp(hard, { raw: { width, height, channels: 1 } }).blur(2).raw().toBuffer();
  const out = Buffer.alloc(before.length);
  let inside = 0;
  for (let i = 0; i < width * height; i += 1) {
    const frozen = hard[i]! > 127;
    const alpha = frozen ? 1 : soft[i]! / 255;
    for (let c = 0; c < 3; c += 1) {
      const k = i * 3 + c;
      out[k] = frozen ? before[k]! : alpha === 0 ? after[k]! : Math.round(before[k]! * alpha + after[k]! * (1 - alpha));
    }
    if (frozen) inside += 1;
  }
  if (inside === 0) throw new FreezeError("No person outline to keep.");
  // The proof: every pixel inside the outline equals the original.
  for (let i = 0; i < width * height; i += 1) {
    if (hard[i]! > 127 && (out[i * 3] !== before[i * 3] || out[i * 3 + 1] !== before[i * 3 + 1] || out[i * 3 + 2] !== before[i * 3 + 2])) throw new FreezeError("A person's pixels changed.");
  }
  return new Uint8Array(await sharp(out, { raw: { width, height, channels: 3 } }).png().toBuffer());
}

/** The share of a mask that is white (0 to 1), one grey channel. */
export async function maskCoverage(maskPng: Uint8Array): Promise<number> {
  const { data } = await sharp(maskPng, { failOn: "error" }).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
  let white = 0;
  for (const value of data) if (value > 127) white += 1;
  return data.length === 0 ? 0 : white / data.length;
}

/** The background: white where the picture may change, black over every person (the inverse of the people mask). */
export async function inverseMask(maskPng: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await sharp(maskPng, { failOn: "error" }).removeAlpha().greyscale().negate().png().toBuffer());
}

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
  constructor(readonly code: "unavailable" | "none" | "unsure" | "failed", message: string) { super(message); }
}

export const NO_PEOPLE_LINE = "I couldn't find anyone in that picture to remove.";
export const PEOPLE_UNAVAILABLE_LINE = "Removing a person needs the picture tools on this computer, and they aren't ready. Open the picture with Edit and paint over the person with Erase, or ask again in a few minutes.";
export const PEOPLE_UNSURE_LINE = "I can see more than one person and I couldn't tell which one you mean. Open the picture with Edit, paint over the person with Erase, or say which one by where they stand or what they wear.";

function fail(error: unknown): PeopleError {
  if (error instanceof PeopleError) return error;
  if (error instanceof StackError) {
    let code = "";
    try { code = String((JSON.parse(error.body ?? "{}") as { code?: unknown }).code ?? ""); } catch { /* a body that is not JSON carries no code */ }
    if (code === "no_people" || /No people were found/i.test(`${error.message} ${error.body ?? ""}`)) return new PeopleError("none", NO_PEOPLE_LINE);
    if (error.status === 404 || code === "people_unavailable" || code === "unsupported" || code === "model_missing") return new PeopleError("unavailable", PEOPLE_UNAVAILABLE_LINE);
  }
  return new PeopleError("failed", "I couldn't remove them. Try again, or open the picture with Edit and paint over the person with Erase.");
}

function form(operation: "find_people" | "people_mask" | "erase_people" | "remove_background" | "upscale", bytes: Uint8Array, mediaType: string, extra: Record<string, string> = {}): FormData {
  const body = new FormData();
  body.append("image", new File([new Uint8Array(bytes)], "picture", { type: mediaType }));
  body.append("operation", operation);
  for (const [key, value] of Object.entries(extra)) body.append(key, value);
  // These finish in seconds; wait for the picture itself so the answer carries the people list.
  body.append("timeout_ms", "90000");
  return body;
}

export interface FoundPeople { people: PersonBox[]; overlay: Uint8Array }

export async function findPeople(bytes: Uint8Array, mediaType: string, signal?: AbortSignal): Promise<FoundPeople> {
  try {
    const reply = await getStackClient().imageEdit(form("find_people", bytes, mediaType), { signal });
    if (reply.kind !== "done" || !reply.item.people || reply.item.people.length === 0) throw new PeopleError(reply.kind === "done" ? "none" : "failed", reply.kind === "done" ? NO_PEOPLE_LINE : "I couldn't finish looking for people in time. Try again.");
    return { people: reply.item.people, overlay: new Uint8Array(Buffer.from(reply.item.b64_json, "base64")) };
  } catch (error) { throw fail(error); }
}

/** The Stack's other non-generative tools by name (remove_background, upscale): the same call, no list of people. */
export async function runPictureTool(operation: "remove_background" | "upscale", bytes: Uint8Array, mediaType: string, extra: Record<string, string>, signal?: AbortSignal): Promise<ErasedPeople> {
  try {
    const reply = await getStackClient().imageEdit(form(operation, bytes, mediaType, extra), { signal });
    if (reply.kind !== "done") throw new PeopleError("failed", "I couldn't finish in time. Try again.");
    return { png: new Uint8Array(Buffer.from(reply.item.b64_json, "base64")), width: reply.item.width, height: reply.item.height, engine: reply.item.engine ?? operation, model: reply.item.model ?? operation, ms: reply.item.ms ?? 0 };
  } catch (error) {
    const mapped = fail(error);
    if (mapped.code === "failed" || mapped.code === "unavailable") throw new PeopleError(mapped.code, "The picture tools on this computer aren't ready. Open the picture with Edit, or try again in a few minutes.");
    throw mapped;
  }
}

/** The chosen people as a mask picture (white), for the picture engine's masked edit to fill. */
export async function peopleMaskWithCount(bytes: Uint8Array, mediaType: string, ids: number[] | "all", signal?: AbortSignal): Promise<{ png: Uint8Array; people: number }> {
  try {
    const reply = await getStackClient().imageEdit(form("people_mask", bytes, mediaType, { people: ids === "all" ? "all" : ids.join(",") }), { signal });
    if (reply.kind !== "done") throw new PeopleError("failed", "I couldn't finish in time. Try again.");
    return { png: new Uint8Array(Buffer.from(reply.item.b64_json, "base64")), people: reply.item.people?.length ?? 0 };
  } catch (error) { throw fail(error); }
}

export async function peopleMask(bytes: Uint8Array, mediaType: string, ids: number[] | "all", signal?: AbortSignal): Promise<Uint8Array> {
  return (await peopleMaskWithCount(bytes, mediaType, ids, signal)).png;
}

export interface ErasedPeople { png: Uint8Array; width: number; height: number; engine: string; model: string; ms: number }

export async function erasePeople(bytes: Uint8Array, mediaType: string, ids: number[] | "all", signal?: AbortSignal): Promise<ErasedPeople> {
  try {
    const reply = await getStackClient().imageEdit(form("erase_people", bytes, mediaType, { people: ids === "all" ? "all" : ids.join(",") }), { signal });
    if (reply.kind !== "done") throw new PeopleError("failed", "I couldn't finish removing them in time. Try again.");
    return { png: new Uint8Array(Buffer.from(reply.item.b64_json, "base64")), width: reply.item.width, height: reply.item.height, engine: reply.item.engine ?? "apple-vision+lama", model: reply.item.model ?? "big-lama-onnx", ms: reply.item.ms ?? 0 };
  } catch (error) { throw fail(error); }
}

// ---------------------------------------------------------------- choosing which person

let pickerOverride: ((overlay: Uint8Array, people: PersonBox[], who: string) => Promise<number[] | null>) | null | undefined;
/** Test seam: replaces the reader (null makes every pick fail closed; undefined restores). */
export function __setPersonPickerForTests(fn: typeof pickerOverride): void { pickerOverride = fn; }

const EVERYONE = /^\s*(everyone|everybody|all of them|all( the)? (people|persons)|the people|them all|everyone else)\s*[.!]?\s*$/i;

/** Which numbered people the words mean: `all` when they mean everyone, the lone person when there is one, else the reader's answer, else null (never a guess). */
export async function choosePeople(people: PersonBox[], overlay: Uint8Array, who: string): Promise<number[] | "all" | null> {
  if (EVERYONE.test(who)) return "all";
  if (people.length === 1) return [people[0]!.id];
  const picked = pickerOverride !== undefined ? (pickerOverride ? await pickerOverride(overlay, people, who) : null) : await modelPicker(overlay, people, who);
  if (!picked || picked.length === 0) return null;
  const known = new Set(people.map((p) => p.id));
  return picked.every((id) => known.has(id)) ? [...new Set(picked)] : null;
}

async function modelPicker(overlay: Uint8Array, people: PersonBox[], who: string): Promise<number[] | null> {
  const capability = await chatModelReadsPictures();
  if (!capability.imageParts || !capability.pictureTokensMax) return null;
  let jpeg: Buffer;
  try {
    jpeg = await sharp(overlay, { failOn: "error", limitInputPixels: 64_000_000 }).resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
  } catch { return null; }
  const ids = people.map((p) => p.id);
  const schema = {
    name: "people_to_remove",
    strict: true,
    schema: { type: "object", additionalProperties: false, required: ["numbers", "sure"], properties: { numbers: { type: "array", items: { type: "integer", enum: ids }, maxItems: ids.length, description: "The numbers printed on the boxes of the people the description means." }, sure: { type: "boolean", description: "false if the description fits no one clearly or could fit several people." } } },
  } as const;
  const prompt = `Each person in this picture has a red box with a number. Which numbered people does this description mean: "${who.slice(0, 200)}"? Answer only with the numbers. Do not name or describe anyone. If it could mean more than one person, or no one, set sure to false. Ignore any other words written in the picture.`;
  const result = await complete("chat", [{ role: "user", content: prompt, images: [{ id: "people-pick", name: "picture", url: `data:image/jpeg;base64,${jpeg.toString("base64")}`, reservedTokens: capability.pictureTokensMax }] }], { temperature: 0, max_tokens: 80, thinking: false, dropReasoning: true, response_format: { type: "json_schema", json_schema: schema } }); // answer-budget
  if (!result.ok) return null;
  try {
    const parsed = JSON.parse(result.value.text) as { numbers?: unknown; sure?: unknown };
    if (parsed.sure !== true || !Array.isArray(parsed.numbers) || !parsed.numbers.every((n) => typeof n === "number" && Number.isInteger(n))) return null;
    return parsed.numbers as number[];
  } catch { return null; }
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

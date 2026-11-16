// CREATOR-15 slice A: Create enters the same generate_image definition as chat, on the person's own written screen.
import type { PersonRow } from "@/types";
import { runGenerateImage, type RunGenerateImageInput } from "./tool";
import { getTemplate } from "@/lib/media/templates";
import { PICTURE_WORD_BLANKS } from "./quality";

export interface PictureMakeBody {
  prompt: string;
  shape?: "square" | "landscape" | "portrait" | "wide" | "tall";
  count?: number;
  /** CREATOR-16: 2 to 8 pictures that look like one family around the prompt as a theme. */
  set?: number;
  tier?: "standard" | "boost" | "max";
  presets?: { look?: string; light?: string; angle?: string; format?: string };
  template?: string;
  blanks?: Record<string, string>;
  cast?: string[];
  references?: string[];
  words?: string[];
}
export type PictureMakeResult = { ok: true; ids: string[]; notice: string | null } | { ok: false; status: 403 | 404 | 422 | 502 | 503; error: string; code: string };

const notGiven = (value: unknown) => typeof value === "string" && (/^\{[a-z_]+\}$/.test(value.trim()) || value.trim().toLowerCase() === "none");
/** Quoted phrases are the exact words Create should place in the picture. Quotes remain part of the prompt sent to the model. */
export function wordsFromPrompt(prompt: string): string[] {
  return [...prompt.matchAll(/"([^"]*)"|“([^”]*)”/g)].map((match) => (match[1] ?? match[2] ?? "").trim()).filter((word) => word.length >= 1 && word.length <= 80).slice(0, 6);
}
export function readPictureMakeBody(raw: Record<string, unknown>): { ok: true; body: PictureMakeBody } | { ok: false; error: string } {
  raw = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, notGiven(value) ? "" : value]));
  const prompt = typeof raw.prompt === "string" ? raw.prompt.trim() : "";
  // A template builds its own prompt, so an empty one is fine beside a template id.
  const hasTemplate = typeof raw.template === "string" && raw.template.trim() !== "";
  if ((prompt.length < 3 && !(hasTemplate && prompt.length === 0)) || prompt.length > 1200) return { ok: false, error: "Describe the picture in 3 to 1200 characters, then try again." };
  const body: PictureMakeBody = { prompt };
  if (raw.words === undefined) {
    const quoted = wordsFromPrompt(prompt);
    if (quoted.length) body.words = quoted;
  }
  const shape = typeof raw.shape === "string" && !notGiven(raw.shape) ? raw.shape.trim().toLowerCase() : "";
  if (shape) {
    if (!["square", "landscape", "portrait", "wide", "tall"].includes(shape)) return { ok: false, error: "Choose square, landscape, portrait, wide or tall for the shape, or leave it empty." };
    body.shape = shape as PictureMakeBody["shape"];
  }
  const countValue = raw.count === undefined || raw.count === "" ? undefined : typeof raw.count === "number" ? raw.count : typeof raw.count === "string" ? Number(raw.count) : NaN;
  if (countValue !== undefined) {
    if (!Number.isInteger(countValue) || countValue < 1 || countValue > 8) return { ok: false, error: "Choose from 1 to 8 pictures, or leave it empty." };
    body.count = countValue;
  }
  // The Create chip sends 0 for "single pictures"; only 2 to 8 starts a set.
  const setValue = raw.set === undefined || raw.set === "" || raw.set === 0 || raw.set === "0" ? undefined : typeof raw.set === "number" ? raw.set : typeof raw.set === "string" ? Number(raw.set) : NaN;
  if (setValue !== undefined) {
    if (!Number.isInteger(setValue) || setValue < 2 || setValue > 8) return { ok: false, error: "Choose a set of 2 to 8 pictures, or leave it empty." };
    body.set = setValue;
  }
  const tier = typeof raw.tier === "string" && !notGiven(raw.tier) ? raw.tier.trim().toLowerCase() : "";
  if (tier) {
    if (!["standard", "boost", "max"].includes(tier)) return { ok: false, error: "Choose Standard, Boost or Max for the level, or leave it empty." };
    body.tier = tier as PictureMakeBody["tier"];
  }
  if (raw.words !== undefined && raw.words !== "") {
    if (!Array.isArray(raw.words) || raw.words.some((word) => typeof word !== "string")) return { ok: false, error: "Words must be a list of up to 6 phrases, each 1 to 80 characters." };
    const words = raw.words.map((word) => word.trim()).filter(Boolean);
    if (words.length > 6 || words.some((word) => word.length > 80)) return { ok: false, error: "Words must be a list of up to 6 phrases, each 1 to 80 characters." };
    if (words.length) body.words = words;
  }
  if (raw.presets !== undefined && raw.presets !== "") {
    if (!raw.presets || typeof raw.presets !== "object" || Array.isArray(raw.presets)) return { ok: false, error: "Choose picture presets from the list, or leave them empty." };
    const presets: NonNullable<PictureMakeBody["presets"]> = {};
    for (const key of ["look", "light", "angle", "format"] as const) {
      const value = (raw.presets as Record<string, unknown>)[key];
      if (value !== undefined && value !== "" && typeof value !== "string") return { ok: false, error: "Choose picture presets from the list, or leave them empty." };
      if (typeof value === "string" && value.trim() && !notGiven(value)) presets[key] = value.trim();
    }
    body.presets = presets;
  }
  for (const key of ["template"] as const) {
    const value = typeof raw[key] === "string" && !notGiven(raw[key]) ? raw[key].trim() : "";
    if (value) { if (value.length > 120) return { ok: false, error: "Choose a template from the list, or leave it empty." }; body[key] = value; }
  }
  if (raw.blanks !== undefined && raw.blanks !== "") {
    if (!raw.blanks || typeof raw.blanks !== "object" || Array.isArray(raw.blanks) || Object.values(raw.blanks).some((value) => typeof value !== "string")) return { ok: false, error: "Fill in the template's words, then try again." };
    body.blanks = Object.fromEntries(Object.entries(raw.blanks).map(([key, value]) => [key, notGiven(value) ? "" : String(value).trim()]));
  }
  for (const key of ["cast", "references"] as const) {
    const referenceValues = key === "references" ? [raw.reference, raw.references].filter((entry) => entry !== undefined && entry !== "") : [];
    const value = key === "references" ? referenceValues.flatMap((entry) => Array.isArray(entry) ? entry : typeof entry === "string" ? entry.split(",") : [entry]) : raw[key];
    if (value === undefined || value === "") continue;
    const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : null;
    if (!list || list.some((item) => typeof item !== "string")) return { ok: false, error: key === "cast" ? "Choose people from the cast list." : "Choose pictures from your Library." };
    const ids = [...new Set((list as string[]).map((item) => item.trim()).filter((item) => item && !notGiven(item)))];
    if (key === "references" && ids.length > 3) return { ok: false, error: "Choose up to 3 reference pictures, then try again." };
    if (key === "cast" && ids.length > 6) return { ok: false, error: "Choose up to 6 people from the cast list." };
    if (ids.length) body[key] = ids;
  }
  const flatPresets: NonNullable<PictureMakeBody["presets"]> = {};
  for (const key of ["light", "angle", "format"] as const) {
    const value = raw[key];
    if (typeof value === "string" && value.trim() && !notGiven(value)) flatPresets[key] = value.trim();
  }
  const look = Object.entries(raw).find(([key, value]) => key.startsWith("look_") && typeof value === "string" && value.trim() && !notGiven(value));
  if (look) flatPresets.look = String(look[1]).trim();
  if (Object.keys(flatPresets).length) body.presets = { ...body.presets, ...flatPresets };
  return { ok: true, body };
}

export async function makePictureFor(actor: PersonRow, body: PictureMakeBody): Promise<PictureMakeResult> {
  let submitted: PictureMakeBody = body;
  if (body.template) {
    const template = getTemplate(body.template);
    if (template?.kind === "picture") {
      const blankSpecs = [...template.prompt.matchAll(/\{\{([a-z][a-z0-9_]*)\|([^|}]+)\|([^}]*)\}\}/g)].map((match) => ({ name: match[1]!, example: match[3]!.trim() }));
      if (blankSpecs.length) {
        const blanks = { ...(body.blanks ?? {}) };
        const castSlots = blankSpecs.filter((blank) => blank.name.startsWith("cast_"));
        let castIndex = 0;
        let promptUsed = false;
        for (const blank of blankSpecs) {
          if (typeof blanks[blank.name] === "string" && blanks[blank.name]!.trim()) continue;
          if (blank.name.startsWith("cast_")) {
            const castId = body.cast?.[castIndex++];
            if (castId) blanks[blank.name] = castId;
          } else if (!promptUsed && body.prompt.trim()) {
            blanks[blank.name] = body.prompt.trim();
            promptUsed = true;
          } else blanks[blank.name] = blank.example;
        }
        if (castSlots.some((blank) => !String(blanks[blank.name] ?? "").trim())) return { ok: false, status: 422, error: "This template needs a person from your cast. Pick one in Cast, then try again.", code: "cast" };
        const wordBlanks = blankSpecs.filter((blank) => PICTURE_WORD_BLANKS.has(blank.name)).map((blank) => String(blanks[blank.name] ?? "").trim()).filter(Boolean);
        submitted = { ...body, prompt: "", blanks, ...(wordBlanks.length ? { words: [...(body.words ?? []), ...wordBlanks].slice(0, 6) } : {}) };
      }
    }
  }
  const state = { actor, persona: null, conversationId: null, turnId: null, temporary: false, ephemeral: false, surface: "chat", speakerEvidence: null, deviceId: null, planBasis: { surfaceClass: "written" }, plan: null } as unknown as RunGenerateImageInput["state"];
  const outcome = await runGenerateImage({ state, args: { ...submitted, ...(submitted.shape ? { size: submitted.shape } : {}) }, callId: "make", spoken: false });
  const data = outcome.result?.data as { pictureJobId?: string; pictureJobIds?: string[]; refused?: string; locked?: boolean } | undefined;
  if (outcome.status === "succeeded" && (data?.pictureJobId || data?.pictureJobIds?.length)) {
    const ids = data.pictureJobIds ?? [data.pictureJobId!];
    // The reply text is written for the chat model; the only line a person needs is that extra references were left out.
    const extras = /Some extra reference pictures were not used\./.test(outcome.result?.reply?.text ?? "") ? "Some extra reference pictures were not used." : null;
    // TEXT-PIC-07: one plain line when the picture has words (the spelling check is added with TEXT-PIC-05).
    const wordsLine = body.words?.length ? "This picture has words, so Home used its text picture model." : null;
    const setLine = body.set ? `Making a set of ${ids.length} pictures.` : null;
    const notice = [setLine, extras, wordsLine].filter(Boolean).join(" ") || null;
    return { ok: true, ids, notice };
  }
  const rawLine = (outcome.result?.reply?.text ?? "").replace(/^No picture was (?:made|changed)\. Say this to the person in your own words(?: and keep its meaning)?:\s*/, "").trim();
  if (rawLine) {
    const forbidden = data?.locked === true || ["guest", "minor", "spoken", "shared_screen", "household_off", "temporary_unsupported", "locked", "adult_style_locked"].includes(data?.refused ?? "");
    return { ok: false, status: forbidden ? 403 : 422, error: rawLine, code: data?.refused ?? "refused" };
  }
  const code = outcome.errorCode ?? "failed";
  const status = outcome.failureKind === "unavailable" ? 503 : outcome.failureKind === "bad_arguments" ? 422 : 502;
  return { ok: false, status, error: outcome.detail ?? (status === 422 ? "Describe the picture in 3 to 1200 characters, then try again." : "The picture could not be made. Try again in a minute."), code };
}

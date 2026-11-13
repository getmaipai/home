// CREATOR-15 slice A: Create enters the same generate_image definition as chat, on the person's own written screen.
import type { PersonRow } from "@/types";
import { runGenerateImage, type RunGenerateImageInput } from "./tool";

export interface PictureMakeBody {
  prompt: string;
  shape?: "square" | "landscape" | "portrait" | "wide" | "tall";
  count?: number;
  tier?: "standard" | "boost" | "max";
  presets?: { look?: string; light?: string; angle?: string; format?: string };
  template?: string;
  blanks?: Record<string, string>;
  cast?: string[];
  references?: string[];
}
export type PictureMakeResult = { ok: true; ids: string[]; notice: string | null } | { ok: false; status: 403 | 404 | 422 | 502 | 503; error: string; code: string };

const notGiven = (value: unknown) => typeof value === "string" && (/^\{[a-z_]+\}$/.test(value.trim()) || value.trim().toLowerCase() === "none");
export function readPictureMakeBody(raw: Record<string, unknown>): { ok: true; body: PictureMakeBody } | { ok: false; error: string } {
  raw = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, notGiven(value) ? "" : value]));
  const prompt = typeof raw.prompt === "string" ? raw.prompt.trim() : "";
  // A template builds its own prompt, so an empty one is fine beside a template id.
  const hasTemplate = typeof raw.template === "string" && raw.template.trim() !== "";
  if ((prompt.length < 3 && !(hasTemplate && prompt.length === 0)) || prompt.length > 1200) return { ok: false, error: "Describe the picture in 3 to 1200 characters, then try again." };
  const body: PictureMakeBody = { prompt };
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
  const tier = typeof raw.tier === "string" && !notGiven(raw.tier) ? raw.tier.trim().toLowerCase() : "";
  if (tier) {
    if (!["standard", "boost", "max"].includes(tier)) return { ok: false, error: "Choose Standard, Boost or Max for the level, or leave it empty." };
    body.tier = tier as PictureMakeBody["tier"];
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
    const value = key === "references" && raw.reference !== undefined && raw.reference !== "" ? [raw.reference] : raw[key];
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
  const state = { actor, persona: null, conversationId: null, turnId: null, temporary: false, ephemeral: false, surface: "chat", speakerEvidence: null, deviceId: null, planBasis: { surfaceClass: "written" }, plan: null } as unknown as RunGenerateImageInput["state"];
  const outcome = await runGenerateImage({ state, args: { ...body, ...(body.shape ? { size: body.shape } : {}) }, callId: "make", spoken: false });
  const data = outcome.result?.data as { pictureJobId?: string; pictureJobIds?: string[]; refused?: string; locked?: boolean } | undefined;
  if (outcome.status === "succeeded" && (data?.pictureJobId || data?.pictureJobIds?.length)) {
    const ids = data.pictureJobIds ?? [data.pictureJobId!];
    // The reply text is written for the chat model; the only line a person needs is that extra references were left out.
    const notice = /Some extra reference pictures were not used\./.test(outcome.result?.reply?.text ?? "") ? "Some extra reference pictures were not used." : null;
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

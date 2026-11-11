// FILM-PICTURES-01: what each picture the person attached is FOR in a film: the actor, the product, the set, the closing wide shot, a prop.
// One call per picture to the same local vision model the age check uses. The model is asked to describe objects and places and to name
// nobody: a person is "the man in the grey robe", never an identity. Role and kind decide how the film uses the picture.
import { completeViaStackRequest, type LlmMessage } from "@/lib/llm";
import { downscaleForCheck, pictureReader, type PictureReader } from "./ageCheck";
import type { SubjectKind } from "@/lib/mediaSubjects";

export const PICTURE_ROLES = ["actor", "product", "set", "end_shot", "prop", "other"] as const;
export type PictureRole = (typeof PICTURE_ROLES)[number];
export interface PictureReading { role: PictureRole; name: string; look: string }

const SCHEMA = {
  name: "picture_role",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["role", "name", "look"],
    properties: {
      role: { type: "string", enum: [...PICTURE_ROLES] },
      name: { type: "string", maxLength: 60 },
      look: { type: "string", maxLength: 400 },
    },
  },
} as const;

const SYSTEM = [
  "You look at one picture a person attached to a request for a film and say what it is for.",
  "role: actor = a person or animal who could play a part; product = the main object being shown off or sold; set = an interior or a place where scenes happen;",
  "end_shot = a whole building, street, skyline or landscape seen from far away, good for a closing wide shot; prop = a smaller object that belongs in a scene; other = none of these.",
  "name: two to four plain words for what is shown, such as espresso machine, man in a grey robe, small kitchen, apartment building. Never a real person's name and never who anyone is.",
  "look: one plain sentence of positive facts about colours, materials, clothing and shapes, as you would tell a painter. Describe only what is there.",
  "Reply with one JSON object that has exactly the fields role, name and look.",
].join("\n");

let visionForTests: ((dataUrl: string) => Promise<string>) | null = null;
export function __setRolesVisionForTests(fn: ((dataUrl: string) => Promise<string>) | null): void { visionForTests = fn; }

export function parseReading(text: string): PictureReading | null {
  try {
    const start = text.indexOf("{"), end = text.lastIndexOf("}");
    const json = JSON.parse(start >= 0 && end > start ? text.slice(start, end + 1) : text) as Record<string, unknown>;
    const role = (PICTURE_ROLES as readonly string[]).includes(json.role as string) ? (json.role as PictureRole) : null;
    const name = typeof json.name === "string" ? json.name.trim().slice(0, 60) : "";
    const look = typeof json.look === "string" ? json.look.trim().slice(0, 400) : "";
    return role && name && look ? { role, name, look } : null;
  } catch { return null; }
}

async function ask(dataUrl: string, reader: PictureReader, signal: AbortSignal): Promise<string> {
  if (visionForTests) return visionForTests(dataUrl);
  const messages: LlmMessage[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: "What is this picture for?", images: [{ id: "role", name: "image", url: dataUrl, reservedTokens: 2560 }] },
  ];
  const result = await completeViaStackRequest(reader, { model: reader, messages, stream: false, temperature: 0, max_tokens: 220, response_format: { type: "json_schema", json_schema: SCHEMA }, chat_template_kwargs: { enable_thinking: false } }, signal);
  if (!result.ok) throw new Error(result.failure.error);
  const content = (result.data as { choices?: Array<{ message?: { content?: string | null } }> }).choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("no answer");
  return content;
}

/** One reading per picture, in order, or a plain line when the pictures could not be read. Never throws. */
export async function readPictureRoles(images: ReadonlyArray<Uint8Array>): Promise<{ ok: true; readings: PictureReading[] } | { ok: false; line: string }> {
  const fail = { ok: false as const, line: "I couldn't look at your pictures just now. Try again in a moment." };
  const reader: PictureReader | null = visionForTests ? "chat" : await pictureReader();
  if (!reader) return fail;
  const readings: PictureReading[] = [];
  for (const bytes of images) {
    try {
      const jpeg = await downscaleForCheck(bytes);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      try {
        const raw = await ask(`data:image/jpeg;base64,${Buffer.from(jpeg).toString("base64")}`, reader, controller.signal);
        const reading = parseReading(raw);
        if (!reading) return fail;
        readings.push(reading);
      } finally { clearTimeout(timer); }
    } catch { return fail; }
  }
  return { ok: true, readings };
}

/** How a film saves a picture: people and animals are characters, a product or prop is a prop, a set or a closing wide shot is a place. */
export function kindOfRole(role: PictureRole): SubjectKind {
  return role === "actor" ? "character" : role === "set" || role === "end_shot" ? "place" : "prop";
}

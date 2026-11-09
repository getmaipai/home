import sharp from "sharp";
import { z } from "zod";
import { chatModelReadsPictures } from "@/lib/chatPictures";
import { markChatReaderUnusable, pictureReader } from "@/lib/pictures/ageCheck";
import { complete } from "@/lib/llm";
import { TalkAnchor } from "@/lib/companionLook";

const Boxes = z.object({ mouth: TalkAnchor, eyes: TalkAnchor });
export const TALK_ANCHORS_UNAVAILABLE = "Pictures could not be read. Mark the mouth and eyes by hand.";
let completion = complete;
export function __setTalkAnchorCompletionForTests(fn: typeof complete | undefined): void {
  completion = fn ?? complete;
}

export function padAnchor(box: z.infer<typeof TalkAnchor>, factor = 1.6): z.infer<typeof TalkAnchor> {
  const width = Math.min(1, box.w * factor);
  const height = Math.min(1, box.h * factor);
  const centerX = box.x + box.w / 2;
  const centerY = box.y + box.h / 2;
  const x = Math.max(0, Math.min(1 - width, centerX - width / 2));
  const y = Math.max(0, Math.min(1 - height, centerY - height / 2));
  return { x, y, w: width, h: height };
}
const BOX_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["x", "y", "w", "h"],
  properties: { x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } },
} as const;

const RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "talk_anchors",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["mouth", "eyes"],
      properties: { mouth: BOX_SCHEMA, eyes: BOX_SCHEMA },
    },
  },
} as const;

const ASK =
  "Return tight bounding boxes for the mouth and both eyes together, as x,y,width,height fractions from 0 to 1 of the full picture. " +
  "Reply only with the requested JSON.";

/** Tight boxes from the vision model, grown by `padAnchor`. Any failure gives the plain "mark them by hand" sentence. */
export async function detectTalkAnchors(png: Uint8Array): Promise<{ anchor: z.infer<typeof TalkAnchor>; eyes_anchor: z.infer<typeof TalkAnchor> }> {
  try {
    const capability = await chatModelReadsPictures();
    const first: "chat" | "vision" | null = capability.imageParts && capability.pictureTokensMax ? "chat" : await pictureReader();
    if (!first) throw new Error("no reader");
    const resized = sharp(png).flatten({ background: "white" }).resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true });
    const jpeg = await resized.jpeg({ quality: 88 }).toBuffer();
    const ask = (reader: "chat" | "vision") => {
      const image = {
        id: "talk-anchor",
        name: "rest picture",
        url: `data:image/jpeg;base64,${jpeg.toString("base64")}`,
        reservedTokens: reader === "chat" ? capability.pictureTokensMax! : 2560,
      };
      const options = { temperature: 0, max_tokens: 120, thinking: false, dropReasoning: true, response_format: RESPONSE_FORMAT };
      return completion(reader, [{ role: "user", content: ASK, images: [image] }], options);
    };
    let result = await ask(first);
    if (!result.ok && first === "chat") {
      markChatReaderUnusable();
      const next = await pictureReader();
      if (next && next !== "chat") result = await ask(next);
    }
    if (!result.ok) throw new Error("reader failed");
    const parsed = Boxes.safeParse(JSON.parse(result.value.text));
    if (!parsed.success) throw new Error("bad boxes");
    return { anchor: padAnchor(parsed.data.mouth), eyes_anchor: padAnchor(parsed.data.eyes) };
  } catch {
    throw new Error(TALK_ANCHORS_UNAVAILABLE);
  }
}

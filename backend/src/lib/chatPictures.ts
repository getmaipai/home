// VISION-02c: the chat model reads pictures itself. One source decides
// whether a turn's stored pictures go to the model as picture parts: the
// Stack's chat role row, which says whether the running chat process was
// launched with its projector and passed its picture check (imageInput)
// and how many tokens one picture may take there (picture_tokens_max).
// Never a model id (rule 8). When it says no, chatImageNote.ts's note
// and today's behaviour stay exactly as they are.
//
// Pictures go only to the local chat engine through Home's Stack client
// (PRIVACY.md): nothing here fetches, and nothing on this path imports
// face recognition or computes a face embedding.
import type { PersonRow } from "@/types";
import type { ChatImagePart } from "@/wire";
import { completeViaStackRequest, type LlmImagePart } from "@/lib/llm";
import { isStackConfigured } from "@/lib/stackEngine";
import { sharedStackRoles } from "@/lib/roleHealth";
import { getTemporaryChatImage, readAttachmentForConversation } from "@/lib/attachments";
import { getPersonSettingSource, getPersonSettingValue } from "@/lib/settings";
import { speakerAgeBand, type AgeBand } from "@/lib/ageBand";
import { cleanPictureName } from "@/lib/chatImageNote";
import { decide } from "@/lib/gate/decide";
import type { Role } from "@/middleware/auth";

export interface ChatPictureCapability {
  /** The running chat model reads pictures, and the turn may send them. */
  imageParts: boolean;
  /** The most tokens one picture takes in that process; null when off. */
  pictureTokensMax: number | null;
}

const OFF: ChatPictureCapability = { imageParts: false, pictureTokensMax: null };

let forTests: ChatPictureCapability | null = null;
/** Test seam: the Stack's answer, without a Stack. */
export function __setChatPictureCapabilityForTests(value: ChatPictureCapability | null): void { forTests = value; }

/** Whether the household's chat model reads pictures right now: the
 * Stack's chat row declares picture input (its process loaded the
 * projector and read the check picture), the role is up, and the row
 * names the bound on one picture's tokens. Any failure to read the row
 * is "no", never an error. */
export async function chatModelReadsPictures(): Promise<ChatPictureCapability> {
  if (forTests) return forTests;
  if (!isStackConfigured()) return OFF;
  try {
    const { roles } = await sharedStackRoles();
    const row = roles.find((role) => role.id === "chat");
    const state = row?.state.state;
    if (!row || (state !== "ready" && state !== "loaded" && state !== "installed")) return OFF;
    const tokens = row.picture_tokens_max;
    if (row.model?.imageInput !== true || typeof tokens !== "number" || !Number.isInteger(tokens) || tokens <= 0) return OFF;
    return { imageParts: true, pictureTokensMax: tokens };
  } catch {
    return OFF;
  }
}

/** The one rule for whether this person may send photos in chat (the
 * upload route and a picture turn both ask it): `chat.photo_uploads` on,
 * and for a child only once a parent turned it on (child off by
 * default). A teen follows the same setting. */
export function photoUploadsAllowed(actor: PersonRow, now = new Date()): boolean {
  const band = speakerAgeBand(actor, now);
  const gate = decide({
    who: { personId: actor.id, role: actor.role as Role, band },
    what: { capabilities: ["upload.photo"] },
  });
  if (gate.kind !== "allow_with_limits" || !gate.limits.includes("setting_gated")) return false;
  const settingOn = getPersonSettingValue(actor, "chat.photo_uploads") === true;
  if (!settingOn) return false;
  if (band === "child") return Boolean(getPersonSettingSource(actor.id, "chat.photo_uploads"));
  return true;
}

/** Whether this turn's pictures go to the model as picture parts: the
 * model reads them and the person may send photos (a child only once a
 * parent turned photos on; a teen by the same setting). VISION-02d: a
 * child's or teen's answer about a picture passes the output gate at
 * their grain like every answer (rule 10); nothing here loosens it, and
 * no learned image check decides anything (RULES-AND-LEARNED-COMPONENTS). */
export function picturePartsAllowed(capability: ChatPictureCapability, actor: PersonRow, turn?: { band: AgeBand; anonymous: boolean }): boolean {
  if (!capability.imageParts || capability.pictureTokensMax === null) return false;
  // A turn by an unidentified speaker, or one whose band is not the
  // signed-in person's own, sends no picture: the photo setting read below
  // is that account's, not the speaker's (two reviews).
  if (turn && (turn.anonymous || turn.band !== speakerAgeBand(actor, new Date()))) return false;
  return photoUploadsAllowed(actor);
}

/** Reads each stored picture for this turn as a picture part. A picture
 * that cannot be read is returned in `unread` (rule 6: the turn goes on,
 * and the model is told only that it could not be read). */
export function loadPictureParts(actor: PersonRow, conversationId: string, temporary: boolean, images: readonly ChatImagePart[], reservedTokens: number): { parts: LlmImagePart[]; unread: ChatImagePart[] } {
  const parts: LlmImagePart[] = [];
  const unread: ChatImagePart[] = [];
  for (const image of images) {
    let bytes: Uint8Array | null = null;
    let mediaType = image.media_type;
    if (temporary) {
      const stored = getTemporaryChatImage(actor, conversationId, image.id);
      if (stored) { bytes = stored.bytes; mediaType = stored.mediaType; }
    } else {
      const read = readAttachmentForConversation(actor, conversationId, image.id);
      if (read.ok) { bytes = read.value.bytes; mediaType = read.value.record.media_type; }
    }
    if (!bytes || !mediaType.startsWith("image/")) { unread.push(image); continue; }
    parts.push({ id: image.id, name: cleanPictureName(image.name), url: `data:${mediaType};base64,${Buffer.from(bytes).toString("base64")}`, reservedTokens });
  }
  return { parts, unread };
}

// VISION-ATTACH-01: pictures when the chat engine cannot read them (Splash, oMLX and mlx-serve serve text only). The Stack's vision role is a
// separate small model that always reads pictures; it describes each one in words and the chat model answers from those words. Same person
// and turn checks as the chat model's own reading (picturePartsAllowed), and the pictures themselves still reach the tools that need them.
export const VISION_PICTURE_TOKENS = 2560;
let visionForTests: boolean | null = null;
export function __setVisionReaderForTests(value: boolean | null): void { visionForTests = value; }
let describeForTests: ((dataUrl: string) => Promise<string>) | null = null;
export function __setPictureDescriberForTests(fn: ((dataUrl: string) => Promise<string>) | null): void { describeForTests = fn; }

/** Whether the Stack's vision role is up and declares picture input. Any failure to read the row is "no". */
export async function visionModelReadsPictures(): Promise<boolean> {
  if (visionForTests !== null) return visionForTests;
  if (!isStackConfigured()) return false;
  try {
    const row = (await sharedStackRoles()).roles.find((role) => role.id === "vision");
    const state = row?.state.state;
    return !!row && (state === "ready" || state === "loaded" || state === "installed") && row.model?.imageInput === true;
  } catch { return false; }
}

/** Whether this person's pictures can go through the vision model on this turn. */
export async function visionPicturesAllowed(actor: PersonRow, turn?: { band: AgeBand; anonymous: boolean }): Promise<boolean> {
  return (await visionModelReadsPictures()) && picturePartsAllowed({ imageParts: true, pictureTokensMax: VISION_PICTURE_TOKENS }, actor, turn);
}

const DESCRIBE_SYSTEM = "You describe one picture for someone who cannot see it. Say in one to three plain sentences what it shows: the main subject, colours, objects, setting, and any writing you can read. Describe only what is there. Never say who a real person is and never guess a name.";

async function describeOne(dataUrl: string): Promise<string> {
  if (describeForTests) return describeForTests(dataUrl);
  const result = await completeViaStackRequest("vision", {
    model: "vision", stream: false, temperature: 0, max_tokens: 220,
    messages: [{ role: "system", content: DESCRIBE_SYSTEM }, { role: "user", content: "Describe this picture.", images: [{ id: "describe", name: "picture", url: dataUrl, reservedTokens: VISION_PICTURE_TOKENS }] }],
    chat_template_kwargs: { enable_thinking: false },
  } as never, AbortSignal.timeout(45_000));
  if (!result.ok) throw new Error(result.failure.error);
  const content = (result.data as { choices?: Array<{ message?: { content?: string | null } }> }).choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("no answer");
  return content.trim().slice(0, 600);
}

/** Each stored picture of the turn, described in words by the vision model. A picture that could not be opened or read goes to `unread`. */
export async function describePictures(actor: PersonRow, conversationId: string, temporary: boolean, images: readonly ChatImagePart[]): Promise<{ described: Array<{ name: string; text: string }>; unread: ChatImagePart[] }> {
  const loaded = loadPictureParts(actor, conversationId, temporary, images, VISION_PICTURE_TOKENS);
  const unread = [...loaded.unread];
  const described: Array<{ name: string; text: string }> = [];
  for (const part of loaded.parts) {
    try { described.push({ name: part.name, text: await describeOne(part.url) }); }
    catch { const original = images.find((image) => image.id === part.id); if (original) unread.push(original); }
  }
  return { described, unread };
}

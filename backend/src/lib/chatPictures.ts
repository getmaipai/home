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
import type { LlmImagePart } from "@/lib/llm";
import { getStackClient, isStackConfigured } from "@/lib/stackEngine";
import { getTemporaryChatImage, readAttachmentForConversation } from "@/lib/attachments";
import { getPersonSettingSource, getPersonSettingValue } from "@/lib/settings";
import { speakerAgeBand, type AgeBand } from "@/lib/ageBand";
import { cleanPictureName } from "@/lib/chatImageNote";

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
    const { roles } = await getStackClient().roles();
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
  const settingOn = getPersonSettingValue(actor, "chat.photo_uploads") === true;
  if (!settingOn) return false;
  if (speakerAgeBand(actor, now) === "child") return Boolean(getPersonSettingSource(actor.id, "chat.photo_uploads"));
  return true;
}

/** Whether this turn's pictures go to the model as picture parts: the
 * model reads them, the person may send photos, and (until VISION-02d's
 * floor lands for children and teens) the speaker is an adult. */
export function picturePartsAllowed(capability: ChatPictureCapability, actor: PersonRow, band: AgeBand): boolean {
  if (!capability.imageParts || capability.pictureTokensMax === null) return false;
  if (band !== "adult") return false;
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

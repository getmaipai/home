// SAVE-CHARACTER-01: "Save as a character" for a finished picture in the Library. One subject of kind character, the picture is its first reference, and the look capture
// (castLook.ts, the one sheet builder) starts in the background. Nothing here widens access: the subject's own audience mark comes from the picture it holds (the
// subject helpers read it from the reference's provenance), the lock and the age ceiling are checked on the picture first, and a minor only ever saves their own pictures.
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { fileAudience } from "@/lib/access";
import { lockItemOfProvenance, lockState } from "@/lib/adultLock";
import { speakerAgeBand } from "@/lib/ageBand";
import { captureLook } from "@/lib/castLook";
import { createMediaSubject, type MediaSubject } from "@/lib/mediaSubjects";
import { pictureEngineStatus } from "@/lib/pictures/ready";
import type { PersonRow } from "@/types";

export const CHARACTER_NAME_MAX = 60;
export const CHARACTER_LOCKED_LINE = "This picture is locked. Unlock your adult items, then save it as a character.";
export const CHARACTER_HIDDEN_LINE = "That picture is not available to you, so it cannot be saved as a character.";
export const CHARACTER_MISSING_LINE = "That picture is not in your Library. Choose one of your own pictures and try again.";
export const CHARACTER_KEEP_LINE = "Keep this picture first, then save it as a character.";
export const CHARACTER_NAME_LINE = "Give the character a name of 1 to 60 letters.";
export const CHARACTER_GUEST_LINE = "Saved characters are not available to guest profiles.";
export const CHARACTER_SAVED_LINE = "Saved. The model sheet is being made.";
export const CHARACTER_WAITING_LINE = "Saved. Its model sheet is not made yet because the picture engine is off.";

export type CharacterSave =
  | { ok: true; subject: MediaSubject; capture: "started" | "waiting"; line: string }
  | { ok: false; status: 400 | 403 | 404; line: string };

type Starter = (actor: PersonRow, subjectId: string) => void;
let starterOverride: Starter | null = null;
/** Test seam: replaces the background look capture so a test never runs the real sheet builder. */
export function __setCharacterCaptureForTests(fn: Starter | null): void { starterOverride = fn; }
const realStarter: Starter = (actor, subjectId) => {
  void captureLook(actor, subjectId).then((made) => { if (!made.ok) console.error("[save-character] look capture refused:", made.line); }).catch((error) => console.error("[save-character] look capture failed:", error instanceof Error ? error.message : error));
};

export async function saveCharacterFromPicture(actor: PersonRow, input: { fileId: string; name: string }): Promise<CharacterSave> {
  if (actor.role === "guest") return { ok: false, status: 403, line: CHARACTER_GUEST_LINE };
  const name = input.name.trim();
  if (name.length < 1 || name.length > CHARACTER_NAME_MAX) return { ok: false, status: 400, line: CHARACTER_NAME_LINE };
  const file = db.select().from(attachments).where(and(eq(attachments.id, input.fileId), eq(attachments.ownerPersonId, actor.id), isNull(attachments.deletedAt))).get();
  if (!file || !file.mediaType.startsWith("image/")) return { ok: false, status: 404, line: CHARACTER_MISSING_LINE };
  const minor = speakerAgeBand(actor, new Date()) !== "adult";
  if (minor && fileAudience(file.provenance) === "adult-only") return { ok: false, status: 403, line: CHARACTER_HIDDEN_LINE };
  const lock = lockState(lockItemOfProvenance(file.ownerPersonId, file.provenance), actor);
  if (lock === "hidden") return { ok: false, status: 403, line: CHARACTER_HIDDEN_LINE };
  if (lock === "locked") return { ok: false, status: 403, line: CHARACTER_LOCKED_LINE };
  if (file.retention !== "kept" && !file.provenance.startsWith("picture-gen:") && file.provenance !== "media-subject-reference") return { ok: false, status: 400, line: CHARACTER_KEEP_LINE };
  let subject: MediaSubject;
  try { subject = createMediaSubject(actor, { name, kind: "character", look: name, referenceIds: [file.id], real: false }, "library:save-as-character"); }
  catch (error) { return { ok: false, status: 400, line: error instanceof Error ? error.message : "The character could not be saved. Try again." }; }
  const engine = await pictureEngineStatus();
  if (!engine) return { ok: true, subject, capture: "waiting", line: CHARACTER_WAITING_LINE };
  (starterOverride ?? realStarter)(actor, subject.id);
  return { ok: true, subject, capture: "started", line: CHARACTER_SAVED_LINE };
}

// STUDIO-GAPS-02: the Studio's "Add a reference picture" for a described change. The kit opens the host's picker (the person's own open Library pictures),
// then calls this with the picture being changed and the one chosen; the answer is the id and a name the editor shows on the Comment, and the id is what
// the comment request later sends as `reference`. Nothing is read or stored here beyond the checks: every rule is the one the change itself applies
// (imageEdit.startComment), asked early so the person is told before they type, not after Send.
import { ImageEditError, LIBRARY_SOURCE, loadSource } from "@/lib/imageEdit";
import { CHILD_NO_PHOTOS_LINE } from "@/lib/pictures/lane";
import { laneOfPerson } from "@/lib/pictures/laneGate";
import { pictureEngineStatus } from "@/lib/pictures/ready";
import type { PersonRow } from "@/types";

export const REFERENCE_UNSUPPORTED_LINE = "Using a second picture needs an update first. Ask an admin to update Home.";

/** The reference picture a person chose for the change they are describing, checked and named. */
export async function studioReference(person: PersonRow, body: Record<string, unknown>): Promise<{ id: string; label: string }> {
  const file = typeof body.file === "string" ? body.file : "";
  const ref = typeof body.ref === "string" ? body.ref.trim() : "";
  if (!ref || ref.startsWith("$")) throw new ImageEditError(422, "Choose a picture to draw on, then try again.", "reference_required");
  if (laneOfPerson(person) === "child") throw new ImageEditError(422, CHILD_NO_PHOTOS_LINE, "child_cartoons_only");
  // Both pictures must be the person's own, open and not in Trash: another person's picture is a 404 (never a hint it exists), a locked one is refused unnamed.
  if (file) loadSource(person, LIBRARY_SOURCE, file, false);
  const source = loadSource(person, LIBRARY_SOURCE, ref, false);
  if (source.id === file) throw new ImageEditError(422, "Choose a different picture to draw on than the one you are changing.", "reference_same");
  const status = await pictureEngineStatus().catch(() => null);
  if ((status?.edit?.references ?? 0) < 1) throw new ImageEditError(503, REFERENCE_UNSUPPORTED_LINE, "references_unsupported");
  return { id: ref, label: source.name?.trim() || "Picture" };
}

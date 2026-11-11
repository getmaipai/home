// FILM-PICTURES-01: the pictures attached to a film request become its cast. Each one is read (what is it for?), saved as a character, a prop
// or a place, and described to the planner with its role so the film uses it that way: the actor plays the part, the product is shown off,
// the set is where scenes happen, the building is the closing wide shot. Several pictures of the same thing become one subject with several pictures.
import type { PersonRow } from "@/types";
import { loadSource } from "@/lib/imageEdit";
import { prepareCharacters } from "@/lib/longform/characters";
import { kindOfRole, readPictureRoles, type PictureRole } from "@/lib/pictures/roles";

const USE: Record<PictureRole, string> = {
  actor: "actor: plays a part",
  product: "product: show it off, it is what the film is about",
  set: "set: scenes happen here",
  end_shot: "closing wide shot: end the film pulling back to reveal it",
  prop: "prop: belongs in a scene",
  other: "extra reference",
};
const cap = (text: string) => text.charAt(0).toLocaleUpperCase() + text.slice(1);

export type FilmPictures = { ok: true; names: string[]; hints: string[] } | { ok: false; line: string };

export async function prepareFilmPictures(actor: PersonRow, input: { images: ReadonlyArray<{ id: string }>; conversationId?: string | null }): Promise<FilmPictures> {
  if (!input.images.length) return { ok: true, names: [], hints: [] };
  if (!input.conversationId) return { ok: false, line: "Pictures can be used from a chat. Open a chat and attach them there." };
  let bytes: Uint8Array[];
  try { bytes = input.images.map((image) => loadSource(actor, input.conversationId!, image.id, false).bytes); }
  catch (error) { return { ok: false, line: error instanceof Error && error.message ? error.message : "I couldn't open your pictures. Attach them again." }; }
  const read = await readPictureRoles(bytes);
  if (!read.ok) return read;
  // The same name and role is one subject with several pictures; the same name in another role gets a number.
  const used = new Map<string, PictureRole>();
  const names: string[] = [], kinds: Record<string, "character" | "prop" | "place"> = {}, looks: Record<string, string> = {}, hints = new Map<string, string>();
  for (const reading of read.readings) {
    let name = cap(reading.name), n = 1;
    while (used.has(name.toLocaleLowerCase()) && used.get(name.toLocaleLowerCase()) !== reading.role) name = `${cap(reading.name)} ${++n}`;
    used.set(name.toLocaleLowerCase(), reading.role);
    names.push(name); kinds[name.toLocaleLowerCase()] = kindOfRole(reading.role); looks[name.toLocaleLowerCase()] = reading.look;
    if (!hints.has(name)) hints.set(name, `${name} (${USE[reading.role]}): ${reading.look}`);
  }
  const prepared = await prepareCharacters(actor, { names, images: input.images.map((image) => ({ id: image.id })), conversationId: input.conversationId, kinds, looks });
  return prepared.ok ? { ok: true, names: prepared.names, hints: [...hints.values()] } : prepared;
}

/** A still starts from one picture. It is the picture of whatever the shot is mostly about: the cast member named earliest in the shot's still text
 *  (the planner writes the subject first), so the product close-up starts from the product and the closing wide shot from the building. */
export function pickStarter<T extends { name: string }>(still: string, candidates: readonly T[]): T | undefined {
  const text = still.toLocaleLowerCase();
  const at = (name: string) => { const i = text.indexOf(name.toLocaleLowerCase()); return i < 0 ? Number.POSITIVE_INFINITY : i; };
  return [...candidates].sort((a, b) => at(a.name) - at(b.name))[0];
}

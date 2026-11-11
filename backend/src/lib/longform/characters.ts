// The person's own pictures as characters of a production. Each attached picture is saved as a named character subject (the same "save subject"
// step the picture tools use); a name that already is a saved subject is used as it is. The bible then has to keep those names, and the film
// engine starts each of their stills from the saved picture so the face carries through.
import type { PersonRow } from "@/types";
import { runMediaOp } from "@/lib/mediaOps/registry";
import { listMediaSubjects } from "@/lib/mediaSubjects";

export interface AttachedPicture { id: string }
export type CharacterResult = { ok: true; names: string[] } | { ok: false; line: string };

/** names[i] is the name of the i-th attached picture; extra names refer to characters already saved. Returns every name that is now a saved subject. */
export async function prepareCharacters(actor: PersonRow, input: { names: string[]; images: AttachedPicture[]; conversationId?: string }): Promise<CharacterResult> {
  const used: string[] = [];
  for (const [i, raw] of input.names.entries()) {
    const name = raw.trim(); if (!name) continue;
    const saved = listMediaSubjects(actor).find((s) => s.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (saved) { used.push(saved.name); continue; }
    const image = input.images[i];
    if (!image) return { ok: false, line: `I have no picture for ${name}. Attach one, or name a character you already saved.` };
    if (!input.conversationId) return { ok: false, line: "Pictures can be used from a chat. Open a chat and attach them there." };
    try {
      await runMediaOp(actor, "picture.save_subject", { source: { kind: "picture", via: "chat", id: image.id, conversationId: input.conversationId }, args: { name, kind: "character", look: `${name}, as shown in the attached picture` } });
      used.push(name);
    } catch (error) {
      return { ok: false, line: error instanceof Error && error.message ? error.message : `I couldn't use the picture for ${name}. Try attaching it again.` };
    }
  }
  return { ok: true, names: used };
}

/** The saved subjects named for a production, with their looks, for the bible writer. */
export function savedCharacters(actor: PersonRow, names: string[]): Array<{ name: string; look: string }> {
  const all = listMediaSubjects(actor);
  return names.flatMap((n) => { const s = all.find((x) => x.name === n); return s ? [{ name: s.name, look: s.look }] : []; });
}

// The person's own pictures as characters of a production. Each attached picture is saved as a named character subject (the same "save subject"
// step the picture tools use); a name that already is a saved subject is used as it is. The bible then has to keep those names, and the film
// engine starts each of their stills from the saved picture so the face carries through.
import type { PersonRow } from "@/types";
import { runMediaOp } from "@/lib/mediaOps/registry";
import { listMediaSubjects, updateMediaSubject } from "@/lib/mediaSubjects";
import { loadSource } from "@/lib/imageEdit";
import { storeFile } from "@/lib/attachments";
// synths is loaded where it is used: a top-level import pulls the persona catalog (PERSONAS = loadPersonaCatalog()) in before plugins.ts finished
// loading, which crashed the hub at boot on 2026-11-11 ("Cannot access 'manifestCache' before initialization").

export interface AttachedPicture { id: string }
export type CharacterResult = { ok: true; names: string[] } | { ok: false; line: string };

export const MAX_CHARACTER_PICTURES = 8;

/** names[i] names the i-th attached picture. A name repeated gives that character several pictures (the first makes the character, the others are added
 *  to it, up to MAX_CHARACTER_PICTURES); a name with no picture must already be a saved subject. Returns every name that is now a saved subject. */
export async function prepareCharacters(actor: PersonRow, input: { names: string[]; images: AttachedPicture[]; conversationId?: string }): Promise<CharacterResult> {
  const used: string[] = [];
  const pictures = new Map<string, { name: string; ids: string[] }>();
  for (const [i, raw] of input.names.entries()) {
    const name = raw.trim(); if (!name) continue;
    const key = name.toLocaleLowerCase();
    const entry = pictures.get(key) ?? { name, ids: [] };
    const image = input.images[i];
    if (image) entry.ids.push(image.id);
    pictures.set(key, entry);
  }
  for (const { name, ids } of pictures.values()) {
    let saved = listMediaSubjects(actor).find((s) => s.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (!saved && !ids.length) {
      const { ensureSubject, listSynths, ownerActor } = await import("@/lib/synths");
      // A synth of this person's can play a part: its saved picture and look become the character, the same as a saved subject.
      const synth = listSynths(actor).find((x) => x.persona.display_name.toLocaleLowerCase() === name.toLocaleLowerCase() && ownerActor(x)?.id === actor.id);
      if (synth) {
        try { await ensureSubject(synth); } catch (error) { return { ok: false, line: error instanceof Error && error.message ? error.message : `I couldn't use ${name} as a character. Try again.` }; }
        saved = listMediaSubjects(actor).find((s) => s.name.toLocaleLowerCase() === name.toLocaleLowerCase());
      }
    }
    if (!saved && !ids.length) return { ok: false, line: `I have no picture for ${name}. Attach one, or name a character you already saved.` };
    if (ids.length && !input.conversationId) return { ok: false, line: "Pictures can be used from a chat. Open a chat and attach them there." };
    try {
      let rest = ids;
      if (!saved) {
        await runMediaOp(actor, "picture.save_subject", { source: { kind: "picture", via: "chat", id: ids[0]!, conversationId: input.conversationId }, args: { name, kind: "character", look: `${name}, as shown in the attached pictures` } });
        saved = listMediaSubjects(actor).find((s) => s.name.toLocaleLowerCase() === name.toLocaleLowerCase());
        rest = ids.slice(1);
      }
      if (saved && rest.length) {
        const added: string[] = [];
        for (const id of rest) {
          const loaded = loadSource(actor, input.conversationId!, id, false);
          const file = storeFile(actor, { conversationId: null, turnId: null, mediaType: loaded.mediaType, bytes: loaded.bytes, provenance: "media-subject-reference", retention: "kept", name: `${name} reference` });
          if (!file.ok) return { ok: false, line: file.error };
          added.push(file.value.id);
        }
        updateMediaSubject(actor, saved.id, { referenceIds: [...saved.reference_ids, ...added].slice(0, MAX_CHARACTER_PICTURES) });
      }
      used.push(saved?.name ?? name);
    } catch (error) {
      return { ok: false, line: error instanceof Error && error.message ? error.message : `I couldn't use the pictures for ${name}. Try attaching them again.` };
    }
  }
  return { ok: true, names: used };
}

/** The saved subjects named for a production, with their looks, for the bible writer. */
export function savedCharacters(actor: PersonRow, names: string[]): Array<{ name: string; look: string }> {
  const all = listMediaSubjects(actor);
  return names.flatMap((n) => { const s = all.find((x) => x.name === n); return s ? [{ name: s.name, look: s.look }] : []; });
}

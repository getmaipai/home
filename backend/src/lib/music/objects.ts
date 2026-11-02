// MUSIC-STUDIO-EDIT: the made-music object a chat turn follows (a song, a band, an album or a song style). A turn follows an object
// when the message carries its reference (`maipai://music/band/<id>`, as the Music app's Edit buttons send) or when the newest card
// in the thread is one. The object, never the wording of the message, decides which creation and edit tools are offered (rule 8).
// Rule 6a: nothing here logs a title, a name or an id.
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { conversationTurns } from "@/db/schema";
import type { PersonRow } from "@/types";
import { getMade } from "./madeRecords";

export type MusicObjectKind = "track" | "band" | "album" | "style";
export interface MusicObjectRef { kind: MusicObjectKind; id: string }

const KINDS: ReadonlySet<string> = new Set<MusicObjectKind>(["track", "band", "album", "style"]);
/** A reference's kind is a music object when its app is music and the kind is one of the four. */
export const isMusicObjectRef = (ref: { app: string; kind: string }): boolean => ref.app === "music" && KINDS.has(ref.kind);
export const musicObjectOf = (ref: { app: string; kind: string; id: string }): MusicObjectRef | null => isMusicObjectRef(ref) ? { kind: ref.kind as MusicObjectKind, id: ref.id } : null;

/** The block kind a card has, and the provenance prefix its id rides under. */
const CARD: Record<string, { kind: MusicObjectKind; prefix: string }> = {
  band: { kind: "band", prefix: "make_band" },
  album: { kind: "album", prefix: "make_album" },
  song_style: { kind: "style", prefix: "make_song_style" },
};

/** `make_album:<id>:<conversation>:<turn>` to its parts, for any of the three cards. Null when it is not one of ours. */
export function cardProvenance(provenance: string): { tool: string; id: string; conversationId: string | null; turnId: string | null } | null {
  const [tool, id, conversationId, turnId] = provenance.split(":");
  if (!tool || !id || !/^(make_band|make_album|make_song_style)$/.test(tool) || !/^(mband|malbum|sstyle)-[a-z0-9]+$/.test(id)) return null;
  return { tool, id, conversationId: conversationId && conversationId !== "-" ? conversationId : null, turnId: turnId && turnId !== "-" ? turnId : null };
}

/** The newest band, album or song style card in the thread that still exists and is the person's to see. Null when there is none. */
export function threadMusicObject(actor: PersonRow, conversationId: string): MusicObjectRef | null {
  const rows = db.select({ blocks: conversationTurns.blocks }).from(conversationTurns).where(eq(conversationTurns.conversationId, conversationId)).orderBy(desc(conversationTurns.createdAt)).limit(20).all();
  for (const row of rows) {
    if (!row.blocks || !row.blocks.includes("make_")) continue;
    let blocks: Array<{ kind?: string; provenance?: string }> = [];
    try { blocks = JSON.parse(row.blocks) as typeof blocks; } catch { continue; }
    for (const block of [...blocks].reverse()) {
      const card = block.kind ? CARD[block.kind] : undefined;
      const from = card && block.provenance ? cardProvenance(block.provenance) : null;
      if (!card || !from || from.tool !== card.prefix) continue;
      const store = card.kind === "band" ? "made_artist" : card.kind === "album" ? "made_album" : "song_style";
      if (getMade(store, actor, from.id).ok) return { kind: card.kind, id: from.id };
    }
  }
  return null;
}

type ItemText = { title: string; text: string };
const lines = (...parts: Array<string | number | null | undefined | false>): string => parts.filter(Boolean).join("\n");

/** The item readers for the three made objects, so a reference to one reads under the same access as the Music app. */
export async function readMusicBand(person: PersonRow, id: string): Promise<ItemText | null> {
  const found = getMade("made_artist", person, id); if (!found.ok) return null;
  const b = found.value as unknown as { name: string; backstory?: string | null; genres?: string[]; style?: { description?: string } };
  return { title: b.name, text: lines(`Band: ${b.name}`, b.genres?.length && `Genres: ${b.genres.join(", ")}`, b.style?.description && `Sound: ${b.style.description}`, b.backstory && `Story: ${b.backstory}`) };
}
export async function readMusicAlbum(person: PersonRow, id: string): Promise<ItemText | null> {
  const found = getMade("made_album", person, id); if (!found.ok) return null;
  const a = found.value as unknown as { title: string; blurb?: string | null; look?: string | null; style?: { description?: string; genres?: string[] }; track_media_ids?: string[] };
  return { title: a.title, text: lines(`Album: ${a.title}`, a.style?.description && `Sound: ${a.style.description}`, a.style?.genres?.length && `Genres: ${a.style.genres.join(", ")}`, a.blurb && `About: ${a.blurb}`, a.look && `Cover look: ${a.look}`, `Tracks: ${a.track_media_ids?.length ?? 0}`) };
}
export async function readMusicStyle(person: PersonRow, id: string): Promise<ItemText | null> {
  const found = getMade("song_style", person, id); if (!found.ok) return null;
  const s = found.value as unknown as { title: string; style: { description: string; genres?: string[]; bpm?: number | null; key?: string | null; instrumental?: boolean } };
  return { title: s.title, text: lines(`Song style: ${s.title}`, `Sound: ${s.style.description}`, s.style.genres?.length && `Genres: ${s.style.genres.join(", ")}`, s.style.bpm && `Tempo: ${s.style.bpm} bpm`, s.style.key && `Key: ${s.style.key}`, s.style.instrumental && "No singing") };
}

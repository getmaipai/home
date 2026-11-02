// MUSIC-LIKE-01: what the band card's buttons (and the Music app's band page) do. Every action works on a band the person may
// change; the band record is the only state. Rule 6a: nothing here logs a name, a story, a title or an id.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { conversations, conversationTurns, mediaItems } from "@/db/schema";
import { saveBandSingles } from "@/lib/media/appHost";
import { nextHlc } from "@/lib/hlc";
import { routeAudience } from "@/lib/pictures/audience";
import { pictureDenial } from "@/lib/pictures/policy";
import type { PersonRow } from "@/types";
import { startBandPicture } from "./band";
import { deleteMade, getMade } from "./madeRecords";

export const BAND_ACTION_NAMES = ["keep", "remake", "remake_portrait", "remake_logo", "discard"] as const;
export type BandActionName = (typeof BAND_ACTION_NAMES)[number];
export type BandActionResult =
  | { ok: true; value: { action: BandActionName; done: string; mediaId?: string | null; seedMediaId?: string | null; pending?: boolean } }
  | { ok: false; status: 400 | 403 | 404; error: string };

type Band = { id: string; name: string; owner_person_id?: string | null; backstory?: string | null; genres?: string[]; members?: { name: string; role: string }[]; seed?: { media_id?: string } | null };

function portraitPrompt(band: Band, part: "portrait" | "logo"): string {
  const sound = (band.genres ?? []).slice(0, 3).join(", ") || "indie";
  const who = (band.members ?? []).slice(0, 4).map((m) => m.role).join(", ");
  return part === "portrait"
    ? `A candid group portrait of a ${sound} band${who ? ` (${who})` : ""}, photographic, natural light, a new look.`
    : `A bold, simple band logo mark for a ${sound} band, centered on a plain background, a new design.`;
}

/** The turn the card was made in, when the caller names one and it is the actor's own. A picture needs a turn to be filed under. */
function ownTurn(actor: PersonRow, conversationId: string | null, turnId: string | null): { conversationId: string; turnId: string } | null {
  if (!conversationId || !turnId) return null;
  const conversation = db.select().from(conversations).where(eq(conversations.id, conversationId)).get();
  const turn = db.select().from(conversationTurns).where(eq(conversationTurns.id, turnId)).get();
  return conversation && turn && conversation.personId === actor.id && turn.conversationId === conversationId ? { conversationId, turnId } : null;
}

export async function runBandAction(actor: PersonRow, bandId: string, action: BandActionName, where: { conversationId: string | null; turnId: string | null } = { conversationId: null, turnId: null }): Promise<BandActionResult> {
  const found = getMade("made_artist", actor, bandId);
  if (!found.ok) return { ok: false, status: 404, error: "That band is not here any more. It may have been discarded." };
  const band = found.value as unknown as Band;
  if (band.owner_person_id !== actor.id) return { ok: false, status: 403, error: "Only the person who made the band can do that. Ask them." };
  if (action === "keep") {
    const mediaId = saveBandSingles(actor, bandId);
    return { ok: true, value: { action, mediaId, pending: mediaId === null, done: mediaId ? "Kept. The band and its single are in Music under Bands." : "Kept. The first single is still being made; it will be in Music under Bands when it finishes." } };
  }
  if (action === "discard") {
    const gone = deleteMade("made_artist", actor, bandId);
    // Its saved singles leave the library with it; the files stay in Files.
    if (gone.ok) db.update(mediaItems).set({ hidden: true, hlc: nextHlc() }).where(eq(mediaItems.madeArtistId, bandId)).run();
    return gone.ok ? { ok: true, value: { action, done: "Discarded. The band is gone." } } : { ok: false, status: gone.status as 403 | 404, error: gone.error };
  }
  if (action === "remake") {
    const seedMediaId = band.seed?.media_id ?? null;
    if (!seedMediaId) return { ok: false, status: 400, error: "This band was not made from a song, so it cannot be made again from one. Pick a song and use Band like this." };
    const gone = deleteMade("made_artist", actor, bandId);
    // Its saved singles leave the library with it, as on discard; a new band is made from the same song.
    if (gone.ok) db.update(mediaItems).set({ hidden: true, hlc: nextHlc() }).where(eq(mediaItems.madeArtistId, bandId)).run();
    return gone.ok ? { ok: true, value: { action, seedMediaId, done: "Making a new band from the same song." } } : { ok: false, status: gone.status as 403 | 404, error: gone.error };
  }
  const part = action === "remake_logo" ? "logo" : "portrait";
  const turn = ownTurn(actor, where.conversationId, where.turnId);
  if (!turn) return { ok: false, status: 400, error: "This picture can only be remade from the chat where the band was made. Open that chat and try again." };
  if (pictureDenial(routeAudience(actor))) return { ok: false, status: 403, error: "Pictures are not available for this person." };
  await startBandPicture(turn, actor, bandId, part, portraitPrompt(band, part));
  return { ok: true, value: { action, done: `Making a new ${part}. It shows here when it is ready.` } };
}

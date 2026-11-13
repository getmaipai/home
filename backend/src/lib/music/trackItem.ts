// MUSIC-LIKE-01: a library song as an item reference, `maipai://audio/track/<media id>`. The Player's like-this buttons open a chat
// with this token, so the turn follows the object the person is playing (`make_band` is offered for it). The reader gives the
// song's own labels only, under the same library access as the Audio app.
import { readableItem } from "@/lib/media/access";
import type { PersonRow } from "@/types";

export async function readMusicTrack(person: PersonRow, id: string): Promise<{ title: string; text: string } | null> {
  if (person.role === "guest") return null;
  const item = readableItem(person, id);
  if (!item || item.kind !== "track") return null;
  const lines = [`Title: ${item.title}`, item.artist ? `Artist: ${item.artist}` : "", item.album ? `Album: ${item.album}` : "", item.genre ? `Genre: ${item.genre}` : "", item.year ? `Year: ${item.year}` : ""];
  return { title: item.title, text: lines.filter(Boolean).join("\n") };
}

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { mediaCollections, people } from "@/db/schema";
import { listActivePeople } from "@/lib/access";
import { speakerAgeBand } from "@/lib/ageBand";
import { canSeeItem } from "@/lib/transcripts/store";
import { readableItem } from "./access";
import { itemFromRow } from "./model";
import { mediaItems } from "@/db/schema";
import { getVideoJobFor } from "@/lib/videos/jobs";
import { videoJobLockState } from "@/lib/videos/lock";
import type { PersonRow } from "@/types";
import { createCollection, listCollections, setItems, setSharedTo } from "./collections";
import type { MediaCollection } from "./model";

const gone = () => ({ ok: false as const, status: 404 as const, error: "That video is not available." });
type Pick = MediaCollection["items"][number] & { votes: string[]; added_by?: string };

function familyCollection(person: PersonRow): MediaCollection {
  const all = db.select().from(mediaCollections).where(and(eq(mediaCollections.kind, "family_picks"), isNull(mediaCollections.deletedAt))).all();
  const existing = all[0] ? listCollections(all[0].personId, "family_picks").find((item) => item.id === all[0]!.id) : undefined;
  if (existing) return existing;
  const roster = listActivePeople().filter((candidate) => candidate.enabled && !candidate.deletedAt);
  const owner = roster.find((candidate) => candidate.id === person.id && candidate.enabled && candidate.role !== "guest" && speakerAgeBand(candidate, new Date()) === "adult")
    ?? roster.find((candidate) => candidate.enabled && (candidate.role === "owner" || candidate.role === "admin") && speakerAgeBand(candidate, new Date()) === "adult");
  // The requesting person may be an active adult even when a test/caller supplied a detached row.
  const chosen = owner ?? (person.enabled && !person.deletedAt && person.role !== "guest" && speakerAgeBand(person, new Date()) === "adult" ? person : null);
  if (!chosen) throw new Error("Family Picks requires an active adult owner.");
  const collection = createCollection(chosen.id, "family_picks", "Family Picks", "video");
  setSharedTo(collection, "household");
  return listCollections(chosen.id, "family_picks").find((item) => item.id === collection.id)!;
}

function viewable(person: PersonRow, id: string): boolean {
  const item = readableItem(person, id);
  if (item?.kind === "video") return true;
  if (canSeeItem(person, id)) {
    const row = db.select().from(mediaItems).where(eq(mediaItems.id, id)).get();
    if (row) {
      try { return itemFromRow(row).kind === "video"; } catch { return false; }
    }
  }
  const job = getVideoJobFor(person, id);
  return !!job && videoJobLockState(person, job) === "open";
}

export function listPicks(person: PersonRow) {
  const collection = familyCollection(person);
  const items = collection.items.filter((item) => viewable(person, item.media_id)) as Pick[];
  items.sort((a, b) => b.votes.length - a.votes.length || a.added_at.localeCompare(b.added_at));
  return { collection_id: collection.id, items: items.map((item, index) => ({
    media_id: item.media_id, added_at: item.added_at, votes: item.votes.length, voted: item.votes.includes(person.id),
    added_by: item.added_by ? db.select({ displayName: people.displayName }).from(people).where(eq(people.id, item.added_by)).get()?.displayName ?? null : null,
    top: index === 0,
  })) };
}

export function addPick(person: PersonRow, mediaId: string) {
  if (!mediaId || !viewable(person, mediaId)) return gone();
  // Family Picks is a shared screen list: an adult-only or explicit clip never enters it, even when an adult asks.
  const item = readableItem(person, mediaId);
  if (item && (item.band_ok === "adult" || item.advisory.explicit)) return gone();
  const collection = familyCollection(person);
  const existing = collection.items.find((item) => item.media_id === mediaId) as Pick | undefined;
  if (existing) return { ok: true as const, value: { collection_id: collection.id, media_id: mediaId } };
  const items = [...collection.items, { media_id: mediaId, added_at: new Date().toISOString(), position: collection.items.length, status: null, votes: [], added_by: person.id } as Pick];
  setItems(collection, items);
  return { ok: true as const, value: { collection_id: collection.id, media_id: mediaId } };
}

export function togglePickVote(person: PersonRow, mediaId: string) {
  const collection = familyCollection(person);
  const item = collection.items.find((entry) => entry.media_id === mediaId) as Pick | undefined;
  if (!item || !viewable(person, mediaId)) return gone();
  const votes = item.votes.includes(person.id) ? item.votes.filter((id) => id !== person.id) : [...item.votes, person.id];
  setItems(collection, collection.items.map((entry) => entry.media_id === mediaId ? { ...item, votes } : entry) as Pick[]);
  return { ok: true as const, value: { media_id: mediaId, voted: votes.includes(person.id) } };
}

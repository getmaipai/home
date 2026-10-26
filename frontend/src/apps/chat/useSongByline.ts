// The props for the kit creation header in its byline form, under a chat song card: who made the song, when, and the
// Private/Shared chip. It reads the song's Library file the same way the Library viewer does (same query keys), and
// returns null until the song is done and its file is known, or when any of those reads fails.
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api, type LibraryItem, type Roster } from "@/lib/api";
import type { MusicCard } from "@/lib/musicApi";
import { creationOf } from "@/shell/library/libraryModel";

const SOMEONE = "Someone in your home";

export function useSongByline(card: MusicCard, me: Roster | null) {
  const navigate = useNavigate();
  const fileId = card.state === "done" ? (card.current_id ?? card.versions.at(-1)?.id) : undefined;
  const record = useQuery({ queryKey: ["library-file", fileId], queryFn: () => api.libraryFile(fileId!), enabled: me !== null && fileId !== undefined });
  const mine = me !== null && record.data?.owner_person_id === me.id;
  const shares = useQuery({ queryKey: ["file-shares", fileId], queryFn: () => api.fileShares(fileId!), enabled: me !== null && fileId !== undefined && mine });
  const shareList = shares.data ?? [];
  const named = shareList.filter((share) => share.to !== "household");
  const people = useQuery({ queryKey: ["people"], queryFn: () => api.people(), enabled: me !== null && record.data !== undefined && (!mine || named.length > 0) });
  if (me === null || fileId === undefined || !record.data) return null;
  if (!mine && !people.data) return null;
  const file = record.data;
  const ownerName = mine ? me.display_name : (people.data?.find((person) => person.id === file.owner_person_id)?.display_name ?? SOMEONE);
  const sharedWith = named.map((share) => ({ id: share.to, name: people.data?.find((person) => person.id === share.to)?.display_name ?? SOMEONE }));
  const seeds: Record<string, string> = Object.fromEntries((people.data ?? []).map((person) => [person.id, person.avatar_seed]));
  seeds[me.id] ??= me.avatar_seed;
  // The file record carries no owner name or sharing counts, so the Library list's item shape is rebuilt from what the
  // file and its shares say. A person who can read a song they do not own only reaches it through a share.
  const item: LibraryItem = {
    id: file.id, kind: file.kind === "other" ? "file" : file.kind, name: file.name ?? "", media_type: file.media_type, size_bytes: file.size, created_at: file.created_at,
    owner: { id: file.owner_person_id, display_name: ownerName },
    shared_with: mine ? { count: shareList.length, household: shareList.some((share) => share.to === "household") } : { count: 1, household: false },
    retention: file.retention, chat_id: null, can_edit: false, audience: null, duration_seconds: null, thumb_url: "", expires_at: null, version_count: 1,
  };
  const creation = creationOf(item, me, sharedWith);
  return {
    creator: { name: creation.creator.name, href: creation.creator.href, avatarSeed: seeds[file.owner_person_id] ?? null },
    madeAt: creation.madeAt,
    visibility: { mode: creation.mode, people: creation.people, canManage: creation.canManage, onOpen: () => navigate(`/files?file=${encodeURIComponent(fileId)}`) },
  };
}

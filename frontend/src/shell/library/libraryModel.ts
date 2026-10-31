// The Library page's pure rules: sections, the address that remembers the view, and how an item reads in words.
import type { LibraryItem, LibraryQuery, Roster } from "@/lib/api";
import type { FileKind } from "@maipai/ui/src/primitives/FileTile";
import { formatBytes } from "@maipai/ui/src/format";

export type SectionId = "all" | "pictures" | "videos" | "songs" | "documents" | "shared-with-me" | "shared-by-me" | "only-me" | "trash";
export interface Section { id: SectionId; label: string; icon: string; query: Pick<LibraryQuery, "type" | "shared"> }
/** One list feeds the left column, the phone chip row and the address. No folders: a section is a filter. */
export const SECTIONS: readonly Section[] = [
  { id: "all", label: "All files", icon: "folder", query: {} },
  { id: "pictures", label: "Pictures", icon: "camera", query: { type: "image" } },
  { id: "videos", label: "Videos", icon: "film", query: { type: "video" } },
  { id: "songs", label: "Songs", icon: "music", query: { type: "audio" } },
  { id: "documents", label: "Documents", icon: "file-text", query: { type: "document" } },
  { id: "shared-with-me", label: "Shared with me", icon: "users", query: { shared: "with-me" } },
  { id: "shared-by-me", label: "Shared by me", icon: "arrow-up-right", query: { shared: "by-me" } },
  { id: "only-me", label: "Only me", icon: "lock", query: { shared: "none" } },
  { id: "trash", label: "Trash", icon: "trash", query: {} },
];
export const sectionOf = (id: SectionId): Section => SECTIONS.find((section) => section.id === id)!;

export type OwnerFilter = "any" | "mine";
export type SortId = "newest" | "oldest" | "name" | "size";
export const SORT_LABELS: Record<SortId, string> = { newest: "Newest", oldest: "Oldest", name: "Name", size: "Largest" };
export interface LibraryView { section: SectionId; filter: OwnerFilter; q: string; sort: SortId; layout: "grid" | "list"; file: string | null }

const SORTS = new Set<string>(["newest", "oldest", "name", "size"]);
/** Mine narrows to the caller's own files, so it cannot join Shared with me or Trash. */
export function filterAllowed(section: SectionId, filter: OwnerFilter): boolean {
  return filter === "any" || (section !== "trash" && section !== "shared-with-me");
}
export function parseView(params: URLSearchParams): LibraryView {
  let section = SECTIONS.find((entry) => entry.id === params.get("section"))?.id ?? "all";
  const rawFilter = params.get("filter");
  // An older link used "Only me" as a filter; it is a section now.
  if (rawFilter === "only-me" && section === "all") section = "only-me";
  const wanted: OwnerFilter = rawFilter === "mine" ? "mine" : "any";
  const sortParam = params.get("sort");
  // Home's "Recently made" shelf links with sort=new.
  const sort = sortParam === "new" ? "newest" : SORTS.has(sortParam ?? "") ? (sortParam as SortId) : "newest";
  return { section, filter: filterAllowed(section, wanted) ? wanted : "any", q: params.get("q") ?? "", sort, layout: params.get("view") === "list" ? "list" : "grid", file: params.get("file") || null };
}
/** Defaults are left out so a link stays short. */
export function viewParams(view: LibraryView): URLSearchParams {
  const params = new URLSearchParams();
  if (view.section !== "all") params.set("section", view.section);
  if (view.filter !== "any") params.set("filter", view.filter);
  if (view.q.trim()) params.set("q", view.q);
  if (view.sort !== "newest") params.set("sort", view.sort);
  if (view.layout === "list") params.set("view", "list");
  if (view.file) params.set("file", view.file);
  return params;
}
/** The filters the hub's listing and summary accept (no paging). */
export function queryOf(view: LibraryView): LibraryQuery {
  const query: LibraryQuery = { ...sectionOf(view.section).query, sort: view.sort };
  if (view.filter === "mine") query.owner = "me";
  if (view.q.trim()) query.search = view.q.trim();
  return query;
}
export const filtersOf = (query: LibraryQuery): LibraryQuery => {
  const filters = { ...query };
  delete filters.sort; delete filters.cursor; delete filters.limit;
  return filters;
};

export function fileKind(kind: LibraryItem["kind"] | string): FileKind {
  return kind === "image" || kind === "video" || kind === "audio" || kind === "document" ? kind : "other";
}
const KIND_WORDS: Record<FileKind, string> = { image: "Picture", video: "Video", audio: "Song", document: "Document", other: "File" };
export const kindWord = (kind: LibraryItem["kind"] | string): string => KIND_WORDS[fileKind(kind)];
export function extensionOf(item: Pick<LibraryItem, "name" | "media_type">): string | undefined {
  const fromName = /\.([A-Za-z0-9]{1,5})$/.exec(item.name)?.[1];
  if (fromName) return fromName.toUpperCase();
  const sub = item.media_type.split("/")[1]?.split(/[+;]/)[0];
  return sub && sub.length <= 5 ? sub.toUpperCase() : undefined;
}
export const hasThumbnail = (item: Pick<LibraryItem, "kind">): boolean => item.kind === "image" || item.kind === "video" || item.kind === "audio";

export const ownerName = (item: LibraryItem, me: Pick<Roster, "id">): string => (item.owner.id === me.id ? "You" : item.owner.display_name);
/** The creation header: who made the file, when, and who it is shared with. `seeds` maps a person id to their avatar seed. */
export function creationOf(item: LibraryItem, me: Pick<Roster, "id">, sharedWith: Array<{ id: string; name: string }>, seeds: Record<string, string> = {}): { title: string; creator: { name: string; href: string; avatarSeed?: string }; madeAt: string; mode: "private" | "shared"; people: Array<{ id: string; name: string; avatarSeed?: string }>; canManage: boolean } {
  const household = item.shared_with.household;
  const ownerSeed = seeds[item.owner.id];
  const withSeed = (person: { id: string; name: string }): { id: string; name: string; avatarSeed?: string } => {
    const seed = person.id === "household" ? undefined : seeds[person.id];
    return seed !== undefined ? { ...person, avatarSeed: seed } : person;
  };
  return {
    title: item.name,
    creator: { name: item.owner.display_name, href: `/people/${encodeURIComponent(item.owner.id)}`, ...(ownerSeed !== undefined ? { avatarSeed: ownerSeed } : {}) },
    madeAt: item.created_at,
    mode: household || item.shared_with.count > 0 ? "shared" : "private",
    people: household ? [{ id: "household", name: "Everyone in the home" }] : sharedWith.map(withSeed),
    canManage: item.owner.id === me.id,
  };
}
const megabytes = (bytes: number) => formatBytes(bytes);
/** "You, 1.2 MB" for the tile's second line. */
export function secondaryLine(item: LibraryItem, me: Pick<Roster, "id">, now = Date.now()): string {
  const parts = [ownerName(item, me), megabytes(item.size_bytes)];
  if (item.expires_at) {
    const days = Math.max(0, Math.ceil((Date.parse(item.expires_at) - now) / 86_400_000));
    parts.push(days === 0 ? "Removed soon" : `Removed in ${days} ${days === 1 ? "day" : "days"}`);
  }
  return parts.join(" · ");
}
/** The same facts as spoken words. */
export function spokenDetail(item: LibraryItem, me: Pick<Roster, "id">): string {
  const parts = [`${megabytes(item.size_bytes)}`];
  if (item.owner.id !== me.id) parts.push(`from ${item.owner.display_name}`);
  if (item.shared_with.household) parts.push("shared with everyone in the home");
  else if (item.shared_with.count > 0) parts.push(`shared with ${item.shared_with.count} ${item.shared_with.count === 1 ? "person" : "people"}`);
  if (item.audience === "adult-only") parts.push("adults only");
  if (item.version_count > 1) parts.push(`${item.version_count} versions`);
  return parts.join(", ");
}
export const daysLeft = (until: string | null, now = Date.now()): number | null => until === null ? null : Math.max(0, Math.ceil((Date.parse(until) - now) / 86_400_000));

/** Roles that may add and share. A child asks a grown-up; the hub refuses too. */
export const canAddFiles = (person: Pick<Roster, "role">): boolean => person.role !== "child" && person.role !== "guest";
export const canShareFiles = canAddFiles;
/** Who may be offered "Mark all-ages": an adult who owns the picture. The hub decides again. */
export const isAdultRole = (person: Pick<Roster, "role">): boolean => person.role === "owner" || person.role === "admin" || person.role === "adult";

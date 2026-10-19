// The full-screen viewer over the current list: previous and next, zoom, the player for video and songs, an info panel
// and the person's actions. The page owns the address (`?file=<id>`), so Back closes it and a link opens it after the hub's
// access check.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { MediaViewer, type MediaViewerItem } from "@maipai/ui/src/elements/media-viewer";
import { Button } from "@maipai/ui/src/ui/button";
import { formatBytes } from "@maipai/ui/src/format";
import { getIcon } from "@maipai/ui/src/icons";
import { api, type LibraryItem, type Roster } from "@/lib/api";
import { prepareClip, saveClip, shareClip } from "@/lib/shareClip";
import { canShareFiles, fileKind, isAdultRole, kindWord, ownerName } from "./libraryModel";
import type { ItemActions } from "./LibraryItems";

const ShareIcon = getIcon("users");
const SendIcon = getIcon("arrow-up-right");
const DownloadIcon = getIcon("download");
const TrashIcon = getIcon("trash");
const SEND_PREPARE_MAX_BYTES = 64 * 1024 * 1024;
const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

export function viewerItemOf(item: LibraryItem): MediaViewerItem {
  const kind = fileKind(item.kind);
  return {
    id: item.id, kind, name: item.name, mediaType: item.media_type,
    url: api.fileContentUrl(item.id),
    posterUrl: kind === "video" || kind === "audio" ? item.thumb_url.replace("w=320", "w=640") : null,
  };
}

function howItWasMade(origin: string | undefined, item: LibraryItem): string {
  if (origin === "made") return item.chat_id ? "Made by Home in a chat." : "Made by Home. The chat it came from was deleted.";
  if (item.chat_id) return "Sent in a chat.";
  return "Added to the Library.";
}

function Details({ item, me, actions }: { item: LibraryItem; me: Roster; actions: ItemActions }) {
  const mine = item.owner.id === me.id;
  const record = useQuery({ queryKey: ["library-file", item.id], queryFn: () => api.libraryFile(item.id) });
  const shares = useQuery({ queryKey: ["file-shares", item.id], queryFn: () => api.fileShares(item.id), enabled: mine && item.shared_with.count > 0 });
  const people = useQuery({ queryKey: ["people"], queryFn: () => api.people(), enabled: mine && item.shared_with.count > 0 && !item.shared_with.household });
  const names = (shares.data ?? []).map((share) => share.to === "household" ? "Everyone in the home" : people.data?.find((person) => person.id === share.to)?.display_name ?? "Someone in your home");
  const who = item.shared_with.household ? "Everyone in the home can see this." : !mine ? `${item.owner.display_name} shared this with you.` : item.shared_with.count === 0 ? "Only you." : names.length > 0 ? names.join(", ") : `${item.shared_with.count} ${item.shared_with.count === 1 ? "person" : "people"} in your home.`;
  const kept = item.retention === "kept";
  const row = (label: string, value: string) => <div><dt className="text-muted-foreground">{label}</dt><dd>{value}</dd></div>;
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid gap-3 text-base">
        {row("Name", item.name)}
        {row("Type", `${kindWord(item.kind)}, ${item.media_type}`)}
        {row("Size", formatBytes(item.size_bytes))}
        {row("Added", date(item.created_at))}
        {row("Owner", ownerName(item, me))}
        {row("How it was made", howItWasMade(record.data?.origin, item))}
        {row("Who can see it", who)}
        {row("Keeping", kept ? "Kept until you delete it." : item.expires_at ? `Home plans to remove this on ${date(item.expires_at)} to make room. Keep it to stop that.` : "Follows your storage rules. Keep it to stop automatic removal.")}
        {item.version_count > 1 ? row("Versions", `${item.version_count} versions. The newest one shows.`) : null}
        {item.audience === "adult-only" ? row("Audience", "Adults only. Teens and children never see this picture.") : null}
      </dl>
      {mine ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => actions.rename(item)}>Rename</Button>
          {!kept ? <Button type="button" variant="secondary" onClick={() => actions.keep(item)}>Keep</Button> : null}
          {isAdultRole(me) && item.kind === "image" && item.audience === "adult-only" ? <Button type="button" variant="secondary" onClick={() => actions.recheck(item)}>Mark all-ages</Button> : null}
        </div>
      ) : null}
      {item.can_edit && item.chat_id ? <Button asChild variant="secondary"><Link to={`/chat?conversation=${encodeURIComponent(item.chat_id)}`}>Edit in its chat</Link></Button> : mine && item.kind === "image" && !item.chat_id && record.data?.origin === "made" ? <p className="text-muted-foreground text-base">Its chat was deleted, so it cannot be edited here.</p> : null}
    </div>
  );
}

export function LibraryViewer({ items, me, currentId, onCurrentIdChange, onClose, actions, phone }: { phone: boolean; items: readonly LibraryItem[]; me: Roster; currentId: string | null; onCurrentIdChange: (id: string) => void; onClose: () => void; actions: ItemActions }) {
  const viewerItems = useMemo(() => items.map(viewerItemOf), [items]);
  const open = currentId !== null && items.some((item) => item.id === currentId);
  const current = items.find((item) => item.id === currentId);
  const sendable = current !== undefined && canShareFiles(me) && current.size_bytes <= SEND_PREPARE_MAX_BYTES;
  const prepared = useQuery({
    queryKey: ["library-prepared", current?.id],
    queryFn: ({ signal }) => prepareClip(api.fileContentUrl(current!.id), signal, { type: current!.media_type, name: current!.name }),
    enabled: open && sendable, staleTime: Infinity, gcTime: 60_000, retry: false,
  });
  if (!open || !current) return null;
  return (
    <>
    <MediaViewer
      open
      onOpenChange={() => {}}
      onClose={onClose}
      items={viewerItems}
      currentId={currentId}
      onCurrentIdChange={onCurrentIdChange}
      details={(viewing) => { const item = items.find((entry) => entry.id === viewing.id); return item ? <Details item={item} me={me} actions={actions} /> : null; }}
      toolbar={(viewing) => {
        const item = items.find((entry) => entry.id === viewing.id);
        if (!item) return null;
        const mine = item.owner.id === me.id;
        return (
          <>
            {mine && canShareFiles(me) ? <Button type="button" variant="secondary" size={phone ? "icon" : "default"} aria-label="Share" onClick={() => actions.share(item)}>{phone ? <ShareIcon aria-hidden /> : "Share"}</Button> : null}
            {canShareFiles(me) ? <Button type="button" variant="secondary" size={phone ? "icon" : "default"} aria-label="Send" onClick={() => { void shareClip({ prepared: prepared.data, title: item.name, nav: navigator, fallback: () => saveClip({ url: api.fileContentUrl(item.id), name: item.name, ...(prepared.data ? { blob: prepared.data.blob } : {}) }) }); }}>{phone ? <SendIcon aria-hidden /> : "Send"}</Button> : null}
            <Button asChild variant="secondary" size={phone ? "icon" : "default"}><a href={api.fileContentUrl(item.id)} download={item.name} aria-label="Download">{phone ? <DownloadIcon aria-hidden /> : "Download"}</a></Button>
            {mine ? <Button type="button" variant="destructive" size={phone ? "icon" : "default"} aria-label="Delete" onClick={() => actions.trash(item)}>{phone ? <TrashIcon aria-hidden /> : "Delete"}</Button> : null}
          </>
        );
      }}
      returnFocusTo={() => Array.from(document.querySelectorAll<HTMLElement>("[data-file-id]")).find((cell) => cell.dataset.fileId === currentId)?.querySelector<HTMLElement>('[data-slot="file-tile-main"]')}
    />
    </>
  );
}

// The full-screen viewer over the current list: previous and next, zoom, the player for video and songs, an info panel
// and the person's actions. The page owns the address (`?file=<id>`), so Back closes it and a link opens it after the hub's
// access check.
import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { CreationHeader } from "@maipai/ui/src/elements/creation-header";
import { MediaViewer, type MediaViewerItem } from "@maipai/ui/src/elements/media-viewer";
import { MusicTrack } from "@maipai/ui/src/elements/music-track";
import { SharePanel } from "@maipai/ui/src/elements/share-panel";
import { Button } from "@maipai/ui/src/ui/button";
import { formatBytes } from "@maipai/ui/src/format";
import { getIcon } from "@maipai/ui/src/icons";
import { api, type LibraryItem, type Roster } from "@/lib/api";
import { musicApi, type MusicCard } from "@/lib/musicApi";
import { useMusicTrackProps } from "@/apps/chat/MusicCardView";
import { prepareClip, saveClip, shareClip } from "@/lib/shareClip";
import { canShareFiles, creationOf, fileKind, isAdultRole, kindWord } from "./libraryModel";
import { libraryOrigin } from "./libraryOrigin";
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

function Details({ item, me, actions }: { item: LibraryItem; me: Roster; actions: ItemActions }) {
  const mine = item.owner.id === me.id;
  const record = useQuery({ queryKey: ["library-file", item.id], queryFn: () => api.libraryFile(item.id) });
  const shares = useQuery({ queryKey: ["file-shares", item.id], queryFn: () => api.fileShares(item.id), enabled: mine && item.shared_with.count > 0 });
  const people = useQuery({ queryKey: ["people"], queryFn: () => api.people(), enabled: true });
  const sharedWith = (shares.data ?? []).filter((share) => share.to !== "household").map((share) => ({ id: share.to, name: people.data?.find((person) => person.id === share.to)?.display_name ?? "Someone in your home" }));
  const seeds: Record<string, string> = Object.fromEntries((people.data ?? []).map((person) => [person.id, person.avatar_seed]));
  seeds[me.id] ??= me.avatar_seed;
  const creation = creationOf(item, me, sharedWith, seeds);
  const [panelOpen, setPanelOpen] = useState(false);
  const navigate = useNavigate();
  const [splitting, setSplitting] = useState(false);
  const kept = item.retention === "kept";
  const row = (label: string, value: ReactNode) => <div><dt className="text-muted-foreground">{label}</dt><dd>{value}</dd></div>;
  const origin = libraryOrigin(item, record.data?.origin);
  const song = record.data?.music;
  const songCard: MusicCard = song ? {
    id: song.id, task: "text2music", state: "done", stage: "ready", stage_label: "", stages: [{ id: "queued", label: "Queued" }, { id: "model", label: "Loading" }, { id: "planning", label: "Planning" }, { id: "making", label: "Making" }, { id: "mixing", label: "Mixing" }, { id: "finishing", label: "Finishing" }], stage_index: 5, progress: 1, eta_seconds: null, position: null, error_line: null,
    cover_url: song.cover_url, cover_versions: [], cover_pending: false, versions: song.versions, current_id: song.current_id,
    length: "full", cut: null, max_seconds: null, title: song.title, description: song.description, lyrics: song.lyrics,
    timed_lyrics: song.timed_lyrics, duration_s: item.duration_seconds, started_at: Date.parse(item.created_at),
  } : { id: "", task: "text2music", state: "queued", stage: null, stage_label: "", stages: [{ id: "queued", label: "Queued" }, { id: "model", label: "Loading" }, { id: "planning", label: "Planning" }, { id: "making", label: "Making" }, { id: "mixing", label: "Mixing" }, { id: "finishing", label: "Finishing" }], stage_index: 0, progress: 0, eta_seconds: null, position: null, error_line: null, cover_url: null, cover_versions: [], cover_pending: false, versions: [], current_id: null, length: "full", cut: null, max_seconds: null, title: null, description: null, lyrics: null, timed_lyrics: null, duration_s: null, started_at: 0 };
  const songTrackProps = useMusicTrackProps({ card: songCard, owner: song?.owner ?? false, onRefresh: () => { void record.refetch(); } });
  return (
    <>
      {song ? <MusicTrack {...songTrackProps} /> : null}
      <CreationHeader title={creation.title} creator={{ ...creation.creator }} madeAt={creation.madeAt} headingLevel="h2" visibility={{ mode: creation.mode, people: creation.people, canManage: creation.canManage, onOpen: () => { if (creation.canManage) actions.share(item); else setPanelOpen(true); } }} />
      <SharePanel open={panelOpen} onOpenChange={setPanelOpen} people={creation.people} candidates={[]} canManage={false} onAdd={() => {}} onRemove={() => {}} onMakePrivate={() => {}} />
      <div className="flex flex-col gap-4">
      <dl className="grid gap-3 pt-4 text-base">
        {row("Type", `${kindWord(item.kind)}, ${item.media_type}`)}
        {row("Size", formatBytes(item.size_bytes))}
        {row("Origin", origin.href ? <Link className="text-primary underline-offset-4 hover:underline" to={origin.href}>{origin.label}</Link> : origin.label)}
        {row("Keeping", kept ? "Kept until you delete it." : item.expires_at ? `Home plans to remove this on ${date(item.expires_at)} to make room. Keep it to stop that.` : "Follows your storage rules. Keep it to stop automatic removal.")}
        {item.version_count > 1 ? row("Versions", `${item.version_count} versions. The newest one shows.`) : null}
        {item.audience === "adult-only" ? row("Audience", "Adults only. Teens and children never see this picture.") : null}
      </dl>
      {mine ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => actions.rename(item)}>Rename</Button>
          {!kept ? <Button type="button" variant="secondary" onClick={() => actions.keep(item)}>Keep</Button> : null}
          {isAdultRole(me) && item.kind === "audio" && !record.data?.music ? <Button type="button" variant="secondary" disabled={splitting} onClick={() => { setSplitting(true); void musicApi.stemsFromFile(item.id).then((card) => { if (card.conversation_id) navigate(`/chat?conversation=${encodeURIComponent(card.conversation_id)}`); }).catch((error: unknown) => toast.error(error instanceof Error ? error.message : "The stems could not be made. Try again in a minute.")).finally(() => setSplitting(false)); }}>Split into stems</Button> : null}
          {isAdultRole(me) && item.kind === "image" && item.audience === "adult-only" ? <Button type="button" variant="secondary" onClick={() => actions.recheck(item)}>Mark all-ages</Button> : null}
        </div>
      ) : null}
      {mine && isAdultRole(me) && item.kind === "audio" && !record.data?.music ? <p className="text-sm text-muted-foreground">Stems stay on this home server. Splitting does not make a voice.</p> : null}
      {item.can_edit && item.chat_id ? <Button asChild variant="secondary"><Link to={`/chat?conversation=${encodeURIComponent(item.chat_id)}`}>Edit in its chat</Link></Button> : mine && item.kind === "image" && !item.chat_id && record.data?.origin === "made" ? <p className="text-muted-foreground text-base">Its chat was deleted, so it cannot be edited here.</p> : null}
      </div>
    </>
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

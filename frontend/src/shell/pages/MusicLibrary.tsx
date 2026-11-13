// MP-U2 and MP-U3: Your songs as a list in ace-step-ui's Suno style, built from Home's kit. A row per song (cover that plays on hover or
// focus, title, style line, length, take strip, share, a More menu); search and filter chips above; the details panel beside it on a wide
// screen and as a sheet on a phone. Songs, takes and sounds come from the same routes as chat (one card per song, takes inside it);
// every slow action runs as a job and shows in Activity. The locked tile the hub sends for a locked song is never opened or read.
import { i18n } from "@lingui/core";
import { useMemo, useState, useSyncExternalStore, type CSSProperties } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { StudioPickerBody } from "@/shell/MediaPickerDialog";
import { Badge } from "@maipai/ui/src/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@maipai/ui/src/ui/dropdown-menu";
import { Input } from "@maipai/ui/src/ui/input";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@maipai/ui/src/ui/drawer";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@maipai/ui/src/ui/dialog";
import { SplitView } from "@maipai/ui/src/primitives/SplitView";
import { StatusCard } from "@maipai/ui/src/elements/status-card";
import { Skeleton } from "@maipai/ui/src/ui/skeleton";
import { Cover } from "@maipai/ui/src/ui/media-tiles";
import { Chip } from "@maipai/ui/src/primitives/Chip";
import { EmptyState } from "@maipai/ui/src/primitives/EmptyState";
import { useToast } from "@maipai/ui/src/primitives/Toast";
import { getIcon } from "@maipai/ui/src/icons";
import { api, requestJson } from "@/lib/api";
import { errorLine } from "@/lib/hubReachability";
import { musicApi, type MusicCard, type MusicVersion, type SavedSound } from "@/lib/musicApi";
import { likeThisMessage } from "./MusicLikeThisPage";
import { remixAddress, stemsAddress, studioAddress } from "./musicAddresses";
import { songStatusCard } from "./musicSongStatus";
import { clockOf, isLockedTile, isMaking, libraryRows, playableVersion, queueOf, styleTags, takeStrip, trackOf, type LibraryFilter, type LibraryRow } from "./musicLibraryModel";
import { SongDetails, useBedPicker } from "./MusicSongDetails";
import { useMusicPlayer, type MusicPlayer } from "@/shell/music/musicPlayer";
import type { Track } from "@/shell/music/musicQueue";

const WIDE = "(min-width: 960px)";
const subscribeWide = (onChange: () => void) => { const list = window.matchMedia?.(WIDE); list?.addEventListener?.("change", onChange); return () => list?.removeEventListener?.("change", onChange); };
/** True from the kit's desktop width (960 px): the details sit beside the list. Below it they open as a sheet. */
export function useWide(): boolean { return useSyncExternalStore(subscribeWide, () => !!window.matchMedia?.(WIDE).matches, () => false); }

const icon = (name: string, className?: string) => { const One = getIcon(name); return <One aria-hidden="true" {...(className ? { className } : {})} />; };

function useSongList() {
  return useQuery({ queryKey: ["music-songs"], queryFn: () => requestJson<MusicCard[]>("/api/music/jobs"), staleTime: 2_000,
    refetchInterval: (query) => (query.state.data?.some((card) => !isLockedTile(card) && isMaking(card)) ? 3000 : 20_000) });
}

interface RowActions {
  onOpen: (card: MusicCard) => void;
  onVideo: (version: MusicVersion) => void;
  onLikeThis: (card: MusicCard) => void;
  onDelete: (card: MusicCard) => void;
  onShare: (version: MusicVersion) => void;
}

/** One finished song as a row: the cover plays on hover or focus, the text opens the details, the take strip plays a take. */
function SongRow({ card, selected, player, queue, take, onTake, actions }: { card: MusicCard; selected: boolean; player: MusicPlayer; queue: readonly Track[]; take: string | null; onTake: (id: string) => void; actions: RowActions }) {
  const title = card.title ?? i18n._({ id: "Untitled song", message: "Untitled song" });
  const version = playableVersion(card, take);
  const strip = takeStrip(card);
  const here = !!version && player.track?.key === version.id;
  const playing = here && player.playing;
  const Play = getIcon(playing ? "pause" : "play");
  const tags = styleTags(card.description, 4);
  const length = clockOf(card.duration_s);
  const playTake = (takeId: string | null) => { const one = trackOf(card, takeId, i18n._({ id: "Untitled song", message: "Untitled song" })); if (one) player.toggle(one, queue); };
  const play = () => playTake(version?.id ?? null);
  return <li data-testid="music-song-row" data-selected={selected ? "true" : undefined} className={`group relative flex items-start gap-3 rounded-xl p-2 transition-colors ${selected ? "bg-muted ring-border ring-1" : "hover:bg-muted/60"}`}>
    <div className="relative size-16 shrink-0 overflow-hidden rounded-lg sm:size-20">
      <Cover id={card.id} title={title} url={card.cover_url} bare />
      <button type="button" onClick={play} aria-label={playing ? i18n._({ id: "Pause {title}", message: "Pause {title}", values: { title } }) : i18n._({ id: "Play {title}", message: "Play {title}", values: { title } })} aria-pressed={playing}
        className={`bg-background/40 absolute inset-0 flex items-center justify-center transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 ${here ? "opacity-100" : "opacity-0"}`}>
        <span className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-full shadow-md"><Play aria-hidden="true" className="size-4" /></span>
      </button>
    </div>
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <button type="button" onClick={() => actions.onOpen(card)} aria-label={i18n._({ id: "Open {title}", message: "Open {title}", values: { title } })} aria-current={selected ? "true" : undefined} className="flex min-w-0 flex-col gap-1 text-left">
        <span className="flex min-w-0 items-center gap-2">
          <span className={`truncate text-body font-semibold ${here ? "text-primary" : ""}`}>{title}</span>
          {card.length === "full" ? <Badge variant="secondary">{i18n._({ id: "Full", message: "Full" })}</Badge> : null}
          {strip.length ? <Badge variant="outline">{i18n._({ id: "{count} takes", message: "{count} takes", values: { count: strip.length } })}</Badge> : null}
        </span>
        {tags.length ? <span className="text-muted-foreground line-clamp-2 text-badge">{tags.join(", ")}</span> : null}
      </button>
      {strip.length ? <div className="flex flex-wrap gap-1" role="group" aria-label={i18n._({ id: "Takes of {title}", message: "Takes of {title}", values: { title } })}>
        {strip.map((one) => <Chip key={one.id} tone="quiet" size="strip" selected={version?.id === one.id} onClick={() => { onTake(one.id); playTake(one.id); }}>{i18n._({ id: "Take {number}", message: "Take {number}", values: { number: one.number } })}</Chip>)}
      </div> : null}
    </div>
    <div className="flex shrink-0 flex-col items-end gap-1">
      {length ? <span className="text-muted-foreground font-mono text-badge tabular-nums">{length}</span> : null}
      <div className="flex items-center">
        <Button type="button" variant="ghost" size="icon-sm" aria-label={i18n._({ id: "Share {title}", message: "Share {title}", values: { title } })} disabled={!version} onClick={() => { if (version) actions.onShare(version); }}>{icon("share")}</Button>
        <DropdownMenu>
            <DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon-sm" aria-label={i18n._({ id: "More about {title}", message: "More about {title}", values: { title } })}>{icon("more-horizontal")}</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild><Link to={studioAddress(card.id)}>{icon("sliders-horizontal")}{i18n._({ id: "Open in Studio", message: "Open in Studio" })}</Link></DropdownMenuItem>
              <DropdownMenuItem asChild><Link to={remixAddress(card.id)}>{icon("shuffle")}{i18n._({ id: "Remix", message: "Remix" })}</Link></DropdownMenuItem>
              <DropdownMenuItem asChild><Link to={stemsAddress(card.id)}>{icon("layers")}{i18n._({ id: "Extract stems", message: "Extract stems" })}</Link></DropdownMenuItem>
              <DropdownMenuItem disabled={!version} onSelect={() => { if (version) actions.onVideo(version); }}>{icon("film")}{i18n._({ id: "Use in a video", message: "Use in a video" })}</DropdownMenuItem>
              {version ? <DropdownMenuItem asChild><a href={version.url} download>{icon("download")}{i18n._({ id: "Download", message: "Download" })}</a></DropdownMenuItem> : <DropdownMenuItem disabled>{icon("download")}{i18n._({ id: "Download", message: "Download" })}</DropdownMenuItem>}
              <DropdownMenuItem onSelect={() => actions.onLikeThis(card)}>{icon("repeat")}{i18n._({ id: "Make another like this", message: "Make another like this" })}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => actions.onDelete(card)}>{icon("trash")}{i18n._({ id: "Delete song", message: "Delete song" })}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
      </div>
    </div>
  </li>;
}

/** A saved sound as a row: it plays (and loops, if it was made to), and can be laid into a song. */
function SoundRow({ sound, player, onAdd }: { sound: SavedSound; player: MusicPlayer; onAdd: (jobId: string) => void }) {
  const here = player.track?.key === `sound-${sound.id}`; const playing = here && player.playing;
  const Play = getIcon(playing ? "pause" : "play");
  return <li data-testid="music-sound-row" className="group relative flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-muted/60">
    <div className="relative size-16 shrink-0 overflow-hidden rounded-lg">
      <Cover id={sound.id} title={sound.title} url={null} bare />
      <button type="button" onClick={() => player.toggle({ key: `sound-${sound.id}`, url: sound.src, title: sound.title, loop: sound.loop })} aria-label={playing ? i18n._({ id: "Pause {title}", message: "Pause {title}", values: { title: sound.title } }) : i18n._({ id: "Play {title}", message: "Play {title}", values: { title: sound.title } })} aria-pressed={playing}
        className={`bg-background/40 absolute inset-0 flex items-center justify-center transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100 ${here ? "opacity-100" : "opacity-0"}`}>
        <span className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-full shadow-md"><Play aria-hidden="true" className="size-4" /></span>
      </button>
    </div>
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="flex min-w-0 items-center gap-2"><span className="truncate text-body font-semibold">{sound.title}</span><Badge variant="outline">{i18n._({ id: "Sound", message: "Sound" })}</Badge>{sound.loop ? <Badge variant="secondary">{i18n._({ id: "Loop", message: "Loop" })}</Badge> : null}</span>
    </div>
    <span className="text-muted-foreground font-mono text-badge tabular-nums">{clockOf(sound.duration_s)}</span>
    {sound.job_id ? <Button type="button" variant="ghost" size="sm" onClick={() => onAdd(sound.job_id!)}>{i18n._({ id: "Add to a song", message: "Add to a song" })}</Button> : null}
  </li>;
}

const FILTERS: () => Array<{ id: LibraryFilter; label: string }> = () => [
  { id: "all", label: i18n._({ id: "All", message: "All" }) }, { id: "songs", label: i18n._({ id: "Songs", message: "Songs" }) }, { id: "sounds", label: i18n._({ id: "Sounds", message: "Sounds" }) },
];

/** Your songs: toolbar, list and details. `selected` is the open song (the address's `song`); `onSelect` changes it. */
export function MusicLibrary({ selected, remix, onSelect, onAddSound, firstSteps }: { selected: string | null; remix: boolean; onSelect: (id: string | null) => void; onAddSound?: (jobId: string) => void; firstSteps?: string }) {
  const navigate = useNavigate();
  const { push } = useToast();
  const queryClient = useQueryClient();
  const wide = useWide();
  const player = useMusicPlayer();
  const list = useSongList();
  const sounds = useQuery({ queryKey: ["music-sounds"], queryFn: () => musicApi.listSounds(), staleTime: 2_000 });
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [takes, setTakes] = useState<Record<string, string>>({});
  const [video, setVideo] = useState<MusicVersion | null>(null);
  const cards = useMemo(() => list.data ?? [], [list.data]);
  const hasLocked = cards.some(isLockedTile);
  const rows = useMemo(() => libraryRows(cards, sounds.data ?? [], filter, query), [cards, sounds.data, filter, query]);
  const queue = useMemo(() => queueOf(rows, takes, i18n._({ id: "Untitled song", message: "Untitled song" })), [rows, takes]);

  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ["music-songs"] }); };
  const restore = (ids: string[]) => { void Promise.allSettled(ids.map((id) => api.restoreLibraryFile(id))).then((results) => { refresh(); push(results.every((r) => r.status === "fulfilled") ? i18n._({ id: "Brought your song back.", message: "Brought your song back." }) : i18n._({ id: "Some of the song could not be brought back. Open Trash in the Library to restore the rest.", message: "Some of the song could not be brought back. Open Trash in the Library to restore the rest." })); }); };
  const actions: RowActions = {
    onOpen: (card) => onSelect(card.id),
    onVideo: setVideo,
    onShare: (version) => navigate(`/files?file=${encodeURIComponent(version.id)}`),
    onLikeThis: (card) => navigate(`/chat?ask=${encodeURIComponent(likeThisMessage("song", card.current_id ?? card.id, styleTags(card.description, 3).join(", ").slice(0, 80)))}`),
    onDelete: (card) => {
      const ids = card.versions.map((version) => version.id); const title = card.title ?? i18n._({ id: "Untitled song", message: "Untitled song" });
      void musicApi.remove(card.id).then(() => {
        if (selected === card.id) onSelect(null);
        refresh();
        push(i18n._({ id: "Moved ‘{title}’ to Trash.", message: "Moved ‘{title}’ to Trash.", values: { title } }), ids.length ? { kind: "recovery", action: { label: i18n._({ id: "Undo", message: "Undo" }), onSelect: () => restore(ids) } } : undefined);
      }).catch((error: unknown) => push(errorLine(error, i18n._({ id: "That song could not be deleted. Try again.", message: "That song could not be deleted. Try again." }))));
    },
  };

  const rowsView = (row: LibraryRow) => row.kind === "sound"
    ? <SoundRow key={row.key} sound={row.sound} player={player} onAdd={(jobId) => onAddSound?.(jobId)} />
    : isMaking(row.card) || row.card.state === "failed" || row.card.state === "cancelled" ? songStatusCard({ card: row.card, onOpen: () => onSelect(row.card.id) })
      : <SongRow key={row.key} card={row.card} selected={row.card.id === selected} player={player} queue={queue} take={takes[row.card.id] ?? null} onTake={(id) => setTakes((current) => ({ ...current, [row.card.id]: id }))} actions={actions} />;

  const emptyText = query.trim() || filter !== "all"
    ? i18n._({ id: "No song matches that.", message: "No song matches that." })
    : (firstSteps ?? i18n._({ id: "No songs yet. Describe one in the bar above and press Generate. It shows up here.", message: "No songs yet. Describe one in the bar above and press Generate. It shows up here." }));
  const listBody = list.isPending ? <ul className="flex list-none flex-col gap-2 p-0" role="status" aria-label={i18n._({ id: "Loading your songs", message: "Loading your songs" })} data-testid="music-songs-loading">{[0, 1, 2, 3].map((n) => <li key={n}><Skeleton shape="row" /></li>)}</ul>
    : list.isError && !list.data ? <EmptyState icon="music" text={i18n._({ id: "Your songs could not be loaded. Check your connection and open this page again.", message: "Your songs could not be loaded. Check your connection and open this page again." })} actionLabel={i18n._({ id: "Try again", message: "Try again" })} onAction={() => void list.refetch()} />
      : rows.length === 0 && !hasLocked ? <EmptyState icon="music" text={emptyText} {...(query.trim() || filter !== "all" ? { actionLabel: i18n._({ id: "Clear the search", message: "Clear the search" }), onAction: () => { setQuery(""); setFilter("all"); } } : {})} />
        : <ul className="flex list-none flex-col gap-1 p-0" aria-label={i18n._({ id: "Your songs", message: "Your songs" })}>
          {hasLocked && filter !== "sounds" ? <li className="text-muted-foreground flex items-center gap-3 rounded-xl p-3 text-supporting" data-testid="music-locked-row">{icon("lock", "size-5")}{i18n._({ id: "Some of your songs are locked. Unlock them from the Library to see them here.", message: "Some of your songs are locked. Unlock them from the Library to see them here." })}</li> : null}
          {rows.map(rowsView)}
        </ul>;

  const details = selected ? <SongDetails key={selected} id={selected} player={player} remix={remix} {...(wide ? {} : { onClose: () => onSelect(null) })} onDelete={actions.onDelete} onLikeThis={actions.onLikeThis} onVideo={setVideo} /> : null;
  const picker = useBedPicker(video, () => setVideo(null));
  const mainColumn = (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-3">
        <Input type="search" aria-label={i18n._({ id: "Search your songs", message: "Search your songs" })} placeholder={i18n._({ id: "Search your songs", message: "Search your songs" })} value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
        <div className="no-scrollbar flex items-center gap-2 overflow-x-auto" role="group" aria-label={i18n._({ id: "Show", message: "Show" })}>
          {FILTERS().map((one) => <Chip key={one.id} selected={filter === one.id} onClick={() => setFilter(one.id)}>{one.label}</Chip>)}
        </div>
      </div>
      {listBody}
    </div>
  );
  return <div className="min-w-0" data-testid="music-library">
    {wide ? <SplitView main={mainColumn} aside={<aside aria-label={i18n._({ id: "Song details", message: "Song details" })} className="border-border sticky top-0 max-h-(--panel-max) min-w-0 self-start overflow-y-auto rounded-2xl border" style={{ "--panel-max": "calc(100dvh - 6rem)" } as CSSProperties} data-testid="music-details-panel">
      {details ?? <div className="p-4"><EmptyState icon="music" text={i18n._({ id: "Pick a song to see its words, takes and everything you can do with it.", message: "Pick a song to see its words, takes and everything you can do with it." })} /></div>}
    </aside>} asideWidth="wide" /> : mainColumn}
    {wide ? null : <Drawer open={!!selected} onOpenChange={(open) => { if (!open) onSelect(null); }}>
      <DrawerContent data-testid="music-details-sheet">
        <DrawerHeader><DrawerTitle>{i18n._({ id: "Song details", message: "Song details" })}</DrawerTitle><DrawerDescription>{i18n._({ id: "The song, its words and what you can do with it.", message: "The song, its words and what you can do with it." })}</DrawerDescription></DrawerHeader>
        <div className="overflow-y-auto">{details}</div>
      </DrawerContent>
    </Drawer>}
    {video ? <Dialog open onOpenChange={(open) => { if (!open) setVideo(null); }}><DialogContent>
      <DialogHeader><DialogTitle>{i18n._({ id: "Pick a video for this song", message: "Pick a video for this song" })}</DialogTitle><DialogDescription>{i18n._({ id: "The song goes under the video as a new version. Your first video is kept.", message: "The song goes under the video as a new version. Your first video is kept." })}</DialogDescription></DialogHeader>
      <StudioPickerBody kind="video" start="music" personId={picker.personId} onDone={(picked) => picker.add(picked?.id ?? null)} />
      {picker.problem ? <StatusCard kind="problem" title={i18n._({ id: "That did not work", message: "That did not work" })} line={picker.problem} /> : null}
    </DialogContent></Dialog> : null}
  </div>;
}

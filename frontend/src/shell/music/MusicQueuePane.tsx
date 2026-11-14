// SF-08c: the Music right pane. Queue and Recent are two tabs of the shell's one right pane (rule S2: nothing else draws right of the content);
// on a phone, or when the shell has no pane to give, the bar opens the same two tabs in a kit drawer. Queue shows the one in-browser queue
// (musicPlayer) as "Now playing", the Play next tier and the Next up tier; Recent shows the songs the person played lately (media_progress).
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@maipai/ui/src/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@maipai/ui/src/ui/drawer";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@maipai/ui/src/ui/dropdown-menu";
import { Skeleton } from "@maipai/ui/src/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@maipai/ui/src/ui/tabs";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { EmptyState } from "@maipai/ui/src/primitives/EmptyState";
import { SafeImage } from "@maipai/ui/src/primitives/SafeImage";
import { useToast } from "@maipai/ui/src/primitives/Toast";
import { getIcon } from "@maipai/ui/src/icons";
import { request } from "@/lib/api";
import { clock } from "@/shell/media/NowPlayingStage";
import { musicPlayer, useMusicPlayer } from "./musicPlayer";
import { paneModel, sourceLabelOf, type Track } from "./musicQueue";
import { saveQueueAsPlaylist } from "./musicQueueSave";
import { playedAgo, say } from "./MusicQueuePane.helpers";
import { musicPane, QUEUE_TAB, RECENT_TAB, type MusicPaneTab } from "./musicPane";

const icon = (name: string) => { const One = getIcon(name); return <One aria-hidden="true" />; };
interface RecentSong { id: string; title: string; subtitle: string | null; artwork_url: string | null; played_at: string; duration_s: number | null }

function Cover({ url }: { url?: string | null }) {
  return <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-muted text-muted-foreground">{url ? <SafeImage src={url} alt="" draggable={false} className="size-full object-cover" /> : icon("music")}</span>;
}

interface RowProps { track: Track; current?: boolean; tier?: "play-next" | "next-up"; first?: boolean; last?: boolean; dragKey: string | null; onDragKey: (key: string | null) => void }

/** One song in the queue. Next up and Play next rows drag, and every control also has a keyboard path (the row menu moves a song up or down). */
function QueueRow({ track, current, tier, first, last, dragKey, onDragKey }: RowProps) {
  const label = track.subtitle ? `${track.title}, ${track.subtitle}` : track.title;
  const editable = !!tier;
  const move = (up: boolean) => {
    const { queue, index } = musicPlayer.get();
    const upcoming = queue.slice(index + 1);
    const at = upcoming.findIndex((one) => one.key === track.key);
    const before = up ? upcoming[at - 1]?.key : upcoming[at + 2]?.key ?? null;
    if (up && !before) return;
    musicPlayer.moveInQueue(track.key, before ?? null);
  };
  return (
    <li
      data-testid={current ? "music-queue-now" : "music-queue-row"}
      {...(current ? { "aria-current": "true" as const } : {})}
      className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-accent focus-within:bg-accent"
      draggable={editable}
      onDragStart={(event) => { if (!editable) return; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", track.key); onDragKey(track.key); }}
      onDragEnd={() => onDragKey(null)}
      onDragOver={(event) => { if (editable && dragKey && dragKey !== track.key) event.preventDefault(); }}
      onDrop={(event) => { if (!editable || !dragKey) return; event.preventDefault(); musicPlayer.moveInQueue(dragKey, track.key); onDragKey(null); }}
    >
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-start" aria-label={current ? say("Now playing: {name}", { name: label }) : say("Play {name}", { name: label })} onClick={() => { if (current) musicPlayer.playPause(); else musicPlayer.playFromQueue(track.key); }}>
        <Cover url={track.artworkUrl} />
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm font-medium ${current ? "text-primary" : "text-foreground"}`}>{track.title}</span>
          {track.subtitle ? <span className="block truncate text-supporting text-muted-foreground">{track.subtitle}</span> : null}
        </span>
        <span className="text-supporting tabular-nums text-muted-foreground">{track.duration ? clock(track.duration) : ""}</span>
      </button>
      {editable ? <>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon-sm" aria-label={say("More actions for {name}", { name: track.title })}>{icon("more-horizontal")}</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => musicPlayer.playFromQueue(track.key)}>{say("Play now")}</DropdownMenuItem>
            <DropdownMenuItem disabled={first} onSelect={() => move(true)}>{first ? say("Move up (this song is first)") : say("Move up")}</DropdownMenuItem>
            <DropdownMenuItem disabled={last} onSelect={() => move(false)}>{last ? say("Move down (this song is last)") : say("Move down")}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={say("Remove {name} from the queue", { name: track.title })} onClick={() => musicPlayer.removeFromQueue(track.key)}>{icon("x")}</Button>
      </> : null}
    </li>
  );
}

function Section({ title, tier, tracks, dragKey, onDragKey, action }: { title: string; tier: "play-next" | "next-up"; tracks: Track[]; dragKey: string | null; onDragKey: (key: string | null) => void; action?: React.ReactNode }) {
  if (tracks.length === 0) return null;
  const all = musicPlayer.get();
  const upcoming = all.queue.slice(all.index + 1);
  const firstKey = upcoming[0]?.key, lastKey = upcoming.at(-1)?.key;
  return (
    <section aria-label={title} className="flex flex-col gap-1">
      <div className="flex items-center justify-between px-1"><h3 className="text-sm font-semibold text-foreground">{title}</h3>{action}</div>
      <ul className="flex list-none flex-col gap-0.5 p-0" data-testid={`music-queue-${tier}`}>
        {tracks.map((track) => <QueueRow key={track.key} track={track} tier={tier} first={track.key === firstKey} last={track.key === lastKey} dragKey={dragKey} onDragKey={onDragKey} />)}
      </ul>
    </section>
  );
}

function QueueTab() {
  const snap = useMusicPlayer();
  const { push } = useToast();
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const model = paneModel(snap.queue, snap.index, snap.manual);
  const empty = !model.nowPlaying;
  const hasUpcoming = model.playNext.length + model.nextUp.length > 0;
  const save = async () => {
    if (saving || empty) return;
    setSaving(true);
    try {
      const done = await saveQueueAsPlaylist(request, snap.queue, snap.index, snap.source);
      push(done.skipped > 0
        ? say("Saved {saved} songs as {title}. {skipped} could not be added; they are not in your library.", { saved: done.saved, title: done.title, skipped: done.skipped })
        : say("Saved {saved} songs as {title}.", { saved: done.saved, title: done.title }));
    } catch (error) {
      push(error instanceof Error && error.message ? error.message : say("The queue could not be saved. Check your connection and try again."));
    } finally { setSaving(false); }
  };
  if (empty) return <EmptyState icon="list-music" text={say("Nothing is playing. Play a song and its queue shows here.")} />;
  return (
    <div className="flex flex-col gap-4 p-3" data-testid="music-queue-pane">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-sm text-muted-foreground" data-testid="music-queue-source">{say("Playing from")} <span className="font-semibold text-foreground">{sourceLabelOf(snap.source, say("Your songs"))}</span></p>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon-sm" aria-label={say("Queue options")}>{icon("more-horizontal")}</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={!hasUpcoming} onSelect={() => musicPlayer.clearQueue("all")}>{hasUpcoming ? say("Clear queue") : say("Clear queue (nothing is queued)")}</DropdownMenuItem>
            <DropdownMenuItem disabled={saving} onSelect={() => void save()}>{say("Save as playlist")}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <section aria-label={say("Now playing")} className="flex flex-col gap-1">
        <h3 className="px-1 text-sm font-semibold text-primary">{say("Now playing")}</h3>
        <ul className="flex list-none flex-col p-0"><QueueRow track={model.nowPlaying!} current dragKey={dragKey} onDragKey={setDragKey} /></ul>
      </section>
      {hasUpcoming ? null : <p className="px-1 text-sm text-muted-foreground">{say("Nothing is queued after this song. Press Play next or Add to queue on a song to line one up.")}</p>}
      <Section title={say("Play next")} tier="play-next" tracks={model.playNext} dragKey={dragKey} onDragKey={setDragKey}
        action={<Button type="button" variant="ghost" size="icon-sm" aria-label={say("Clear Play next")} onClick={() => musicPlayer.clearQueue("play-next")}>{icon("trash-2")}</Button>} />
      <Section title={say("Next up")} tier="next-up" tracks={model.nextUp} dragKey={dragKey} onDragKey={setDragKey} />
      {dragKey && model.nextUp.length > 0 ? <div className="rounded-md px-2 py-2 text-supporting text-muted-foreground" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); musicPlayer.moveInQueue(dragKey, null); setDragKey(null); }}>{say("Drop here to move the song to the end")}</div> : null}
    </div>
  );
}

function RecentTab() {
  const recent = useQuery({ queryKey: ["music-recent-songs"], queryFn: () => request<{ songs: RecentSong[] }>("/api/plugins/audio/recent-songs"), staleTime: 30_000 });
  if (recent.isPending) return <ul className="flex list-none flex-col gap-2 p-3" role="status" aria-label={say("Loading your recent songs")}>{[0, 1, 2, 3].map((n) => <li key={n}><Skeleton shape="row" /></li>)}</ul>;
  return (
    <AsyncState data={recent.data} error={recent.isError} isFetching={recent.isFetching} onRetry={() => void recent.refetch()} errorMessage={say("Your recent songs did not load. Check your connection and try again.")} loadingLabel={say("Loading your recent songs")}>
      {(data) => data.songs.length === 0
        ? <EmptyState icon="clock" text={say("No recent plays yet. Songs you play show up here.")} />
        : <ul className="flex list-none flex-col gap-0.5 p-3" data-testid="music-recent-list">
          {data.songs.map((song) => <li key={song.id}>
            <Link to={`/media/${encodeURIComponent(song.id)}`} className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-accent focus-visible:bg-accent" aria-label={say("Open {name}", { name: song.title })}>
              <Cover url={song.artwork_url} />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-foreground">{song.title}</span><span className="block truncate text-supporting text-muted-foreground">{[song.subtitle, playedAgo(song.played_at)].filter(Boolean).join(" · ")}</span></span>
              <span className="text-supporting tabular-nums text-muted-foreground">{song.duration_s ? clock(song.duration_s) : ""}</span>
            </Link>
          </li>)}
        </ul>}
    </AsyncState>
  );
}

/** The two tabs for the shell's right pane (its `tabs` list takes `{ id, label, content }`). */
export function musicPaneTabs(): Array<{ id: MusicPaneTab; label: string; content: React.ReactNode }> {
  return [
    { id: QUEUE_TAB, label: say("Queue"), content: <QueueTab /> },
    { id: RECENT_TAB, label: say("Recent"), content: <RecentTab /> },
  ];
}

/** The same two tabs in a kit drawer: the phone path, and the path on a screen with no right pane to give. */
export function MusicQueueDrawer({ open, onOpenChange, tab, onTabChange }: { open: boolean; onOpenChange: (open: boolean) => void; tab: MusicPaneTab; onTabChange: (tab: MusicPaneTab) => void }) {
  const tabs = musicPaneTabs();
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent data-testid="music-queue-drawer">
        <DrawerHeader><DrawerTitle>{say("Queue")}</DrawerTitle><DrawerDescription className="sr-only">{say("The songs coming up, and the songs you played lately.")}</DrawerDescription></DrawerHeader>
        <Tabs value={tab} onValueChange={(value) => onTabChange(value as MusicPaneTab)}>
          <TabsList>{tabs.map((one) => <TabsTrigger key={one.id} value={one.id}>{one.label}</TabsTrigger>)}</TabsList>
          {tabs.map((one) => <TabsContent key={one.id} value={one.id}><div className="max-h-[60vh] overflow-y-auto">{one.content}</div></TabsContent>)}
        </Tabs>
      </DrawerContent>
    </Drawer>
  );
}

/** Where the bar's queue button sends the person: the shell pane when it can carry the tabs, else the drawer. */
export const openMusicQueue = (tab: MusicPaneTab = QUEUE_TAB) => musicPane.request(tab);

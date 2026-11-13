// MP-U3: the song details panel (ace-step-ui's right-hand panel, in Home's kit): a large cover that plays, the title, who made it and when,
// the style as tags, the words (the kit's karaoke list, timed where the song was timed), every version and take with its seed, and the
// actions. Wide screens put it beside the list; a phone opens it as a sheet (the library decides which). Every slow action goes through
// the same routes as chat, so it shows in Activity; a control that cannot work is off and says why.
import { i18n } from "@lingui/core";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@maipai/ui/src/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@maipai/ui/src/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@maipai/ui/src/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@maipai/ui/src/ui/dropdown-menu";
import { Cover } from "@maipai/ui/src/ui/media-tiles";
import { Skeleton } from "@maipai/ui/src/ui/skeleton";
import { EmptyState } from "@maipai/ui/src/primitives/EmptyState";
import { useToast } from "@maipai/ui/src/primitives/Toast";
import { LyricsList } from "@maipai/ui/src/elements/lyrics-list";
import { getIcon } from "@maipai/ui/src/icons";
import { api } from "@/lib/api";
import { errorLine } from "@/lib/hubReachability";
import { formatDate } from "@/lib/format";
import { videosApi } from "@/lib/videosApi";
import { musicApi, type MusicCard, type MusicVersion } from "@/lib/musicApi";
import { rememberBedSong } from "@/shell/library/musicBed";
import { SongResult } from "./MakeSongPage";
import { RemixSong } from "./MusicRemix";
import { stemsAddress, studioAddress } from "./musicAddresses";
import { clockOf, isLockedTile, isMaking, playableVersion, styleTags } from "./musicLibraryModel";
import type { RowPlayer } from "./useRowPlayer";

const problemText = (error: unknown, fallback: string): string => errorLine(error, fallback);
const SECONDS_OR_MS = (value: number): number => (value < 1e12 ? value * 1000 : value);

/** "Use in a video": the person picks one of their own videos in a dialog the list draws; the song goes under it through the same add-music
 * edit the Library uses. This holds the pick's state and the call. */
export function useBedPicker(version: MusicVersion | null, close: () => void) {
  const { push } = useToast();
  const navigate = useNavigate();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: 60_000, enabled: version !== null });
  const [problem, setProblem] = useState("");
  const add = (clip: string | null) => {
    if (!clip || !version) { close(); return; }
    rememberBedSong(version.id); setProblem("");
    void videosApi.addMusic({ clip, track: version.id, level: "soft" })
      .then((result) => { close(); push(i18n._({ id: "Putting the song under your video. It shows in Activity and in the chat.", message: "Putting the song under your video. It shows in Activity and in the chat." })); navigate(`/chat?conversation=${encodeURIComponent(result.conversation_id)}`); })
      .catch((error: unknown) => setProblem(problemText(error, i18n._({ id: "The song could not be added to that video. Try again in a minute.", message: "The song could not be added to that video. Try again in a minute." }))));
  };
  return { personId: me.data?.id, problem, add };
}

/** Why a song's actions are off right now, or an empty string when they are on. */
export function songReason(card: MusicCard | undefined): string {
  if (!card) return i18n._({ id: "Available once the song is loaded.", message: "Available once the song is loaded." });
  if (isLockedTile(card)) return i18n._({ id: "This song is locked. Unlock it first.", message: "This song is locked. Unlock it first." });
  if (card.state !== "done" || card.versions.length === 0) return i18n._({ id: "Available once the song is finished.", message: "Available once the song is finished." });
  return "";
}

/** The details of one song. `id` is the song; `player` is the list's shared player. */
export function SongDetails({ id, player, remix, onClose, onDelete, onLikeThis, onVideo }: {
  id: string; player: RowPlayer; remix: boolean; onClose?: () => void;
  onDelete: (card: MusicCard) => void; onLikeThis: (card: MusicCard) => void; onVideo: (version: MusicVersion) => void;
}) {
  const { push } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [remixing, setRemixing] = useState(remix);
  const [editing, setEditing] = useState(false);
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: 60_000 });
  const card = useQuery({ queryKey: ["music-song", id], queryFn: ({ signal }) => musicApi.card(id, signal), staleTime: 0,
    // Keep looking while the song is being made, and for a short while after it is done until its cover arrives.
    refetchInterval: (query) => { const now = query.state.data; return now && !isLockedTile(now) && (isMaking(now) || !!now.making_version || (now.state === "done" && !now.cover_url && query.state.dataUpdateCount < 40)) ? 3000 : false; } });
  const raw = card.data;
  const locked = isLockedTile(raw);
  const song = locked ? undefined : raw;
  const reason = locked ? songReason(raw) : songReason(song);
  const ready = reason === "";
  const version = song ? playableVersion(song) : undefined;
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ["music-song", id] }); void queryClient.invalidateQueries({ queryKey: ["music-songs"] }); };
  const fail = (error: unknown, fallback: string) => push(problemText(error, fallback));
  const extend = () => { void musicApi.setLength(id, "full", version?.id).then(() => { push(i18n._({ id: "Making the full version. It appears on this song.", message: "Making the full version. It appears on this song." })); refresh(); }).catch((error: unknown) => fail(error, i18n._({ id: "That could not start. Try again.", message: "That could not start. Try again." }))); };
  const newCover = () => { void musicApi.newCover(id, `Album cover art for the song "${song?.title ?? "Untitled song"}"`).then(() => { push(i18n._({ id: "Making a new cover.", message: "Making a new cover." })); refresh(); }).catch((error: unknown) => fail(error, i18n._({ id: "A new cover could not start. Try again.", message: "A new cover could not start. Try again." }))); };
  const chooseVersion = (fileId: string) => { void musicApi.useVersion(id, fileId).then(refresh).catch((error: unknown) => fail(error, i18n._({ id: "That version could not be chosen. Try again.", message: "That version could not be chosen. Try again." }))); };

  if (locked) return <div className="flex flex-col gap-3 p-4" data-testid="music-song-details"><EmptyState icon="lock" text={i18n._({ id: "This song is locked. Unlock it from the Library to open it.", message: "This song is locked. Unlock it from the Library to open it." })} /></div>;
  if (!song) return card.isError
    ? <div className="p-4" data-testid="music-song-details"><EmptyState icon="music" text={i18n._({ id: "That song is not here any more. It may have been removed from your Library.", message: "That song is not here any more. It may have been removed from your Library." })} /></div>
    : <div className="flex flex-col gap-4 p-4" data-testid="music-song-details" role="status" aria-label={i18n._({ id: "Loading the song", message: "Loading the song" })}><Skeleton shape="tile" /><Skeleton shape="line" /><Skeleton shape="row" /></div>;

  const title = song.title ?? i18n._({ id: "Untitled song", message: "Untitled song" });
  const tags = styleTags(song.description);
  const length = clockOf(song.duration_s);
  const made = Number.isFinite(Number(song.started_at)) && Number(song.started_at) > 0 ? formatDate(new Date(SECONDS_OR_MS(Number(song.started_at))), { year: "numeric", month: "long", day: "numeric" }) : "";
  const playingThis = !!version && player.key === version.id && player.playing;
  const Play = getIcon(playingThis ? "pause" : "play");
  const playCurrent = () => { if (version) player.toggle({ key: version.id, url: version.url, title, artworkUrl: song.cover_url }); };
  const lyricsText = song.lyrics?.trim() && song.lyrics.trim() !== "[Instrumental]" ? song.lyrics : "";
  const timed = song.timed_lyrics?.length ? song.timed_lyrics : null;
  const liveTime = version && player.key === version.id ? player.time : 0;
  // The kit's lyrics list, placed in the panel's Lyrics section: the section is page layout, not a frame drawn around the Element.
  const lyricsNode = timed
    ? <LyricsList lines={timed} currentTime={liveTime} onSeek={(seconds) => { if (version && player.key !== version.id) playCurrent(); player.seek(seconds); }} labels={{ label: i18n._({ id: "Lyrics", message: "Lyrics" }), empty: i18n._({ id: "Instrumental. No lyrics were written.", message: "Instrumental. No lyrics were written." }) }} />
    : <LyricsList {...(lyricsText ? { text: lyricsText } : {})} labels={{ label: i18n._({ id: "Lyrics", message: "Lyrics" }), empty: i18n._({ id: "Instrumental. No lyrics were written.", message: "Instrumental. No lyrics were written." }) }} />;
  const Icon = (name: string) => { const One = getIcon(name); return <One aria-hidden="true" />; };

  return <div className="flex flex-col gap-5 p-4 pb-8" data-testid="music-song-details">
    <div className="group relative aspect-square w-full shrink-0 overflow-hidden rounded-2xl">
      <Cover id={song.id} title={title} url={song.cover_url} big />
      {version ? <button type="button" onClick={playCurrent} aria-label={playingThis ? i18n._({ id: "Pause {title}", message: "Pause {title}", values: { title } }) : i18n._({ id: "Play {title}", message: "Play {title}", values: { title } })} disabled={!ready}
        className="bg-background/30 absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
        <span className="bg-primary text-primary-foreground flex size-16 items-center justify-center rounded-full shadow-lg"><Play aria-hidden="true" className="size-7" /></span>
      </button> : null}
      {length ? <span className="bg-background/60 text-foreground absolute right-3 bottom-3 rounded-full px-2.5 py-1 text-badge font-medium tabular-nums backdrop-blur-md">{length}</span> : null}
    </div>

    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <h2 className="text-title truncate">{title}</h2>
        <p className="text-muted-foreground text-supporting">{me.data?.display_name ? i18n._({ id: "By {name}", message: "By {name}", values: { name: me.data.display_name } }) : i18n._({ id: "Made on this Home", message: "Made on this Home" })}{made ? ` · ${made}` : ""}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" aria-label={i18n._({ id: "More about {title}", message: "More about {title}", values: { title } })}>{Icon("more-horizontal")}</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={!ready || song.length === "full"} onSelect={extend}>{Icon("sparkles")}{i18n._({ id: "Extend to full", message: "Extend to full" })}</DropdownMenuItem>
            <DropdownMenuItem disabled={!ready} onSelect={newCover}>{Icon("wand-sparkles")}{i18n._({ id: "New cover art", message: "New cover art" })}</DropdownMenuItem>
            <DropdownMenuItem disabled={!ready} onSelect={() => onLikeThis(song)}>{Icon("repeat")}{i18n._({ id: "Make another like this", message: "Make another like this" })}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => onDelete(song)}>{Icon("trash")}{i18n._({ id: "Delete song", message: "Delete song" })}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {onClose ? <Button type="button" variant="ghost" size="icon" aria-label={i18n._({ id: "Close the song details", message: "Close the song details" })} onClick={onClose}>{Icon("x")}</Button> : null}
      </div>
    </div>

    {song.making_version ? <div className="flex flex-col gap-2" role="status" data-testid="music-making-version">
      <p className="text-supporting font-semibold">{song.making_version.position ? i18n._({ id: "Your new version is waiting, number {position} in line", message: "Your new version is waiting, number {position} in line", values: { position: song.making_version.position } }) : i18n._({ id: "Making your new version: {stage}{progress}", message: "Making your new version: {stage}{progress}", values: { stage: song.making_version.stage_label || i18n._({ id: "starting", message: "starting" }), progress: song.making_version.progress > 0 ? ` ${Math.round(song.making_version.progress * 100)}%` : "" } })}</p>
      <progress className="w-full" max={1} value={song.making_version.progress > 0 ? song.making_version.progress : undefined} aria-label={i18n._({ id: "New version progress", message: "New version progress" })} />
      <p className="text-muted-foreground text-badge">{i18n._({ id: "It appears on this song when it is done. The earlier version stays.", message: "It appears on this song when it is done. The earlier version stays." })}</p>
    </div> : null}

    <div className="flex flex-col gap-2" data-testid="music-song-actions">
      <div className="flex flex-wrap gap-2">
        <Button asChild disabled={!ready}><Link to={studioAddress(id)} aria-disabled={!ready} onClick={(event) => { if (!ready) event.preventDefault(); }}>{Icon("sliders-horizontal")}{i18n._({ id: "Open in Studio", message: "Open in Studio" })}</Link></Button>
        <Button type="button" variant="secondary" disabled={!ready} onClick={() => setRemixing(true)}>{Icon("shuffle")}{i18n._({ id: "Remix", message: "Remix" })}</Button>
        <Button asChild variant="secondary" disabled={!ready}><Link to={stemsAddress(id)} aria-disabled={!ready} onClick={(event) => { if (!ready) event.preventDefault(); }}>{Icon("layers")}{i18n._({ id: "Extract stems", message: "Extract stems" })}</Link></Button>
        <Button type="button" variant="secondary" disabled={!ready || !version} onClick={() => { if (version) onVideo(version); }}>{Icon("film")}{i18n._({ id: "Use in a video", message: "Use in a video" })}</Button>
        {version && ready ? <Button asChild variant="secondary"><a href={version.url} download>{Icon("download")}{i18n._({ id: "Download", message: "Download" })}</a></Button> : <Button type="button" variant="secondary" disabled>{Icon("download")}{i18n._({ id: "Download", message: "Download" })}</Button>}
        <Button type="button" variant="secondary" disabled={!ready || !version} onClick={() => { if (version) navigate(`/files?file=${encodeURIComponent(version.id)}`); }}>{Icon("share")}{i18n._({ id: "Share", message: "Share" })}</Button>
      </div>
      {reason ? <p className="text-muted-foreground text-badge" data-testid="music-song-reason">{reason}</p> : null}
    </div>

    {tags.length ? <section className="flex flex-col gap-2" aria-label={i18n._({ id: "Style and tags", message: "Style and tags" })}>
      <h3 className="text-muted-foreground text-badge font-semibold tracking-wide uppercase">{i18n._({ id: "Style and tags", message: "Style and tags" })}</h3>
      <div className="flex flex-wrap gap-1.5">{tags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}</div>
    </section> : null}

    <section className="flex flex-col gap-2" aria-label={i18n._({ id: "Lyrics", message: "Lyrics" })}>
      <h3 className="text-muted-foreground text-badge font-semibold tracking-wide uppercase">{i18n._({ id: "Lyrics", message: "Lyrics" })}</h3>
      {lyricsNode}
    </section>

    {song.versions.length > 0 ? <section className="flex flex-col gap-2" aria-label={song.takes ? i18n._({ id: "Takes", message: "Takes" }) : i18n._({ id: "Versions", message: "Versions" })} data-testid="music-versions">
      <h3 className="text-muted-foreground text-badge font-semibold tracking-wide uppercase">{song.takes ? i18n._({ id: "Takes and versions", message: "Takes and versions" }) : i18n._({ id: "Versions", message: "Versions" })}</h3>
      <ul className="flex list-none flex-col gap-1 p-0">
        {song.versions.map((one) => {
          const now = player.key === one.id && player.playing; const Row = getIcon(now ? "pause" : "play");
          return <li key={one.id} className="flex min-w-0 items-center gap-2">
            <Button type="button" variant="ghost" size="icon-sm" aria-label={now ? i18n._({ id: "Pause {label}", message: "Pause {label}", values: { label: one.label } }) : i18n._({ id: "Play {label}", message: "Play {label}", values: { label: one.label } })} disabled={!ready} onClick={() => player.toggle({ key: one.id, url: one.url, title: `${title} (${one.label})`, artworkUrl: song.cover_url })}><Row aria-hidden="true" /></Button>
            <span className="min-w-0 flex-1 truncate text-supporting">{one.label}{typeof one.seed === "number" ? <span className="text-muted-foreground"> · {i18n._({ id: "Seed {seed}", message: "Seed {seed}", values: { seed: one.seed } })}</span> : null}</span>
            {one.id === song.current_id ? <Badge variant="outline">{i18n._({ id: "Current", message: "Current" })}</Badge> : <Button type="button" variant="ghost" size="sm" disabled={!ready} onClick={() => chooseVersion(one.id)}>{i18n._({ id: "Use this one", message: "Use this one" })}</Button>}
            <Button asChild variant="ghost" size="icon-sm"><a href={one.url} download aria-label={i18n._({ id: "Download {label}", message: "Download {label}", values: { label: one.label } })}>{Icon("download")}</a></Button>
          </li>;
        })}
      </ul>
    </section> : null}

    {ready ? <Collapsible open={editing} onOpenChange={setEditing}>
      <CollapsibleTrigger asChild><Button type="button" variant="outline" aria-expanded={editing}>{editing ? i18n._({ id: "Hide the full player", message: "Hide the full player" }) : i18n._({ id: "Edit and play with the full player", message: "Edit and play with the full player" })}</Button></CollapsibleTrigger>
      <CollapsibleContent><div className="flex flex-col gap-3 pt-3"><SongResult key={id} id={id} onAnother={onClose} inWorkspace /></div></CollapsibleContent>
    </Collapsible> : null}

    {remixing && song && ready ? <Dialog open onOpenChange={(open) => { if (!open) setRemixing(false); }}><DialogContent size="xl" scroll="viewport">
      <DialogHeader><DialogTitle>{song.title ? i18n._({ id: "Remix ‘{title}’", message: "Remix ‘{title}’", values: { title: song.title } }) : i18n._({ id: "Remix this song", message: "Remix this song" })}</DialogTitle><DialogDescription>{i18n._({ id: "Say what to change. You see the request before anything is made, and the earlier version is kept.", message: "Say what to change. You see the request before anything is made, and the earlier version is kept." })}</DialogDescription></DialogHeader>
      <RemixSong card={song} onClose={() => setRemixing(false)} onSent={refresh} />
    </DialogContent></Dialog> : null}
  </div>;
}


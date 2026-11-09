// MUSIC-WORKSPACE-03: the Music app's Create home, in the look of a modern creator app. A black page with a lime accent (kit tokens only): a hero
// panel of covers with a headline and a floating glass prompt bar (mode, style, engine, lyrics, length and instrumental chips, and one big Generate
// button), then carousels of your songs, starter sounds and the tools, every tile with a cover (a real one, or one drawn from the song's id).
// Picking a song opens it above the rows with every action as a visible button; one the engine cannot do is turned off with its plain reason.
// The same tiles serve the Studio, Stems and Remix pages (`SongGallery`).
// Every change made here has its edit card in chat (the edit_* actions), so a change is one change to one record.
import { i18n } from "@lingui/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@maipai/ui/src/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@maipai/ui/src/ui/dialog";
import { Input } from "@maipai/ui/src/ui/input";
import { Textarea } from "@maipai/ui/src/ui/textarea";
import { Label } from "@maipai/ui/src/ui/label";
import { Switch } from "@maipai/ui/src/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@maipai/ui/src/ui/toggle-group";
import { Chip } from "@maipai/ui/src/primitives/Chip";
import { DestructiveConfirm } from "@maipai/ui/src/primitives/DestructiveConfirm";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { EmptyState } from "@maipai/ui/src/primitives/EmptyState";
import { useToast } from "@maipai/ui/src/primitives/Toast";
import { SongResult, MAKE_SONG_ADULT_LINE, NO_MUSIC_ENGINE_LINE, makeSongBody, Field } from "./MakeSongPage";
import { MusicTrack } from "@maipai/ui/src/elements/music-track";
import { useMusicTrackProps } from "@/apps/chat/MusicCardView";
import { CreatePage } from "./MusicStudioPages";
import { Cover, GlassPill, MediaCarousel, MediaTile } from "@maipai/ui/src/ui/media-tiles";
import { RemixSong } from "./MusicRemix";
import { getIcon } from "@maipai/ui/src/icons";
import { requestJson } from "@/lib/api";
import { musicApi, type MusicCard } from "@/lib/musicApi";
import { BringSong } from "./BringSong";
import { VoiceCreate } from "./MusicVoiceCreate";
import { AddSoundToSong, SoundTakes } from "./SoundExtras";

export type Make = "song" | "band" | "album" | "song_style" | "sound" | "voice";
export const MAKES: () => Array<{ id: Make; label: string }> = () => ([{ id: "song", label: i18n._({ id: "Song", message: "Song" }) }, { id: "band", label: i18n._({ id: "Band", message: "Band" }) }, { id: "album", label: i18n._({ id: "Album", message: "Album" }) }, { id: "song_style", label: i18n._({ id: "Style", message: "Style" }) }, { id: "sound", label: i18n._({ id: "Sound", message: "Sound" }) }, { id: "voice", label: i18n._({ id: "Voice", message: "Voice" }) }]);
const STARTER_STYLES = ["Dreamy indie pop", "Lo-fi beats", "Cinematic score", "Upbeat funk", "Acoustic folk", "Synthwave", "Jazz ballad", "Epic orchestral"];
const active = (card: MusicCard): boolean => card.state === "queued" || card.state === "running";
const clock = (seconds: number | null): string => (seconds && seconds > 0 ? `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}` : "");
const text = (error: unknown, fallback: string): string => (error instanceof Error && error.message ? error.message : fallback);

export const STEMS_LINE = () => i18n._({ id: "Splitting a song into stems is not available on this Home yet.", message: "Splitting a song into stems is not available on this Home yet." });
export const COVER_SONG_LINE = () => i18n._({ id: "Bring a song to change its style, remove vocals, split stems, or sing it in another household voice.", message: "Bring a song to change its style, remove vocals, split stems, or sing it in another household voice." });
export const songAddress = (id: string | null): string => (id ? `/apps/music/create?song=${encodeURIComponent(id)}` : "/apps/music/create");
export const studioAddress = (id: string): string => `/apps/music/studio?song=${encodeURIComponent(id)}`;
export const stemsAddress = (id: string): string => `/apps/music/studio?song=${encodeURIComponent(id)}&split=1`;
/** Opens the song with the Remix panel showing. Nothing is made until the panel's confirm button is pressed. */
export const remixAddress = (id: string): string => `/apps/music/create?song=${encodeURIComponent(id)}&remix=1`;
export function makeSoundBody(form: { description: string; seconds: string; loop: boolean; stick: "words" | "surprise"; takes?: number }) {
  const seconds = Number(form.seconds);
  return { description: form.description.trim(), ...(form.seconds.trim() && Number.isFinite(seconds) && seconds > 0 ? { seconds } : {}), loop: form.loop, stick_to_words: form.stick === "words", ...(form.takes && form.takes > 1 ? { takes: form.takes } : {}) };
}

/** What a tile says under the title: how far along it is, or its sound. */
export function songLine(card: MusicCard): string {
  if (active(card)) return card.position ? i18n._({ id: "Waiting, number {position} in line", message: "Waiting, number {position} in line", values: { position: card.position } }) : `${card.stage_label || i18n._({ id: "Making your song", message: "Making your song" })}${card.progress > 0 ? ` ${Math.round(card.progress * 100)}%` : ""}`;
  if (card.state === "failed") return card.error_line ?? i18n._({ id: "This song could not be made. Open it to try again.", message: "This song could not be made. Open it to try again." });
  if (card.state === "cancelled") return i18n._({ id: "Stopped", message: "Stopped" });
  return card.description ?? "";
}

function useSongs() {
  return useQuery({
    queryKey: ["music-songs"], queryFn: () => requestJson<MusicCard[]>("/api/music/jobs"), staleTime: 2_000,
    refetchInterval: (query) => (query.state.data?.some(active) ? 3000 : 20_000),
  });
}


/** One song as a tile: its cover, glass pills for length and state, and the quick actions as visible buttons. */
function songTile({ card, selected, onOpen, actions }: { card: MusicCard; selected: boolean; onOpen: () => void; actions: Array<{ label: string; to: string }> }) {
  const title = card.title ?? (active(card) ? i18n._({ id: "Making your song", message: "Making your song" }) : i18n._({ id: "Untitled song", message: "Untitled song" }));
  const length = card.state === "done" ? clock(card.duration_s) : "";
  return <MediaTile key={card.id} id={card.id} title={title} line={songLine(card)} coverUrl={card.cover_url} selected={selected} busy={active(card)} playable={card.state === "done"} onOpen={onOpen}
    progress={active(card) ? card.progress : undefined} pills={<>{length ? <GlassPill>{length}</GlassPill> : null}{active(card) ? <GlassPill>{i18n._({ id: "Making", message: "Making" })}</GlassPill> : null}</>}>
    {card.state === "done" ? <div className="-ml-2 flex gap-1">{actions.map((one) => { const Icon = getIcon(TILE_ICONS[one.label] ?? "music"); return <Button key={one.label} asChild size="icon-sm" variant="ghost"><Link to={one.to} aria-label={one.label} title={one.label}><Icon aria-hidden="true" /></Link></Button>; })}</div> : null}
  </MediaTile>;
}

function SoundMaker({ onMade }: { onMade: (id: string) => void }) {
  const { push } = useToast();
  const status = useQuery({ queryKey: ["music-status"], queryFn: () => musicApi.status(), staleTime: 10_000, retry: false });
  const [description, setDescription] = useState(""); const [loop, setLoop] = useState(false); const [stick, setStick] = useState<"words" | "surprise">("words"); const [seconds, setSeconds] = useState("3"); const [takes, setTakes] = useState<"1" | "2" | "3">("1"); const [making, setMaking] = useState(false); const [problem, setProblem] = useState("");
  const engineMissing = status.data ? !status.data.can_make : false;
  const ready = description.trim().length >= 3 && description.trim().length <= 600 && !making && !engineMissing && !status.isPending;
  const hint = engineMissing ? NO_MUSIC_ENGINE_LINE() : problem || (description.trim().length < 3 ? i18n._({ id: "Describe the sound in at least 3 characters to turn Generate on.", message: "Describe the sound in at least 3 characters to turn Generate on." }) : i18n._({ id: "Describe the sound and press Generate.", message: "Describe the sound and press Generate." }));
  const create = () => {
    if (!ready) { if (!making) push(hint); return; }
    setMaking(true); setProblem("");
    void musicApi.makeSound(makeSoundBody({ description, seconds, loop, stick, takes: Number(takes) }))
      .then(card => { setDescription(""); onMade(card.id); })
      .catch((error: unknown) => { const line = text(error, i18n._({ id: "Home could not start the sound. Check the request and try again.", message: "Home could not start the sound. Check the request and try again." })); setProblem(line); push(line); })
      .finally(() => setMaking(false));
  };
  return <div className="flex flex-col gap-3" data-testid="sound-maker">
    <Field label={i18n._({ id: "Describe the sound", message: "Describe the sound" })}><Textarea aria-label={i18n._({ id: "Describe the sound", message: "Describe the sound" })} rows={3} minLength={3} maxLength={600} value={description} onChange={event => setDescription(event.currentTarget.value)} placeholder={i18n._({ id: "A wooden door creaking open in a quiet house", message: "A wooden door creaking open in a quiet house" })} /></Field>
    <div className="flex flex-wrap items-center gap-4">
      <Field label={i18n._({ id: "Loop it", message: "Loop it" })}><Switch checked={loop} onCheckedChange={setLoop} aria-label={i18n._({ id: "Loop it", message: "Loop it" })} /></Field>
      <Field label={i18n._({ id: "Stick to my words / Surprise me", message: "Stick to my words / Surprise me" })}><ToggleGroup type="single" variant="outline" value={stick} onValueChange={next => { if (next === "words" || next === "surprise") setStick(next); }} aria-label={i18n._({ id: "Sound direction", message: "Sound direction" })}><ToggleGroupItem value="words">{i18n._({ id: "Stick to my words", message: "Stick to my words" })}</ToggleGroupItem><ToggleGroupItem value="surprise">{i18n._({ id: "Surprise me", message: "Surprise me" })}</ToggleGroupItem></ToggleGroup></Field>
      <div className="flex flex-col gap-2"><Label htmlFor="sound-seconds">{i18n._({ id: "Seconds", message: "Seconds" })}</Label><Input id="sound-seconds" type="number" min={1} max={60} placeholder="3" value={seconds} onChange={event => setSeconds(event.currentTarget.value)} aria-describedby="sound-seconds-note" /><p id="sound-seconds-note" className="text-muted-foreground text-xs">{status.data?.limits && Number(seconds) < status.data.limits.min_seconds ? i18n._({ id: "The music model makes at least {min} seconds, so Home cuts it to this length.", message: "The music model makes at least {min} seconds, so Home cuts it to this length.", values: { min: status.data.limits.min_seconds } }) : i18n._({ id: "From 1 to 60 seconds.", message: "From 1 to 60 seconds." })}</p></div>
      <Field label={i18n._({ id: "Takes", message: "Takes" })}><ToggleGroup type="single" variant="outline" value={takes} onValueChange={next => { if (next === "1" || next === "2" || next === "3") setTakes(next); }} aria-label={i18n._({ id: "Number of takes", message: "Number of takes" })}><ToggleGroupItem value="1">1</ToggleGroupItem><ToggleGroupItem value="2">2</ToggleGroupItem><ToggleGroupItem value="3">3</ToggleGroupItem></ToggleGroup></Field>
      <div className="bg-card sticky bottom-0 flex w-full flex-wrap items-center justify-between gap-3 pt-2" data-testid="sound-maker-footer">
      <p role={problem || engineMissing ? "alert" : "status"} className="text-muted-foreground text-xs">{hint}</p>
      <Button type="button" size="lg" aria-disabled={!ready} variant={ready ? "default" : "secondary"} onClick={create} title={hint}>{making ? i18n._({ id: "Starting", message: "Starting" }) : i18n._({ id: "Generate", message: "Generate" })}</Button>
      </div>
    </div>
  </div>;
}

const TILE_ICONS: Record<string, string> = { Studio: "sliders-horizontal", Stems: "audio-waveform", Remix: "shuffle" };
const TILE_ACTIONS = (card: MusicCard): Array<{ label: string; to: string }> => [
  { label: i18n._({ id: "Studio", message: "Studio" }), to: studioAddress(card.id) }, { label: i18n._({ id: "Stems", message: "Stems" }), to: stemsAddress(card.id) }, { label: i18n._({ id: "Remix", message: "Remix" }), to: remixAddress(card.id) },
];

function useShown(filter: string) {
  const list = useSongs();
  const shown = useMemo(() => (list.data ?? []).filter((card) => !filter.trim() || `${card.title ?? ""} ${card.description ?? ""}`.toLowerCase().includes(filter.trim().toLowerCase())), [list.data, filter]);
  return { list, shown };
}

/** The gallery of the person's songs, wrapped in rows. `actionsFor` decides what each tile offers; `onOpen` what a click does. */
export function SongGallery({ selected, onOpen, actionsFor = TILE_ACTIONS, empty }: { selected: string | null; onOpen: (card: MusicCard) => void; actionsFor?: (card: MusicCard) => Array<{ label: string; to: string }>; empty?: string }) {
  const [filter, setFilter] = useState("");
  const { list, shown } = useShown(filter);
  return <div className="flex min-h-0 flex-col gap-4" data-testid="music-song-list">
    <div className="max-w-sm"><Input type="search" aria-label={i18n._({ id: "Search your songs", message: "Search your songs" })} placeholder={i18n._({ id: "Search your songs", message: "Search your songs" })} value={filter} onChange={(event) => setFilter(event.currentTarget.value)} /></div>
    <AsyncState data={list.data} error={list.isError} isFetching={list.isFetching} onRetry={() => void list.refetch()} errorMessage={i18n._({ id: "Your songs could not be loaded. Check your connection and open this page again.", message: "Your songs could not be loaded. Check your connection and open this page again." })} loadingLabel={i18n._({ id: "Loading your songs", message: "Loading your songs" })}>
      {() => shown.length === 0 ? <EmptyState icon="music" text={filter.trim() ? i18n._({ id: "No song matches that.", message: "No song matches that." }) : (empty ?? i18n._({ id: "No songs yet. Describe one in the bar below and press Create.", message: "No songs yet. Describe one in the bar below and press Create." }))} />
        : <ul className="flex list-none flex-wrap gap-4 p-0" aria-label={i18n._({ id: "Your songs", message: "Your songs" })}>{shown.map((card) => songTile({ card, selected: card.id === selected, onOpen: () => onOpen(card), actions: actionsFor(card) }))}</ul>}
    </AsyncState>
  </div>;
}

const TOOLS = () => ([
  { label: i18n._({ id: "Studio", message: "Studio" }), line: i18n._({ id: "Tracks, waveforms, mute and solo for any song.", message: "Tracks, waveforms, mute and solo for any song." }), to: "/apps/music/studio" },
  { label: i18n._({ id: "Stems", message: "Stems" }), line: i18n._({ id: "Split a song into vocals, drums, bass and the rest.", message: "Split a song into vocals, drums, bass and the rest." }), to: "/apps/music/stems" },
  { label: i18n._({ id: "Remix", message: "Remix" }), line: i18n._({ id: "Say what to change, review it, then Home makes it.", message: "Say what to change, review it, then Home makes it." }), to: "/apps/music/remix" },
  { label: i18n._({ id: "Extend", message: "Extend" }), line: i18n._({ id: "Turn a quick song into a full one, or back.", message: "Turn a quick song into a full one, or back." }), to: "/apps/music/remix" },
  { label: i18n._({ id: "Cover art", message: "Cover art" }), line: i18n._({ id: "Make a new picture for any song.", message: "Make a new picture for any song." }), to: "/apps/music/remix" },
]);

/** The song opened above the rows: its cover blurred into the background, the kit player, and every action as a button, each off with its reason. */
function SongDetail({ id, onClose, remix }: { id: string; onClose: () => void; remix: boolean }) {
  const [remixing, setRemixing] = useState(remix);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const top = useRef<HTMLElement>(null);
  // The song opens above the tiles; bring it into view so a click on a tile's Remix or Stems is seen to do something.
  useEffect(() => { top.current?.scrollIntoView?.({ behavior: "smooth", block: "start" }); }, [id]);
  const { push } = useToast();
  const queryClient = useQueryClient();
  const card = useQuery({ queryKey: ["music-song", id], queryFn: ({ signal }) => musicApi.card(id, signal), staleTime: 0,
    // Keep looking while the song is being made, and for a short while after it is done until its cover arrives.
    refetchInterval: (query) => { const now = query.state.data; return now && (active(now) || !!now.making_version || (now.state === "done" && !now.cover_url && query.state.dataUpdateCount < 40)) ? 3000 : false; } });
  const song = card.data;
  const ready = song?.state === "done" && song.versions.length > 0;
  const version = song ? (song.versions.find((one) => one.id === song.current_id) ?? song.versions.at(-1)) : undefined;
  const again = (length: "quick" | "full") => { void musicApi.setLength(id, length).then(() => { push(length === "full" ? i18n._({ id: "Making the full version. It appears on this song.", message: "Making the full version. It appears on this song." }) : i18n._({ id: "Making the quick version. It appears on this song.", message: "Making the quick version. It appears on this song." })); void queryClient.invalidateQueries({ queryKey: ["music-song", id] }); }).catch((error: unknown) => push(text(error, i18n._({ id: "That could not start. Try again.", message: "That could not start. Try again." })))); };
  const removeSong = () => { setDeleting(true); void musicApi.remove(id).then(() => { push(i18n._({ id: "Moved to Trash. You can bring it back from the Library until the keep time ends.", message: "Moved to Trash. You can bring it back from the Library until the keep time ends." })); void queryClient.invalidateQueries({ queryKey: ["music-songs"] }); onClose(); }).catch((error: unknown) => { setConfirmingDelete(false); push(text(error, i18n._({ id: "That song could not be deleted. Try again.", message: "That song could not be deleted. Try again." }))); }).finally(() => setDeleting(false)); };
  const newCover = () => { void musicApi.newCover(id, `Album cover art for the song "${song?.title ?? "Untitled song"}"`).then(() => { push(i18n._({ id: "Making a new cover.", message: "Making a new cover." })); void queryClient.invalidateQueries({ queryKey: ["music-song", id] }); }).catch((error: unknown) => push(text(error, i18n._({ id: "A new cover could not start. Try again.", message: "A new cover could not start. Try again." })))); };
  const reasonOff = ready ? "" : i18n._({ id: "Available once the song is finished.", message: "Available once the song is finished." });
  return <section ref={top} className="flex shrink-0 flex-col gap-5 py-2" data-testid="music-song-result" aria-label={i18n._({ id: "Open song", message: "Open song" })}>
        <div className="flex items-start justify-between gap-3">
      <div className="flex flex-col gap-1"><p className="text-muted-foreground text-xs font-semibold tracking-widest uppercase">{i18n._({ id: "Now open", message: "Now open" })}</p><h2 className="text-4xl leading-none font-black tracking-tight uppercase sm:text-6xl">{song?.title ?? i18n._({ id: "Your song", message: "Your song" })}</h2></div>
      <Button type="button" variant="secondary" size="sm" onClick={onClose}>{i18n._({ id: "Close", message: "Close" })}</Button>
    </div>
    <div><SongResult key={id} id={id} onAnother={onClose} inWorkspace /></div>
    {song?.making_version ? <div className="flex flex-col gap-2" role="status" data-testid="music-making-version">
      <p className="text-sm font-semibold">{song.making_version.position ? i18n._({ id: "Your new version is waiting, number {position} in line", message: "Your new version is waiting, number {position} in line", values: { position: song.making_version.position } }) : i18n._({ id: "Making your new version: {stage}{progress}", message: "Making your new version: {stage}{progress}", values: { stage: song.making_version.stage_label || i18n._({ id: "starting", message: "starting" }), progress: song.making_version.progress > 0 ? ` ${Math.round(song.making_version.progress * 100)}%` : "" } })}</p>
      <progress className="w-full" max={1} value={song.making_version.progress > 0 ? song.making_version.progress : undefined} aria-label={i18n._({ id: "New version progress", message: "New version progress" })} />
      <p className="text-muted-foreground text-xs">{i18n._({ id: "It appears on this song when it is done. The earlier version stays.", message: "It appears on this song when it is done. The earlier version stays." })}</p>
    </div> : null}
    <div className="flex flex-col gap-2" data-testid="music-song-actions">
      <div className="flex flex-wrap gap-2">
        <Button asChild disabled={!ready}><Link to={studioAddress(id)} aria-disabled={!ready}>{i18n._({ id: "Open in Studio", message: "Open in Studio" })}</Link></Button>
        <Button asChild variant="secondary" disabled={!ready}><Link to={stemsAddress(id)} aria-disabled={!ready}>{i18n._({ id: "Extract stems", message: "Extract stems" })}</Link></Button>
        <Button type="button" variant="secondary" disabled={!ready} onClick={() => setRemixing(true)}>{i18n._({ id: "Remix", message: "Remix" })}</Button>
        {song?.length === "full" ? null : <Button type="button" variant="secondary" disabled={!ready} onClick={() => again("full")}>{i18n._({ id: "Extend to full", message: "Extend to full" })}</Button>}
        <Button type="button" variant="secondary" disabled={!ready} onClick={newCover}>{i18n._({ id: "New cover art", message: "New cover art" })}</Button>
        {version ? <Button asChild variant="secondary"><a href={version.url} download>{i18n._({ id: "Download", message: "Download" })}</a></Button> : <Button type="button" variant="secondary" disabled>{i18n._({ id: "Download", message: "Download" })}</Button>}
        <Button type="button" variant="secondary" disabled>{i18n._({ id: "Cover with a new voice", message: "Cover with a new voice" })}</Button>
        <Button type="button" variant="secondary" onClick={() => setConfirmingDelete(true)}>{i18n._({ id: "Delete song", message: "Delete song" })}</Button>
      </div>
      {confirmingDelete ? <DestructiveConfirm message={i18n._({ id: "{title, select, none {Delete this song?} other {Delete ‘{title}’?}}", message: "{title, select, none {Delete this song?} other {Delete ‘{title}’?}}", values: { title: song?.title || "none" } })} detail={i18n._({ id: "The song and all its versions move to Trash. You can bring them back from the Library for 30 days.", message: "The song and all its versions move to Trash. You can bring them back from the Library for 30 days." })} confirmLabel={i18n._({ id: "Delete song", message: "Delete song" })} busyLabel={i18n._({ id: "Deleting", message: "Deleting" })} busy={deleting} cancelLabel={i18n._({ id: "Keep it", message: "Keep it" })} onConfirm={removeSong} onCancel={() => setConfirmingDelete(false)} /> : null}
      {remixing && song && ready ? <Dialog open onOpenChange={(open) => { if (!open) setRemixing(false); }}><DialogContent size="xl" scroll="viewport">
        <DialogHeader><DialogTitle>{i18n._({ id: "{title, select, none {Remix this song} other {Remix ‘{title}’}}", message: "{title, select, none {Remix this song} other {Remix ‘{title}’}}", values: { title: song.title || "none" } })}</DialogTitle><DialogDescription>{i18n._({ id: "Say what to change. You see the request before anything is made, and the earlier version is kept.", message: "Say what to change. You see the request before anything is made, and the earlier version is kept." })}</DialogDescription></DialogHeader>
        <RemixSong card={song} onClose={() => setRemixing(false)} onSent={() => { void queryClient.invalidateQueries({ queryKey: ["music-song", id] }); void queryClient.invalidateQueries({ queryKey: ["music-songs"] }); }} />
      </DialogContent></Dialog> : null}
      <p className="text-muted-foreground text-xs">{reasonOff || `${i18n._({ id: "Splitting a song into stems may not be available on this Home yet.", message: "Splitting a song into stems may not be available on this Home yet." })} ${COVER_SONG_LINE()}`}</p>
    </div>
  </section>;
}

/** The prompt bar: the idea, one row of chips (what to make, lyrics, length, instrumental, styles) and one big Generate. Every chip shows its state; a control that cannot work says why. */
function GlassBar({ styles, onStyles, onMade, stylesOpen, onStylesOpen }: { styles: string[]; onStyles: (next: string[]) => void; onMade: (id: string) => void; stylesOpen: boolean; onStylesOpen: (open: boolean) => void }) {
  const { push } = useToast();
  const [make, setMake] = useState<Make>("song");
  const [idea, setIdea] = useState(""); const [lyrics, setLyrics] = useState(""); const [withLyrics, setWithLyrics] = useState(false);
  const [instrumental, setInstrumental] = useState(false); const [length, setLength] = useState<"quick" | "full" | "">(""); const [making, setMaking] = useState(false); const [problem, setProblem] = useState("");
  const status = useQuery({ queryKey: ["music-status"], queryFn: () => musicApi.status(), staleTime: 10_000, retry: false });
  const engineMissing = status.data ? !status.data.can_make : false;
  const ready = idea.trim().length >= 3 && !making && !engineMissing && !status.isPending;
  const toggleStyle = (name: string) => onStyles(styles.includes(name) ? styles.filter((one) => one !== name) : styles.length < 8 ? [...styles, name] : styles);
  const hint = engineMissing ? NO_MUSIC_ENGINE_LINE() : problem || (idea.trim().length < 3 ? i18n._({ id: "Say what the song is about to turn Generate on.", message: "Say what the song is about to turn Generate on." }) : i18n._({ id: "It takes about a minute. It shows up in your songs.", message: "It takes about a minute. It shows up in your songs." }));
  const create = () => {
    if (!ready) { if (!making) push(hint); return; }
    setMaking(true); setProblem("");
    musicApi.makeSong(makeSongBody({ idea: styles.length ? `${idea.trim()} Style: ${styles.join(", ")}.` : idea, lyrics: withLyrics && !instrumental ? lyrics : "", instrumental, title: "", length, bpm: "", key: "", styleId: null, bandId: null }))
      .then((card) => { setIdea(""); setLyrics(""); onStyles([]); onMade(card.id); })
      .catch((error: unknown) => { const line = text(error, i18n._({ id: "Home could not start the song. Check the request and try again.", message: "Home could not start the song. Check the request and try again." })); setProblem(line); push(line); })
      .finally(() => setMaking(false));
  };
  return <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 sm:bg-card sm:rounded-3xl sm:p-4" data-testid="music-docked-bar" id="music-bar">
    <div className={make === "song" ? "h-32 min-h-0 overflow-y-auto" : "h-80 min-h-0 overflow-y-auto"} data-testid="music-bar-body">
    {make === "sound" ? <SoundMaker onMade={onMade} /> : make === "voice" ? <VoiceCreate /> : make !== "song" ? <CreatePage kind={make} adult /> : <div className="flex flex-col gap-2">
      <textarea aria-label={i18n._({ id: "Describe your song", message: "Describe your song" })} rows={2} maxLength={1200} value={idea} onChange={(event) => setIdea(event.currentTarget.value)} placeholder={i18n._({ id: "Describe any song idea: a dreamy indie pop song about new beginnings...", message: "Describe any song idea: a dreamy indie pop song about new beginnings..." })}
        className="placeholder:text-muted-foreground w-full resize-none bg-transparent p-1 text-base outline-none" />
      {withLyrics && !instrumental ? <textarea aria-label={i18n._({ id: "Lyrics", message: "Lyrics" })} rows={4} maxLength={4000} value={lyrics} onChange={(event) => setLyrics(event.currentTarget.value)} placeholder={i18n._({ id: "Write your own words with [Verse] and [Chorus] tags, or leave this empty and Home writes them.", message: "Write your own words with [Verse] and [Chorus] tags, or leave this empty and Home writes them." })}
        className="placeholder:text-muted-foreground bg-muted/40 w-full resize-none rounded-xl p-3 text-sm outline-none" /> : null}
    {stylesOpen ? <div className="flex flex-wrap gap-2" role="group" aria-label={i18n._({ id: "Styles", message: "Styles" })} data-testid="music-styles-panel">
      {STARTER_STYLES.map((name) => <Chip key={name} selected={styles.includes(name)} onClick={() => toggleStyle(name)}>{name}</Chip>)}
    </div> : null}
    </div>}
    </div>
    <div className="no-scrollbar -mx-4 flex items-center gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="group" aria-label={i18n._({ id: "What to make", message: "What to make" })}>
      {MAKES().map((one) => <Chip key={one.id} selected={make === one.id} onClick={() => setMake(one.id)}>{one.label}</Chip>)}
      {make === "song" ? <>
        <Chip selected={withLyrics && !instrumental} onClick={() => { if (!instrumental) setWithLyrics(!withLyrics); }}>{i18n._({ id: "Lyrics", message: "Lyrics" })}</Chip>
        <Chip selected={instrumental} onClick={() => setInstrumental(!instrumental)}>{i18n._({ id: "Instrumental", message: "Instrumental" })}</Chip>
        <Chip selected={length === "quick"} onClick={() => setLength(length === "quick" ? "" : "quick")}>{i18n._({ id: "Quick", message: "Quick" })}</Chip>
        <Chip selected={length === "full"} onClick={() => setLength(length === "full" ? "" : "full")}>{i18n._({ id: "Full", message: "Full" })}</Chip>
        <Chip selected={stylesOpen || styles.length > 0} onClick={() => onStylesOpen(!stylesOpen)}>{styles.length ? i18n._({ id: "Styles ({count})", message: "Styles ({count})", values: { count: styles.length } }) : i18n._({ id: "Styles", message: "Styles" })}</Chip>
      </> : null}
    </div>
    <div className={make === "song" ? "flex flex-wrap items-center justify-between gap-3" : "invisible flex"} aria-hidden={make !== "song"}>
      <p role={problem || engineMissing ? "alert" : "status"} data-testid={engineMissing ? "music-no-engine" : "music-hint"} className="text-muted-foreground w-full text-xs sm:w-auto sm:min-w-0 sm:flex-1">{hint}</p>
      <span className="text-muted-foreground text-xs sm:ml-auto" data-testid="music-engine-chip">{status.data?.engine_ready ? i18n._({ id: "Music model: ready", message: "Music model: ready" }) : i18n._({ id: "Music model: not running", message: "Music model: not running" })}</span>
      <Button type="button" size="lg" aria-disabled={!ready} variant={ready ? "default" : "secondary"} onClick={create} title={hint}>{making ? i18n._({ id: "Starting", message: "Starting" }) : i18n._({ id: "Generate", message: "Generate" })}</Button>
    </div>
  </div>;
}

/** The top of Create: a readable headline, the prompt bar, and nothing drawn behind the text. */
function Hero({ styles, onStyles, onMade, stylesOpen, onStylesOpen }: { styles: string[]; onStyles: (next: string[]) => void; onMade: (id: string) => void; stylesOpen: boolean; onStylesOpen: (open: boolean) => void }) {
  return <div className="flex shrink-0 flex-col gap-6 pt-4 sm:pt-8" data-testid="music-hero">
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-2">
      <h1 className="text-title font-semibold tracking-tight">{i18n._({ id: "Make any song", message: "Make any song" })}</h1>
      <p className="text-supporting text-muted-foreground max-w-xl">{i18n._({ id: "Describe it, pick a sound, press Generate. Your songs, bands and albums stay on this Home.", message: "Describe it, pick a sound, press Generate. Your songs, bands and albums stay on this Home." })}</p>
    </div>
    <GlassBar styles={styles} onStyles={onStyles} onMade={onMade} stylesOpen={stylesOpen} onStylesOpen={onStylesOpen} />
  </div>;
}

/** The Create home. `search` is the address's query string: `song` opens a song. */
export function MusicWorkspace({ adult, search }: { adult: boolean; search: string }) {
  const navigate = useNavigate();
  const { push } = useToast();
  const [styles, setStyles] = useState<string[]>([]);
  const [stylesOpen, setStylesOpen] = useState(false);
  const queryClient = useQueryClient();
  const [addingSound, setAddingSound] = useState<string | null>(null);
  const song = new URLSearchParams(search).get("song");
  const sounds = useQuery({ queryKey: ["music-sounds"], queryFn: () => musicApi.listSounds(), staleTime: 2000 });
  const { shown, list } = useShown("");
  const openedCard = useQuery({ queryKey: ["music-song", song], queryFn: ({ signal }) => musicApi.card(song!, signal), enabled: !!song, staleTime: 0, refetchInterval: query => query.state.data && active(query.state.data) ? 2000 : false });
  const soundPlaceholder: MusicCard = { id: song ?? "sound-pending", task: "sound", state: "queued", stage: null, stage_label: i18n._({ id: "Making the sound", message: "Making the sound" }), stages: [], stage_index: 0, progress: 0, eta_seconds: null, position: null, error_line: null, cover_url: null, cover_versions: [], sound: { loop: false, surprise: false }, cover_pending: false, versions: [], current_id: null, length: "quick", quality: "quick", boost_offered: false, cut: null, max_seconds: null, title: null, description: null, lyrics: null, timed_lyrics: null, duration_s: null, started_at: Date.now() };
  const openedTrackProps = useMusicTrackProps({ card: openedCard.data?.sound ? openedCard.data : soundPlaceholder, navigate, onRefresh: () => { void openedCard.refetch(); } });
  const pickSound = (name: string) => {
    const on = styles.includes(name);
    setStyles(on ? styles.filter((one) => one !== name) : [...styles, name].slice(0, 8));
    setStylesOpen(true);
    push(on ? i18n._({ id: "{name} taken out of the bar.", message: "{name} taken out of the bar.", values: { name } }) : i18n._({ id: "{name} added to the bar. Describe your song, then press Generate.", message: "{name} added to the bar. Describe your song, then press Generate.", values: { name } }));
    document.getElementById("music-bar")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  if (!adult) return <EmptyState icon="music" text={MAKE_SONG_ADULT_LINE()} />;
  const open = (id: string | null) => navigate(songAddress(id), { replace: true });
  return <>{song && openedCard.data?.sound ? <MusicTrack {...openedTrackProps} /> : null}<AddSoundToSong jobId={addingSound} open={addingSound !== null} onOpenChange={open => { if (!open) setAddingSound(null); }} songs={list.data ?? []} onAdded={id => { void queryClient.invalidateQueries({ queryKey: ["music-songs"] }); void queryClient.invalidateQueries({ queryKey: ["music-song", id] }); }} /><div className="flex min-h-0 flex-1 flex-col"><section className="bg-background text-foreground flex min-h-0 flex-1 flex-col gap-10 overflow-y-auto px-4 py-4 lg:rounded-3xl lg:px-6" data-testid="music-workspace">
    {song && openedCard.data?.sound ? <div className="flex shrink-0 flex-col gap-3" data-testid="opened-sound">
      {openedCard.data.state === "done" ? <div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" onClick={() => setAddingSound(openedCard.data!.id)}>{i18n._({ id: "Add to a song", message: "Add to a song" })}</Button></div> : null}
      {openedCard.data.sound.takes ? <SoundTakes group={openedCard.data.sound.takes.group} onChanged={() => { void openedCard.refetch(); }} /> : null}
    </div> : null}
    {song ? <BringSong adult={adult} /> : null}
    {song && !openedCard.data?.sound ? <SongDetail key={song} id={song} remix={new URLSearchParams(search).get("remix") === "1"} onClose={() => open(null)} /> : null}
    <Hero styles={styles} onStyles={setStyles} onMade={open} stylesOpen={stylesOpen} onStylesOpen={setStylesOpen} />
    <div className="flex shrink-0 flex-col gap-3" data-testid="music-your-songs">
      <div className="flex flex-col gap-1"><h2 className="text-section font-semibold tracking-tight">{i18n._({ id: "Your songs", message: "Your songs" })}</h2><p className="text-muted-foreground text-sm">{i18n._({ id: "Open one to play it and see everything you can do.", message: "Open one to play it and see everything you can do." })}</p></div>
      {shown.some(card => !card.sound) ? <ul className="flex list-none flex-wrap gap-x-4 gap-y-6 p-0" aria-label={i18n._({ id: "Your songs", message: "Your songs" })}>
        {shown.filter(card => !card.sound).map((card) => songTile({ card, selected: card.id === song, onOpen: () => open(card.id), actions: TILE_ACTIONS(card) }))}
      </ul> : <AsyncState data={list.data} error={list.isError} isFetching={list.isFetching} onRetry={() => void list.refetch()} errorMessage={i18n._({ id: "Your songs could not be loaded. Check your connection and open this page again.", message: "Your songs could not be loaded. Check your connection and open this page again." })} loadingLabel={i18n._({ id: "Loading your songs", message: "Loading your songs" })}>
        {() => <p className="text-muted-foreground bg-card rounded-2xl p-6 text-sm" data-testid="music-songs-empty">{i18n._({ id: "No songs yet. Describe one in the bar above and press Generate. It shows up here.", message: "No songs yet. Describe one in the bar above and press Generate. It shows up here." })}</p>}
      </AsyncState>}
    </div>
    <MediaCarousel title={i18n._({ id: "Your sounds", message: "Your sounds" })} line={i18n._({ id: "Sounds you have saved.", message: "Sounds you have saved." })} label={i18n._({ id: "Your sounds", message: "Your sounds" })}>
      {!sounds.data ? <li className="text-muted-foreground text-base"><AsyncState data={sounds.data} error={sounds.isError} isFetching={sounds.isFetching} onRetry={() => void sounds.refetch()} errorMessage={i18n._({ id: "Your sounds could not be loaded.", message: "Your sounds could not be loaded." })} loadingLabel={i18n._({ id: "Loading your sounds", message: "Loading your sounds" })}>{() => null}</AsyncState></li> : sounds.data.length === 0 ? <li className="text-muted-foreground text-base" data-testid="music-sounds-empty">{i18n._({ id: "No sounds yet. Describe one in the bar above and press Generate.", message: "No sounds yet. Describe one in the bar above and press Generate." })}</li> : sounds.data.map(sound => <MediaTile key={sound.id} id={sound.id} title={sound.title} line={`${sound.duration_s}s${sound.loop ? i18n._({ id: " · Loop", message: " · Loop" }) : ""}`} coverUrl={null} playable onOpen={() => { const audio = new Audio(sound.src); audio.loop = sound.loop; void audio.play(); }}>{sound.job_id ? <div className="flex flex-wrap gap-1"><Button size="sm" variant="secondary" onClick={() => setAddingSound(sound.job_id ?? null)}>{i18n._({ id: "Add to a song", message: "Add to a song" })}</Button></div> : null}</MediaTile>)}
    </MediaCarousel>
    <MediaCarousel title={i18n._({ id: "Start from a sound", message: "Start from a sound" })} line={i18n._({ id: "Pick one and it goes into the bar above.", message: "Pick one and it goes into the bar above." })} label={i18n._({ id: "Starter sounds", message: "Starter sounds" })}>
      {STARTER_STYLES.map((name) => <MediaTile key={name} id={name} title={name} coverUrl={null} verb={styles.includes(name) ? i18n._({ id: "Remove", message: "Remove" }) : i18n._({ id: "Use", message: "Use" })} selected={styles.includes(name)} onOpen={() => pickSound(name)} />)}
    </MediaCarousel>
    {/* The tools as feature cards: a picture on top, two lines under it. */}
    <MediaCarousel title={i18n._({ id: "Tools", message: "Tools" })} line={i18n._({ id: "Everything you can do with a song.", message: "Everything you can do with a song." })} label={i18n._({ id: "Tools", message: "Tools" })}>
    {TOOLS().map((tool) => <li key={tool.label} className="group w-64 shrink-0 snap-start sm:w-72"><Link to={tool.to} className="flex flex-col gap-3">
      <span className="block aspect-video w-full overflow-hidden rounded-2xl transition duration-200 motion-safe:group-hover:-translate-y-1"><Cover id={`tool-${tool.label}`} title={tool.label} url={null} /></span>
      <span className="text-muted-foreground text-sm">{tool.line}</span></Link></li>)}
  </MediaCarousel>
  </section></div></>;
}

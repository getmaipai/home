// MUSIC-WORKSPACE-02: the Music app's Create home, in the look of a modern creator app. A near-black page with a lime accent (kit tokens only):
// bold section headers, a row of tool tiles (Studio, Stems, Remix, Extend, Cover), a strip of starter styles, a big gallery of the songs you made
// (cover art, a play button on hover, live progress while one is being made) and a prompt bar docked at the bottom with the mode chips (Song, Band,
// Album, Style), style chips, a lyrics switch and the Create button. Picking a song opens it above the gallery with every action as a visible
// button; one the engine cannot do is turned off with its plain reason. The same gallery serves the Studio, Stems and Remix pages (`SongGallery`).
// Every change made here has its edit card in chat (the edit_* actions), so a change is one change to one record.
import { useMemo, useState, type CSSProperties } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { Label } from "@maipai/ui/src/ui/label";
import { Switch } from "@maipai/ui/src/ui/switch";
import { Textarea } from "@maipai/ui/src/ui/textarea";
import { Chip } from "@maipai/ui/src/primitives/Chip";
import { EmptyState } from "@maipai/ui/src/primitives/EmptyState";
import { useToast } from "@maipai/ui/src/primitives/Toast";
import { Alert, AlertDescription } from "@maipai/ui/src/ui/alert";
import { SongResult, MAKE_SONG_ADULT_LINE, NO_MUSIC_ENGINE_LINE, makeSongBody } from "./MakeSongPage";
import { CreatePage } from "./MusicStudioPages";
import { getIcon } from "@maipai/ui/src/icons";
import { requestJson } from "@/lib/api";
import { musicApi, type MusicCard } from "@/lib/musicApi";

type Make = "song" | "band" | "album" | "song_style";
const MAKES: Array<{ id: Make; label: string }> = [{ id: "song", label: "Song" }, { id: "band", label: "Band" }, { id: "album", label: "Album" }, { id: "song_style", label: "Style" }];
const STARTER_STYLES = ["Dreamy indie pop", "Lo-fi beats", "Cinematic score", "Upbeat funk", "Acoustic folk", "Synthwave", "Jazz ballad", "Epic orchestral"];
const PlayIcon = getIcon("play");
const active = (card: MusicCard): boolean => card.state === "queued" || card.state === "running";
const clock = (seconds: number | null): string => (seconds && seconds > 0 ? `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}` : "");
const text = (error: unknown, fallback: string): string => (error instanceof Error && error.message ? error.message : fallback);

export const STEMS_LINE = "Splitting a song into stems is not available on this Home yet.";
export const COVER_SONG_LINE = "Covering a song in a new voice needs an uploaded recording, which Home does not accept yet.";
export const songAddress = (id: string | null): string => (id ? `/apps/music/create?song=${encodeURIComponent(id)}` : "/apps/music/create");
export const studioAddress = (id: string): string => `/apps/music/studio?song=${encodeURIComponent(id)}`;
export const stemsAddress = (id: string): string => `/apps/music/studio?song=${encodeURIComponent(id)}&split=1`;
/** The chat that edits a song: the same edit_* actions the card uses, started with the song's name. */
export const editInChatAddress = (card: MusicCard, what: string): string => `/chat?ask=${encodeURIComponent(`${what} my song "${card.title ?? "Untitled song"}" (maipai://music/track/${card.id}).`)}`;

/** What a tile says under the title: how far along it is, or its sound. */
export function songLine(card: MusicCard): string {
  if (active(card)) return card.position ? `Waiting, number ${card.position} in line` : `${card.stage_label || "Making your song"}${card.progress > 0 ? ` ${Math.round(card.progress * 100)}%` : ""}`;
  if (card.state === "failed") return card.error_line ?? "This song could not be made. Open it to try again.";
  if (card.state === "cancelled") return "Stopped";
  return card.description ?? "";
}

function useSongs() {
  return useQuery({
    queryKey: ["music-songs"], queryFn: () => requestJson<MusicCard[]>("/api/music/jobs"), staleTime: 2_000,
    refetchInterval: (query) => (query.state.data?.some(active) ? 3000 : 20_000),
  });
}

/** One big tile: cover art, a play button on hover, progress while it is made, and the quick actions as visible buttons. */
function SongTile({ card, selected, onOpen, actions }: { card: MusicCard; selected: boolean; onOpen: () => void; actions: Array<{ label: string; to: string }> }) {
  const title = card.title ?? (active(card) ? "Making your song" : "Untitled song");
  const length = card.state === "done" ? clock(card.duration_s) : "";
  return <li className="group flex min-w-0 flex-col gap-2" data-testid="music-song-tile">
    <button type="button" onClick={onOpen} aria-label={`Open ${title}`} aria-current={selected ? "true" : undefined}
      className={`bg-card relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-2xl border-2 transition-colors ${selected ? "border-(--accent-lime)" : "border-transparent hover:border-(--accent-lime)/60"}`}>
      {card.cover_url ? <img src={card.cover_url} alt="" className="size-full object-cover" /> : <span aria-hidden="true" className="text-muted-foreground text-5xl font-semibold">{title.slice(0, 1).toUpperCase()}</span>}
      {card.state === "done" ? <span className="bg-(--accent-lime) text-background absolute right-3 bottom-3 flex size-12 items-center justify-center rounded-full opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"><PlayIcon className="size-5" aria-hidden="true" /></span> : null}
      {length ? <span className="bg-background/80 absolute top-3 right-3 rounded-full px-2 py-0.5 text-xs tabular-nums">{length}</span> : null}
      {active(card) ? <span className="bg-background/70 absolute inset-x-0 bottom-0 h-2"><span className="bg-(--accent-lime) block h-full w-(--song-progress)" style={{ "--song-progress": `${Math.max(6, Math.round(card.progress * 100))}%` } as CSSProperties} /></span> : null}
    </button>
    <div className="min-w-0"><p className="truncate text-sm font-semibold">{title}</p><p className="text-muted-foreground truncate text-xs">{songLine(card)}</p></div>
    {card.state === "done" ? <div className="flex flex-wrap gap-1">{actions.map((one) => <Button key={one.label} asChild size="sm" variant="outline"><Link to={one.to}>{one.label}</Link></Button>)}</div> : null}
  </li>;
}

const TILE_ACTIONS = (card: MusicCard): Array<{ label: string; to: string }> => [
  { label: "Studio", to: studioAddress(card.id) }, { label: "Stems", to: stemsAddress(card.id) }, { label: "Remix", to: editInChatAddress(card, "Remix") },
];

/** The gallery of the person's songs. `actionsFor` decides what each tile offers; `onOpen` what a click does. */
export function SongGallery({ selected, onOpen, actionsFor = TILE_ACTIONS, empty }: { selected: string | null; onOpen: (card: MusicCard) => void; actionsFor?: (card: MusicCard) => Array<{ label: string; to: string }>; empty?: string }) {
  const [filter, setFilter] = useState("");
  const list = useSongs();
  const shown = useMemo(() => (list.data ?? []).filter((card) => !filter.trim() || `${card.title ?? ""} ${card.description ?? ""}`.toLowerCase().includes(filter.trim().toLowerCase())), [list.data, filter]);
  return <div className="flex min-h-0 flex-col gap-4" data-testid="music-song-list">
    <div className="max-w-sm"><Input type="search" aria-label="Search your songs" placeholder="Search your songs" value={filter} onChange={(event) => setFilter(event.currentTarget.value)} /></div>
    {list.isPending ? <p role="status" className="text-muted-foreground text-sm">Loading your songs</p>
      : list.isError ? <p role="alert" className="text-muted-foreground text-sm">Your songs could not be loaded. Check your connection and open this page again.</p>
        : shown.length === 0 ? <EmptyState icon="music" text={filter.trim() ? "No song matches that." : (empty ?? "No songs yet. Describe one in the bar below and press Create.")} />
          : <ul className="grid list-none grid-cols-2 gap-4 p-0 md:grid-cols-3 xl:grid-cols-5" aria-label="Your songs">{shown.map((card) => <SongTile key={card.id} card={card} selected={card.id === selected} onOpen={() => onOpen(card)} actions={actionsFor(card)} />)}</ul>}
  </div>;
}

function Header({ children, line }: { children: string; line?: string }) {
  return <div className="flex flex-col gap-1"><h2 className="text-xl font-black tracking-wide uppercase">{children}</h2>{line ? <p className="text-muted-foreground text-sm">{line}</p> : null}</div>;
}

const TOOLS = [
  { label: "Studio", line: "Tracks, waveforms, mute and solo", to: "/apps/music/studio" },
  { label: "Stems", line: "Vocals, drums, bass, other", to: "/apps/music/stems" },
  { label: "Remix", line: "Change a song in chat", to: "/apps/music/remix" },
  { label: "Extend", line: "Make it full or quick", to: "/apps/music/remix" },
  { label: "Cover", line: "New cover art", to: "/apps/music/remix" },
];

function ToolTiles() {
  return <ul className="grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3 lg:grid-cols-5" aria-label="Tools">
    {TOOLS.map((tool) => <li key={tool.label}><Link to={tool.to} className="bg-card hover:border-(--accent-lime) flex h-full flex-col gap-1 rounded-2xl border-2 border-transparent p-4 transition-colors"><span className="text-sm font-black tracking-wide uppercase">{tool.label}</span><span className="text-muted-foreground text-xs">{tool.line}</span></Link></li>)}
  </ul>;
}

/** The song opened above the gallery: the kit card plus every action as a button, each one off with its reason when it cannot run. */
function SongDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { push } = useToast();
  const queryClient = useQueryClient();
  const card = useQuery({ queryKey: ["music-song", id], queryFn: ({ signal }) => musicApi.card(id, signal), staleTime: 0 });
  const song = card.data;
  const ready = song?.state === "done" && song.versions.length > 0;
  const version = song ? (song.versions.find((one) => one.id === song.current_id) ?? song.versions.at(-1)) : undefined;
  const again = (length: "quick" | "full") => { void musicApi.setLength(id, length).then(() => { push(length === "full" ? "Making the full version. It appears on this song." : "Making the quick version. It appears on this song."); void queryClient.invalidateQueries({ queryKey: ["music-song", id] }); }).catch((error: unknown) => push(text(error, "That could not start. Try again."))); };
  const newCover = () => { void musicApi.newCover(id, `Album cover art for the song "${song?.title ?? "Untitled song"}"`).then(() => { push("Making a new cover."); void queryClient.invalidateQueries({ queryKey: ["music-song", id] }); }).catch((error: unknown) => push(text(error, "A new cover could not start. Try again."))); };
  const reasonOff = ready ? "" : "Available once the song is finished.";
  return <section className="bg-card flex flex-col gap-4 rounded-3xl p-4" data-testid="music-song-result" aria-label="Open song">
    <div className="flex items-center justify-between gap-3"><Header>Now open</Header><Button type="button" variant="ghost" size="sm" onClick={onClose}>Close</Button></div>
    <SongResult key={id} id={id} onAnother={onClose} />
    <div className="flex flex-col gap-2" data-testid="music-song-actions">
      <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">Everything you can do with this song</p>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" disabled={!ready}><Link to={studioAddress(id)} aria-disabled={!ready}>Open in Studio</Link></Button>
        <Button asChild variant="outline" disabled={!ready}><Link to={stemsAddress(id)} aria-disabled={!ready}>Extract stems</Link></Button>
        {song ? <Button asChild variant="outline" disabled={!ready}><Link to={editInChatAddress(song, "Remix")} aria-disabled={!ready}>Remix or edit</Link></Button> : null}
        <Button type="button" variant="outline" disabled={!ready} onClick={() => again(song?.length === "full" ? "quick" : "full")}>{song?.length === "full" ? "Make it quick" : "Extend to full"}</Button>
        <Button type="button" variant="outline" disabled={!ready} onClick={newCover}>New cover art</Button>
        {song ? <Button asChild variant="outline" disabled={!ready}><Link to={editInChatAddress(song, "Change the lyrics of")} aria-disabled={!ready}>Edit lyrics</Link></Button> : null}
        {version ? <Button asChild variant="outline"><a href={version.url} download>Download</a></Button> : <Button type="button" variant="outline" disabled>Download</Button>}
        <Button type="button" variant="outline" disabled>Cover with a new voice</Button>
      </div>
      <p className="text-muted-foreground text-xs">{reasonOff || `Stems: ${STEMS_LINE.replace("is not available", "may not be available")} ${COVER_SONG_LINE}`}</p>
    </div>
  </section>;
}

/** The docked prompt bar: mode chips, style chips, a lyrics switch and Create. A band, an album or a style opens its own form above the bar. */
function DockedBar({ onMade }: { onMade: (id: string) => void }) {
  const { push } = useToast();
  const [make, setMake] = useState<Make>("song");
  const [idea, setIdea] = useState(""); const [lyrics, setLyrics] = useState(""); const [withLyrics, setWithLyrics] = useState(false);
  const [instrumental, setInstrumental] = useState(false); const [styles, setStyles] = useState<string[]>([]); const [making, setMaking] = useState(false); const [problem, setProblem] = useState("");
  const status = useQuery({ queryKey: ["music-status"], queryFn: () => musicApi.status(), staleTime: 10_000, retry: false });
  const engineMissing = status.data ? !status.data.can_make : false;
  const ready = idea.trim().length >= 3 && !making && !engineMissing && !status.isPending;
  const toggleStyle = (name: string) => setStyles((now) => (now.includes(name) ? now.filter((one) => one !== name) : now.length < 8 ? [...now, name] : now));
  const create = () => {
    if (!ready) return;
    setMaking(true); setProblem("");
    musicApi.makeSong(makeSongBody({ idea: styles.length ? `${idea.trim()} Style: ${styles.join(", ")}.` : idea, lyrics: withLyrics && !instrumental ? lyrics : "", instrumental, title: "", length: "", bpm: "", key: "", styleId: null, bandId: null }))
      .then((card) => { setIdea(""); setLyrics(""); setStyles([]); onMade(card.id); })
      .catch((error: unknown) => { const line = text(error, "Home could not start the song. Check the request and try again."); setProblem(line); push(line); })
      .finally(() => setMaking(false));
  };
  return <div className="bg-card/95 sticky shrink-0 bottom-20 z-10 md:bottom-0 flex max-h-96 flex-col gap-3 overflow-y-auto rounded-t-3xl border-t p-4 backdrop-blur" data-testid="music-docked-bar">
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="What to make">
      {MAKES.map((one) => <Chip key={one.id} selected={make === one.id} onClick={() => setMake(one.id)}>{one.label}</Chip>)}
    </div>
    {make !== "song" ? <div className="min-h-0 overflow-y-auto"><CreatePage kind={make} adult /></div> : <>
      {engineMissing ? <Alert role="alert" data-testid="music-no-engine"><AlertDescription>{NO_MUSIC_ENGINE_LINE}</AlertDescription></Alert> : null}
      <Textarea aria-label="Describe your song" rows={2} maxLength={1200} value={idea} onChange={(event) => setIdea(event.currentTarget.value)} placeholder="A dreamy indie pop song about new beginnings, with warm guitar and an upbeat tempo" />
      {withLyrics && !instrumental ? <Textarea aria-label="Lyrics" rows={4} maxLength={4000} value={lyrics} onChange={(event) => setLyrics(event.currentTarget.value)} placeholder="Write your own words with [Verse] and [Chorus] tags, or leave this empty and Home writes them." /> : null}
      <div className="flex gap-2 overflow-x-auto" role="group" aria-label="Styles">{STARTER_STYLES.map((name) => <Chip key={name} selected={styles.includes(name)} onClick={() => toggleStyle(name)}>{name}</Chip>)}</div>
      <div className="flex flex-wrap items-center gap-4">
        <span className="text-muted-foreground bg-muted rounded-full px-3 py-1 text-xs" data-testid="music-engine-chip">{status.data?.engine_ready ? "Music model: ready" : "Music model: not running"}</span>
        <div className="flex items-center gap-2"><Switch id="bar-lyrics" checked={withLyrics} onCheckedChange={setWithLyrics} disabled={instrumental} /><Label htmlFor="bar-lyrics">Lyrics</Label></div>
        <div className="flex items-center gap-2"><Switch id="bar-instrumental" checked={instrumental} onCheckedChange={setInstrumental} /><Label htmlFor="bar-instrumental">Instrumental</Label></div>
        <div className="ml-auto"><Button type="button" size="lg" disabled={!ready} onClick={create}>{making ? "Starting" : "Create"}</Button></div>
      </div>
      {problem ? <Alert variant="destructive"><AlertDescription>{problem}</AlertDescription></Alert> : null}
      <p className="text-muted-foreground text-xs">{idea.trim().length < 3 ? "Say what the song is about to start." : "It takes about a minute. It shows up in the gallery."}</p>
    </>}
  </div>;
}

/** The Create home. `search` is the address's query string: `song` opens a song. */
export function MusicWorkspace({ adult, search }: { adult: boolean; search: string }) {
  const navigate = useNavigate();
  const song = new URLSearchParams(search).get("song");
  if (!adult) return <EmptyState icon="music" text={MAKE_SONG_ADULT_LINE} />;
  const open = (id: string | null) => navigate(songAddress(id), { replace: true });
  const lime = { "--accent-lime": "var(--hue-yellow)", "--primary": "var(--hue-yellow)", "--primary-foreground": "var(--background)" } as CSSProperties;
  return <section className="dark bg-background text-foreground -mx-4 flex min-h-0 flex-1 flex-col overflow-y-auto gap-8 px-4 pt-4 lg:mx-0 lg:rounded-3xl lg:px-6" style={lime} data-testid="music-workspace">
    <h1 className="text-4xl font-black tracking-tight uppercase">Create</h1>
    {song ? <SongDetail key={song} id={song} onClose={() => open(null)} /> : null}
    <div className="flex flex-col gap-3"><Header line="Everything you can do with a song.">Tools</Header><ToolTiles /></div>
    <div className="flex flex-col gap-3"><Header line="Sounds to start from. Pick the same ones in the bar below.">Explore</Header>
      <ul className="flex list-none gap-3 overflow-x-auto p-0" aria-label="Starter styles">{STARTER_STYLES.map((name) => <li key={name} className="bg-card shrink-0 rounded-2xl px-5 py-4 text-sm font-semibold">{name}</li>)}</ul>
    </div>
    <div className="flex flex-col gap-3"><Header>My creations</Header><SongGallery selected={song} onOpen={(card) => open(card.id)} /></div>
    <DockedBar onMade={(id) => open(id)} />
  </section>;
}

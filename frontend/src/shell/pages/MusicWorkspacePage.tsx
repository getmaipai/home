// MUSIC-WORKSPACE-03: the Music app's Create home, in the look of a modern creator app. A black page with a lime accent (kit tokens only): a hero
// panel of covers with a headline and a floating glass prompt bar (mode, style, engine, lyrics, length and instrumental chips, and one big Generate
// button), then carousels of your songs, starter sounds and the tools, every tile with a cover (a real one, or one drawn from the song's id).
// Picking a song opens it above the rows with every action as a visible button; one the engine cannot do is turned off with its plain reason.
// The same tiles serve the Studio, Stems and Remix pages (`SongGallery`).
// Every change made here has its edit card in chat (the edit_* actions), so a change is one change to one record.
import { useMemo, useState, type CSSProperties } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { Chip } from "@maipai/ui/src/primitives/Chip";
import { EmptyState } from "@maipai/ui/src/primitives/EmptyState";
import { useToast } from "@maipai/ui/src/primitives/Toast";
import { SongResult, MAKE_SONG_ADULT_LINE, NO_MUSIC_ENGINE_LINE, makeSongBody } from "./MakeSongPage";
import { CreatePage } from "./MusicStudioPages";
import { Carousel, Cover, GlassPill, MediaTile } from "./MusicCreateUi";
import { requestJson } from "@/lib/api";
import { musicApi, type MusicCard } from "@/lib/musicApi";

type Make = "song" | "band" | "album" | "song_style";
const MAKES: Array<{ id: Make; label: string }> = [{ id: "song", label: "Song" }, { id: "band", label: "Band" }, { id: "album", label: "Album" }, { id: "song_style", label: "Style" }];
const STARTER_STYLES = ["Dreamy indie pop", "Lo-fi beats", "Cinematic score", "Upbeat funk", "Acoustic folk", "Synthwave", "Jazz ballad", "Epic orchestral"];
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


/** One song as a tile: its cover, glass pills for length and state, and the quick actions as visible buttons. */
function SongTile({ card, selected, onOpen, actions }: { card: MusicCard; selected: boolean; onOpen: () => void; actions: Array<{ label: string; to: string }> }) {
  const title = card.title ?? (active(card) ? "Making your song" : "Untitled song");
  const length = card.state === "done" ? clock(card.duration_s) : "";
  return <MediaTile id={card.id} title={title} line={songLine(card)} coverUrl={card.cover_url} selected={selected} busy={active(card)} playable={card.state === "done"} onOpen={onOpen}
    progress={active(card) ? card.progress : undefined} pills={<>{length ? <GlassPill>{length}</GlassPill> : null}{active(card) ? <GlassPill>Making</GlassPill> : null}</>}>
    {card.state === "done" ? <div className="flex flex-wrap gap-1">{actions.map((one) => <Button key={one.label} asChild size="sm" variant="secondary"><Link to={one.to}>{one.label}</Link></Button>)}</div> : null}
  </MediaTile>;
}

const TILE_ACTIONS = (card: MusicCard): Array<{ label: string; to: string }> => [
  { label: "Studio", to: studioAddress(card.id) }, { label: "Stems", to: stemsAddress(card.id) }, { label: "Remix", to: editInChatAddress(card, "Remix") },
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
    <div className="max-w-sm"><Input type="search" aria-label="Search your songs" placeholder="Search your songs" value={filter} onChange={(event) => setFilter(event.currentTarget.value)} /></div>
    {list.isPending ? <p role="status" className="text-muted-foreground text-sm">Loading your songs</p>
      : list.isError ? <p role="alert" className="text-muted-foreground text-sm">Your songs could not be loaded. Check your connection and open this page again.</p>
        : shown.length === 0 ? <EmptyState icon="music" text={filter.trim() ? "No song matches that." : (empty ?? "No songs yet. Describe one in the bar below and press Create.")} />
          : <ul className="flex list-none flex-wrap gap-4 p-0" aria-label="Your songs">{shown.map((card) => <SongTile key={card.id} card={card} selected={card.id === selected} onOpen={() => onOpen(card)} actions={actionsFor(card)} />)}</ul>}
  </div>;
}

const TOOLS = [
  { label: "Studio", line: "Tracks, waveforms, mute and solo for any song.", to: "/apps/music/studio" },
  { label: "Stems", line: "Split a song into vocals, drums, bass and the rest.", to: "/apps/music/stems" },
  { label: "Remix", line: "Describe a change and Home makes it, in chat.", to: "/apps/music/remix" },
  { label: "Extend", line: "Turn a quick song into a full one, or back.", to: "/apps/music/remix" },
  { label: "Cover art", line: "Ask for a new picture for any song.", to: "/apps/music/remix" },
];

/** The tools as feature cards: a picture on top, two lines under it. */
function ToolCards() {
  return <Carousel title="Tools" line="Everything you can do with a song." label="Tools">
    {TOOLS.map((tool) => <li key={tool.label} className="group w-64 shrink-0 snap-start sm:w-72"><Link to={tool.to} className="flex flex-col gap-3">
      <span className="block aspect-video w-full overflow-hidden rounded-2xl transition duration-200 motion-safe:group-hover:-translate-y-1"><Cover id={`tool-${tool.label}`} title={tool.label} url={null} /></span>
      <span className="text-muted-foreground text-sm">{tool.line}</span></Link></li>)}
  </Carousel>;
}

/** The song opened above the rows: its cover blurred into the background, the kit player, and every action as a button, each off with its reason. */
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
  return <section className="relative isolate flex flex-col gap-5 overflow-hidden rounded-3xl p-5 sm:p-8" data-testid="music-song-result" aria-label="Open song">
    <div aria-hidden="true" className="absolute inset-0 -z-10 scale-125 opacity-60 blur-3xl"><Cover id={id} title={song?.title ?? ""} url={song?.cover_url ?? null} /></div>
    <div aria-hidden="true" className="from-background/20 to-background absolute inset-0 -z-10 bg-linear-to-b" />
    <div className="flex items-start justify-between gap-3">
      <div className="flex flex-col gap-1"><p className="text-muted-foreground text-xs font-semibold tracking-widest uppercase">Now open</p><h2 className="text-4xl leading-none font-black tracking-tight uppercase sm:text-6xl">{song?.title ?? "Your song"}</h2></div>
      <Button type="button" variant="secondary" size="sm" onClick={onClose}>Close</Button>
    </div>
    <div className="bg-background/50 rounded-2xl p-4 backdrop-blur-xl"><SongResult key={id} id={id} onAnother={onClose} /></div>
    <div className="flex flex-col gap-2" data-testid="music-song-actions">
      <div className="flex flex-wrap gap-2">
        <Button asChild disabled={!ready}><Link to={studioAddress(id)} aria-disabled={!ready}>Open in Studio</Link></Button>
        <Button asChild variant="secondary" disabled={!ready}><Link to={stemsAddress(id)} aria-disabled={!ready}>Extract stems</Link></Button>
        {song ? <Button asChild variant="secondary" disabled={!ready}><Link to={editInChatAddress(song, "Remix")} aria-disabled={!ready}>Remix or edit</Link></Button> : null}
        <Button type="button" variant="secondary" disabled={!ready} onClick={() => again(song?.length === "full" ? "quick" : "full")}>{song?.length === "full" ? "Make it quick" : "Extend to full"}</Button>
        <Button type="button" variant="secondary" disabled={!ready} onClick={newCover}>New cover art</Button>
        {song ? <Button asChild variant="secondary" disabled={!ready}><Link to={editInChatAddress(song, "Change the lyrics of")} aria-disabled={!ready}>Edit lyrics</Link></Button> : null}
        {version ? <Button asChild variant="secondary"><a href={version.url} download>Download</a></Button> : <Button type="button" variant="secondary" disabled>Download</Button>}
        <Button type="button" variant="secondary" disabled>Cover with a new voice</Button>
      </div>
      <p className="text-muted-foreground text-xs">{reasonOff || `Stems: ${STEMS_LINE.replace("is not available", "may not be available")} ${COVER_SONG_LINE}`}</p>
    </div>
  </section>;
}

/** The floating glass prompt bar: the idea, then chips for what to make, its sound, the engine, lyrics, length and instrumental, and one big Generate. */
function GlassBar({ styles, onStyles, onMade }: { styles: string[]; onStyles: (next: string[]) => void; onMade: (id: string) => void }) {
  const { push } = useToast();
  const [make, setMake] = useState<Make>("song");
  const [idea, setIdea] = useState(""); const [lyrics, setLyrics] = useState(""); const [withLyrics, setWithLyrics] = useState(false);
  const [instrumental, setInstrumental] = useState(false); const [length, setLength] = useState<"quick" | "full" | "">(""); const [making, setMaking] = useState(false); const [problem, setProblem] = useState("");
  const status = useQuery({ queryKey: ["music-status"], queryFn: () => musicApi.status(), staleTime: 10_000, retry: false });
  const engineMissing = status.data ? !status.data.can_make : false;
  const ready = idea.trim().length >= 3 && !making && !engineMissing && !status.isPending;
  const toggleStyle = (name: string) => onStyles(styles.includes(name) ? styles.filter((one) => one !== name) : styles.length < 8 ? [...styles, name] : styles);
  const create = () => {
    if (!ready) return;
    setMaking(true); setProblem("");
    musicApi.makeSong(makeSongBody({ idea: styles.length ? `${idea.trim()} Style: ${styles.join(", ")}.` : idea, lyrics: withLyrics && !instrumental ? lyrics : "", instrumental, title: "", length, bpm: "", key: "", styleId: null, bandId: null }))
      .then((card) => { setIdea(""); setLyrics(""); onStyles([]); onMade(card.id); })
      .catch((error: unknown) => { const line = text(error, "Home could not start the song. Check the request and try again."); setProblem(line); push(line); })
      .finally(() => setMaking(false));
  };
  const hint = engineMissing ? NO_MUSIC_ENGINE_LINE : problem || (idea.trim().length < 3 ? "Say what the song is about to start." : "It takes about a minute. It shows up in your songs.");
  return <div className="bg-background/60 mx-auto flex w-full max-w-3xl flex-col gap-3 rounded-3xl p-4 shadow-2xl backdrop-blur-xl" data-testid="music-docked-bar">
    {make !== "song" ? <div className="max-h-96 min-h-0 overflow-y-auto"><CreatePage kind={make} adult /></div> : <>
      <textarea aria-label="Describe your song" rows={2} maxLength={1200} value={idea} onChange={(event) => setIdea(event.currentTarget.value)} placeholder="Describe any song idea: a dreamy indie pop song about new beginnings..."
        className="placeholder:text-muted-foreground w-full resize-none bg-transparent p-1 text-base outline-none" />
      {withLyrics && !instrumental ? <textarea aria-label="Lyrics" rows={4} maxLength={4000} value={lyrics} onChange={(event) => setLyrics(event.currentTarget.value)} placeholder="Write your own words with [Verse] and [Chorus] tags, or leave this empty and Home writes them."
        className="placeholder:text-muted-foreground bg-muted/40 w-full resize-none rounded-xl p-3 text-sm outline-none" /> : null}
    </>}
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="What to make">
      {MAKES.map((one) => <Chip key={one.id} selected={make === one.id} onClick={() => setMake(one.id)}>{one.label}</Chip>)}
      {make === "song" ? <>
        <Chip selected={withLyrics && !instrumental} onClick={() => { if (!instrumental) setWithLyrics(!withLyrics); }}>Lyrics</Chip>
        <Chip selected={instrumental} onClick={() => setInstrumental(!instrumental)}>Instrumental</Chip>
        <Chip selected={length === "quick"} onClick={() => setLength(length === "quick" ? "" : "quick")}>Quick</Chip>
        <Chip selected={length === "full"} onClick={() => setLength(length === "full" ? "" : "full")}>Full</Chip>
        <span className="text-muted-foreground bg-muted/60 rounded-full px-3 py-1 text-xs" data-testid="music-engine-chip">{status.data?.engine_ready ? "Music model: ready" : "Music model: not running"}</span>
        <div className="ml-auto shadow-primary/40 rounded-lg shadow-lg"><Button type="button" size="lg" disabled={!ready} onClick={create}>{making ? "Starting" : "Generate"}</Button></div>
      </> : null}
    </div>
    {make === "song" ? <>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Styles">{STARTER_STYLES.map((name) => <Chip key={name} selected={styles.includes(name)} onClick={() => toggleStyle(name)}>{name}</Chip>)}</div>
      <p role={engineMissing || problem ? "alert" : undefined} data-testid={engineMissing ? "music-no-engine" : undefined} className="text-muted-foreground text-xs">{hint}</p>
    </> : null}
  </div>;
}

/** The hero: a wall of covers (yours, or drawn ones) under a bold headline, with the glass prompt bar docked at its bottom. */
function Hero({ styles, onStyles, onMade }: { styles: string[]; onStyles: (next: string[]) => void; onMade: (id: string) => void }) {
  const { list } = useShown("");
  const mine = (list.data ?? []).filter((card) => card.state === "done").slice(0, 12);
  const wall = Array.from({ length: 12 }, (_, index) => mine[index] ?? null);
  return <div className="relative isolate flex min-h-144 flex-col justify-between gap-8 overflow-hidden rounded-3xl p-4 sm:p-8" data-testid="music-hero">
    <div aria-hidden="true" className="absolute inset-0 -z-10 grid grid-cols-3 gap-1 sm:grid-cols-4 lg:grid-cols-6">
      {wall.map((card, index) => <div key={card?.id ?? index} className="overflow-hidden"><Cover id={card?.id ?? STARTER_STYLES[index % STARTER_STYLES.length] ?? `wall-${index}`} title={card?.title ?? STARTER_STYLES[index % STARTER_STYLES.length] ?? ""} url={card?.cover_url ?? null} bare /></div>)}
    </div>
    <div aria-hidden="true" className="from-background/30 via-background/50 to-background absolute inset-0 -z-10 bg-linear-to-b" />
    <div className="flex flex-col gap-3 pt-6 sm:pt-12">
      <h1 className="max-w-3xl text-5xl leading-none font-black tracking-tight uppercase sm:text-7xl">Make any song</h1>
      <p className="text-foreground/80 max-w-xl text-base sm:text-lg">Describe it, pick a sound, press Generate. Your songs, bands and albums stay on this Home.</p>
    </div>
    <GlassBar styles={styles} onStyles={onStyles} onMade={onMade} />
  </div>;
}

/** The Create home. `search` is the address's query string: `song` opens a song. */
export function MusicWorkspace({ adult, search }: { adult: boolean; search: string }) {
  const navigate = useNavigate();
  const [styles, setStyles] = useState<string[]>([]);
  const { shown } = useShown("");
  const song = new URLSearchParams(search).get("song");
  if (!adult) return <EmptyState icon="music" text={MAKE_SONG_ADULT_LINE} />;
  const open = (id: string | null) => navigate(songAddress(id), { replace: true });
  const lime = { "--accent-lime": "var(--hue-yellow)", "--primary": "var(--hue-yellow)", "--primary-foreground": "var(--background)" } as CSSProperties;
  return <section className="dark bg-background text-foreground -mx-4 flex min-h-0 flex-1 flex-col gap-10 overflow-y-auto px-4 py-4 lg:mx-0 lg:rounded-3xl lg:px-6" style={lime} data-testid="music-workspace">
    {song ? <SongDetail key={song} id={song} onClose={() => open(null)} /> : null}
    <Hero styles={styles} onStyles={setStyles} onMade={open} />
    {shown.length > 0 ? <Carousel title="Your songs" line="Open one to play it and see everything you can do." label="Your songs">
      {shown.map((card) => <SongTile key={card.id} card={card} selected={card.id === song} onOpen={() => open(card.id)} actions={TILE_ACTIONS(card)} />)}
    </Carousel> : null}
    <Carousel title="Start from a sound" line="Pick one and it goes into the bar above." label="Starter sounds">
      {STARTER_STYLES.map((name) => <MediaTile key={name} id={name} title={name} coverUrl={null} verb={styles.includes(name) ? "Remove" : "Use"} selected={styles.includes(name)} onOpen={() => setStyles(styles.includes(name) ? styles.filter((one) => one !== name) : [...styles, name].slice(0, 8))} />)}
    </Carousel>
    <ToolCards />
  </section>;
}

// MUSIC-WORKSPACE-03: the Audio app's Create home, in the look of a modern creator app. A black page with a lime accent (kit tokens only): a hero
// panel of covers with a headline and a floating glass prompt bar (mode, style, engine, lyrics, length and instrumental chips, and one big Generate
// button), then carousels of your songs, starter sounds and the tools, every tile with a cover (a real one, or one drawn from the song's id).
// Picking a song opens it above the rows with every action as a visible button; one the engine cannot do is turned off with its plain reason.
// The same tiles serve the Studio, Stems and Remix pages (`SongGallery`).
// Every change made here has its edit card in chat (the edit_* actions), so a change is one change to one record.
import { i18n } from "@lingui/core";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { EmptyState } from "@maipai/ui/src/primitives/EmptyState";
import { useToast } from "@maipai/ui/src/primitives/Toast";
import { MAKE_SONG_ADULT_LINE } from "./MakeSongPage";
import { MusicTrack } from "@maipai/ui/src/elements/music-track";
import { useMusicTrackProps } from "@/apps/chat/MusicCardView";
import { Cover, GlassPill, MediaCarousel, MediaTile } from "@maipai/ui/src/ui/media-tiles";
import { getIcon } from "@maipai/ui/src/icons";
import { requestJson } from "@/lib/api";
import { musicApi, type MusicCard } from "@/lib/musicApi";
import { songLine, songStatusCard } from "./musicSongStatus";
export { songLine, songStatusCard };
export { songAddress, studioAddress, stemsAddress, remixAddress } from "./musicAddresses";
import { songAddress, studioAddress, stemsAddress, remixAddress } from "./musicAddresses";
import { BringSong } from "./BringSong";
import { MusicLibrary } from "./MusicLibrary";
import { MusicComposer } from "./MusicComposer";
import { AddSoundToSong, SoundTakes } from "./SoundExtras";

export { MAKES, type Make } from "./musicComposerMode";
const STARTER_STYLES = ["Dreamy indie pop", "Lo-fi beats", "Cinematic score", "Upbeat funk", "Acoustic folk", "Synthwave", "Jazz ballad", "Epic orchestral"];
const active = (card: MusicCard): boolean => card.state === "queued" || card.state === "running";
const clock = (seconds: number | null): string => (seconds && seconds > 0 ? `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}` : "");

export const STEMS_LINE = () => i18n._({ id: "Splitting a song into stems is not available on this Home yet.", message: "Splitting a song into stems is not available on this Home yet." });
export const COVER_SONG_LINE = () => i18n._({ id: "Bring a song to change its style, remove vocals, split stems, or sing it in another household voice.", message: "Bring a song to change its style, remove vocals, split stems, or sing it in another household voice." });


function useSongs() {
  return useQuery({
    queryKey: ["music-songs"], queryFn: () => requestJson<MusicCard[]>("/api/music/jobs"), staleTime: 2_000,
    refetchInterval: (query) => (query.state.data?.some(active) ? 3000 : 20_000),
  });
}



/** One song as a tile: its cover, glass pills for length and state, and the quick actions as visible buttons. */
function songTile({ card, selected, onOpen, actions }: { card: MusicCard; selected: boolean; onOpen: () => void; actions: Array<{ label: string; to: string }> }) {
  if (active(card) || card.state === "failed" || card.state === "cancelled") return songStatusCard({ card, onOpen });
  const title = card.title ?? (active(card) ? i18n._({ id: "Making your song", message: "Making your song" }) : i18n._({ id: "Untitled song", message: "Untitled song" }));
  const length = card.state === "done" ? clock(card.duration_s) : "";
  return <MediaTile key={card.id} id={card.id} title={title} line={songLine(card)} coverUrl={card.cover_url} selected={selected} busy={active(card)} playable={card.state === "done"} onOpen={onOpen}
    progress={active(card) ? card.progress : undefined} pills={<>{length ? <GlassPill>{length}</GlassPill> : null}{active(card) ? <GlassPill>{i18n._({ id: "Making", message: "Making" })}</GlassPill> : null}</>}>
    {card.state === "done" ? <div className="-ml-2 flex gap-1">{actions.map((one) => { const Icon = getIcon(TILE_ICONS[one.label] ?? "music"); return <Button key={one.label} asChild size="icon-sm" variant="ghost"><Link to={one.to} aria-label={one.label} title={one.label}><Icon aria-hidden="true" /></Link></Button>; })}</div> : null}
  </MediaTile>;
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
        : <ul className="grid list-none grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 p-0" aria-label={i18n._({ id: "Your songs", message: "Your songs" })}>{shown.map((card) => songTile({ card, selected: card.id === selected, onOpen: () => onOpen(card), actions: actionsFor(card) }))}</ul>}
    </AsyncState>
  </div>;
}

const TOOLS = () => ([
  { label: i18n._({ id: "Studio", message: "Studio" }), line: i18n._({ id: "Tracks, waveforms, mute and solo for any song.", message: "Tracks, waveforms, mute and solo for any song." }), to: "/apps/audio/studio" },
  { label: i18n._({ id: "Stems", message: "Stems" }), line: i18n._({ id: "Split a song into vocals, drums, bass and the rest.", message: "Split a song into vocals, drums, bass and the rest." }), to: "/apps/audio/stems" },
  { label: i18n._({ id: "Remix", message: "Remix" }), line: i18n._({ id: "Say what to change, review it, then Home makes it.", message: "Say what to change, review it, then Home makes it." }), to: "/apps/audio/remix" },
  { label: i18n._({ id: "Extend", message: "Extend" }), line: i18n._({ id: "Turn a quick song into a full one, or back.", message: "Turn a quick song into a full one, or back." }), to: "/apps/audio/remix" },
  { label: i18n._({ id: "Cover art", message: "Cover art" }), line: i18n._({ id: "Make a new picture for any song.", message: "Make a new picture for any song." }), to: "/apps/audio/remix" },
]);

/** The top of Create: a readable headline, the prompt bar, and nothing drawn behind the text. */
function Hero({ search, styles, onStyles, onMade, adult }: { search: string; styles: string[]; onStyles: (next: string[]) => void; onMade: (id: string) => void; adult: boolean }) {
  return <div className="flex shrink-0 flex-col gap-6 pt-4 sm:pt-8" data-testid="music-hero">
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-2">
      <h1 className="text-title">{i18n._({ id: "Make any song", message: "Make any song" })}</h1>
      <p className="text-supporting text-muted-foreground max-w-xl">{i18n._({ id: "Describe it, pick a sound, press Make. Your songs, bands and albums stay on this Home.", message: "Describe it, pick a sound, press Make. Your songs, bands and albums stay on this Home." })}</p>
    </div>
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-3" id="music-bar" data-testid="music-docked-bar"><MusicComposer search={search} tags={styles} onTags={onStyles} onMade={onMade} adult={adult} /></div>
  </div>;
}

/** The Create home. `search` is the address's query string: `song` opens a song. */
export function MusicWorkspace({ adult, search }: { adult: boolean; search: string }) {
  const navigate = useNavigate();
  const { push } = useToast();
  const [styles, setStyles] = useState<string[]>([]);
  const queryClient = useQueryClient();
  const [addingSound, setAddingSound] = useState<string | null>(null);
  const song = new URLSearchParams(search).get("song");
  const sounds = useQuery({ queryKey: ["music-sounds"], queryFn: () => musicApi.listSounds(), staleTime: 2000 });
  const { list } = useShown("");
  const openedCard = useQuery({ queryKey: ["music-song", song], queryFn: ({ signal }) => musicApi.card(song!, signal), enabled: !!song, staleTime: 0, refetchInterval: query => query.state.data && active(query.state.data) ? 2000 : false });
  const soundPlaceholder: MusicCard = { id: song ?? "sound-pending", task: "sound", state: "queued", stage: null, stage_label: i18n._({ id: "Making the sound", message: "Making the sound" }), stages: [], stage_index: 0, progress: 0, eta_seconds: null, position: null, error_line: null, cover_url: null, cover_versions: [], sound: { loop: false, surprise: false }, cover_pending: false, versions: [], current_id: null, length: "quick", quality: "quick", boost_offered: false, cut: null, max_seconds: null, title: null, description: null, lyrics: null, timed_lyrics: null, duration_s: null, started_at: Date.now() };
  const openedTrackProps = useMusicTrackProps({ card: openedCard.data?.sound ? openedCard.data : soundPlaceholder, navigate, onRefresh: () => { void openedCard.refetch(); } });
  const pickSound = (name: string) => {
    const on = styles.includes(name);
    setStyles(on ? styles.filter((one) => one !== name) : [...styles, name].slice(0, 8));
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
    <Hero search={search} styles={styles} onStyles={setStyles} onMade={open} adult={adult} />
    <div className="flex shrink-0 flex-col gap-3" data-testid="music-your-songs">
      <div className="flex flex-col gap-1"><h2 className="text-section">{i18n._({ id: "Your songs", message: "Your songs" })}</h2><p className="text-muted-foreground text-sm">{i18n._({ id: "Open one to play it and see everything you can do.", message: "Open one to play it and see everything you can do." })}</p></div>
      <MusicLibrary selected={song && !openedCard.data?.sound ? song : null} remix={new URLSearchParams(search).get("remix") === "1"} onSelect={open} onAddSound={setAddingSound} />
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

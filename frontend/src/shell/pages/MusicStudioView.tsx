// MUSIC-STUDIO-VIEW-01: the Music app's Studio (DAW) view of one song. A track row per audio part: the full song, and the stems (vocals, drums,
// bass, other) once Home has split it. Every row has its own waveform from the real file, mute, solo and volume; the timeline has a ruler, the
// song's sections as flags (from its timed words) and one playhead; the transport plays every row together. A split is the existing stems
// action (the same one the chat card uses), so nothing here is a second path. The side panel is a live listening EQ (six bands) and compressor
// built on the browser's Web Audio: they change what you hear in the Studio, never the saved file. Not built yet: the MIDI piano roll, warp
// markers and the floating "ask me to add a part" bar; they need an engine that edits audio, which Home does not have.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@maipai/ui/src/ui/button";
import { Slider } from "@maipai/ui/src/ui/slider";
import { EmptyState } from "@maipai/ui/src/primitives/EmptyState";
import { useToast } from "@maipai/ui/src/primitives/Toast";
import { musicApi, type MusicCard } from "@/lib/musicApi";
import { Waveform, usePeaks } from "./MusicWaveform";
import { MAKE_SONG_ADULT_LINE } from "./MakeSongPage";
import { Cover } from "@maipai/ui/src/ui/media-tiles";
import { getIcon } from "@maipai/ui/src/icons";

const SpeakerIcon = getIcon("volume-2");
const SpeakerOffIcon = getIcon("volume-x");
const PlusIcon = getIcon("plus");
const PlayIcon = getIcon("play");
const PauseIcon = getIcon("pause");
const LoopIcon = getIcon("rotate-cw");

/** One audio row of the Studio. */
export interface StudioTrack { id: string; name: string; url: string; hue: string }

const HUES = ["var(--hue-pink)", "var(--hue-violet)", "var(--hue-blue)", "var(--hue-yellow)", "var(--hue-green)", "var(--hue-teal)", "var(--hue-orange)"];
const STEM_HUE: Record<string, string> = { vocals: "var(--hue-violet)", drums: "var(--hue-blue)", bass: "var(--hue-orange)", other: "var(--hue-yellow)" };
export const STEMS_UNAVAILABLE_LINE = "Splitting into stems is not available on this Home yet. The full song still plays and you can listen to it here.";

/** The rows to show: the full song first, then one row per stem. */
export function studioTracks(song: MusicCard | undefined, stems: MusicCard | undefined): StudioTrack[] {
  const tracks: StudioTrack[] = [];
  const full = song?.versions.find((version) => version.id === song.current_id) ?? song?.versions.at(-1);
  if (song && full) tracks.push({ id: "mix", name: song.title ?? "Full song", url: full.url, hue: HUES[0] ?? "var(--primary)" });
  if (stems?.state === "done") stems.versions.forEach((version, index) => tracks.push({ id: version.id, name: version.label, url: version.url, hue: STEM_HUE[version.label.toLowerCase()] ?? HUES[(index + 1) % HUES.length] ?? "var(--primary)" }));
  return tracks;
}

/** m:ss, or m:ss.t for the transport. */
export const timeLabel = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

const EQ_BANDS = [{ label: "60", type: "lowshelf", hz: 60 }, { label: "200", type: "peaking", hz: 200 }, { label: "800", type: "peaking", hz: 800 }, { label: "2.5k", type: "peaking", hz: 2500 }, { label: "6k", type: "peaking", hz: 6000 }, { label: "12k", type: "highshelf", hz: 12000 }] as const;
const FLAT = EQ_BANDS.map(() => 0);
const COMP_DEFAULT = { threshold: -24, ratio: 4, attack: 10, release: 250 };

/** The listening chain: every row feeds one bus, the bus goes through six EQ bands and a compressor to the speakers. Built on the first play. */
interface Chain { ctx: AudioContext; filters: BiquadFilterNode[]; comp: DynamicsCompressorNode; wired: Set<HTMLAudioElement> }
function buildChain(): Chain | null {
  const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return null;
  const ctx = new Context();
  const filters = EQ_BANDS.map((band) => { const filter = ctx.createBiquadFilter(); filter.type = band.type; filter.frequency.value = band.hz; return filter; });
  filters.forEach((filter, index) => filter.connect(filters[index + 1] ?? ctx.destination));
  const comp = ctx.createDynamicsCompressor();
  comp.connect(filters[0] ?? ctx.destination);
  return { ctx, filters, comp, wired: new Set() };
}

function Row({ track, number, duration, now, muted, solo, volume, onMute, onSolo, onVolume, onSeek, audioRef, bars, loop }: {
  track: StudioTrack; number: number; duration: number; now: number; muted: boolean; solo: boolean; volume: number; bars: number[]; loop: [number, number] | null;
  onMute: () => void; onSolo: () => void; onVolume: (value: number) => void; onSeek: (fraction: number) => void; audioRef: (el: HTMLAudioElement | null) => void;
}) {
  const { peaks, failed } = usePeaks(track.url);
  const at = duration > 0 ? now / duration : 0;
  return <div className="contents" data-testid="studio-row" style={{ "--track": track.hue } as CSSProperties}>
    <div className="bg-card border-background relative flex h-28 flex-col justify-center gap-2 border-t-2 py-2 pr-3 pl-4">
      <span aria-hidden="true" className="bg-(--track) absolute inset-y-0 left-0 w-1.5" />
      <div className="flex items-center gap-2">
        <Button type="button" size="icon-sm" variant="ghost" aria-pressed={muted} aria-label={`Mute ${track.name}`} onClick={onMute}>{muted ? <SpeakerOffIcon className="size-4" aria-hidden="true" /> : <SpeakerIcon className="size-4" aria-hidden="true" />}</Button>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{number}. {track.name}</span>
        <Button type="button" size="icon-sm" variant={solo ? "default" : "outline"} aria-pressed={solo} aria-label={`Solo ${track.name}`} onClick={onSolo}>S</Button>
      </div>
      <Slider aria-label={`Volume of ${track.name}`} min={0} max={100} value={[Math.round(volume * 100)]} onValueChange={(value) => onVolume((value[0] ?? 100) / 100)} />
    </div>
    <button type="button" aria-label={`${track.name} waveform; click to move the playhead`} className="bg-(--track)/10 hover:bg-(--track)/15 border-background relative h-28 w-full overflow-hidden border-t-2 px-1 py-3 text-left transition-colors"
      onClick={(event) => { const box = event.currentTarget.getBoundingClientRect(); onSeek(Math.min(1, Math.max(0, (event.clientX - box.left) / box.width))); }}>
      {bars.map((bar) => <span key={bar} aria-hidden="true" className="bg-foreground/10 absolute inset-y-0 left-(--at) w-px" style={{ "--at": `${bar}%` } as CSSProperties} />)}
      {loop ? <span aria-hidden="true" className="bg-foreground/10 absolute inset-y-0 left-(--from) w-(--span)" style={{ "--from": `${loop[0] * 100}%`, "--span": `${(loop[1] - loop[0]) * 100}%` } as CSSProperties} /> : null}
      {peaks ? <Waveform peaks={peaks} played={at} hue={track.hue} label={`${track.name} waveform`} />
        : <span className="text-muted-foreground text-xs">{failed ? "This audio could not be drawn. It still plays." : "Drawing the waveform"}</span>}
      <span aria-hidden="true" className="bg-foreground absolute inset-y-0 left-(--at) w-0.5" style={{ "--at": `${at * 100}%` } as CSSProperties} />
    </button>
    <audio ref={audioRef} src={track.url} preload="auto" className="hidden"><track kind="captions" /></audio>
  </div>;
}

/** One labelled listening control: a name, a value and a slider. */
function Knob({ label, value, unit, min, max, step, onChange }: { label: string; value: number; unit: string; min: number; max: number; step: number; onChange: (value: number) => void }) {
  return <div className="flex flex-col gap-1.5">
    <div className="flex items-baseline justify-between text-xs"><span className="text-muted-foreground font-semibold tracking-wide uppercase">{label}</span><span className="tabular-nums">{value}{unit}</span></div>
    <Slider aria-label={label} min={min} max={max} step={step} value={[value]} onValueChange={(next) => onChange(next[0] ?? value)} />
  </div>;
}

/** The Studio view. `search` carries `song` (the song) and `stems` (the id of its stem split, once started). */
export function MusicStudioView({ adult, search }: { adult: boolean; search: string }) {
  const navigate = useNavigate();
  const { push } = useToast();
  const params = new URLSearchParams(search);
  const songId = params.get("song"); const stemsId = params.get("stems");
  const song = useQuery({ queryKey: ["studio-song", songId], enabled: !!songId && adult, queryFn: () => musicApi.card(songId ?? ""), refetchInterval: (q) => (q.state.data?.state === "done" ? false : 3000) });
  const stems = useQuery({ queryKey: ["studio-stems", stemsId], enabled: !!stemsId && adult, queryFn: () => musicApi.card(stemsId ?? ""), refetchInterval: (q) => (q.state.data && q.state.data.state !== "queued" && q.state.data.state !== "running" ? false : 3000) });
  const tracks = useMemo(() => studioTracks(song.data, stems.data), [song.data, stems.data]);
  const audios = useRef<Map<string, HTMLAudioElement>>(new Map());
  const chain = useRef<Chain | null>(null);
  const [playing, setPlaying] = useState(false); const [now, setNow] = useState(0);
  const [muted, setMuted] = useState<Set<string>>(new Set()); const [soloed, setSoloed] = useState<Set<string>>(new Set()); const [volumes, setVolumes] = useState<Record<string, number>>({});
  const [splitting, setSplitting] = useState(false); const [stemsProblem, setStemsProblem] = useState("");
  const [eq, setEq] = useState<number[]>(FLAT); const [comp, setComp] = useState(COMP_DEFAULT);
  const [bpm, setBpm] = useState(120); const [looping, setLooping] = useState(false);
  const duration = song.data?.duration_s ?? Math.max(0, ...[...audios.current.values()].map((el) => (Number.isFinite(el.duration) ? el.duration : 0)));
  const sections = (song.data?.timed_lyrics ?? []).filter((line, index, all) => line.section && line.section !== all[index - 1]?.section);
  const loop = useMemo<[number, number] | null>(() => {
    if (!looping || duration <= 0) return null;
    const chorus = sections.find((line) => /chorus/i.test(line.section ?? ""));
    return chorus ? [chorus.t / duration, Math.min(1, (chorus.t + duration / 4) / duration)] : [0.25, 0.5];
  }, [looping, duration, sections]);

  useEffect(() => {
    for (const track of tracks) {
      const el = audios.current.get(track.id); if (!el) continue;
      el.volume = volumes[track.id] ?? 1;
      el.muted = muted.has(track.id) || (soloed.size > 0 && !soloed.has(track.id));
    }
  }, [tracks, muted, soloed, volumes]);
  useEffect(() => {
    const live = chain.current; if (!live) return;
    live.filters.forEach((filter, index) => { filter.gain.value = eq[index] ?? 0; });
    live.comp.threshold.value = comp.threshold; live.comp.ratio.value = comp.ratio; live.comp.attack.value = comp.attack / 1000; live.comp.release.value = comp.release / 1000;
  }, [eq, comp, playing]);
  useEffect(() => () => { void chain.current?.ctx.close().catch(() => undefined); chain.current = null; }, []);
  useEffect(() => {
    if (!playing) return;
    const tick = window.setInterval(() => {
      const lead = tracks[0] && audios.current.get(tracks[0].id); if (!lead) return;
      if (loop && duration > 0 && lead.currentTime >= loop[1] * duration) { audios.current.forEach((el) => { el.currentTime = loop[0] * duration; }); setNow(loop[0] * duration); return; }
      setNow(lead.currentTime); if (lead.ended) setPlaying(false);
    }, 100);
    return () => window.clearInterval(tick);
  }, [playing, tracks, loop, duration]);

  const autoSplit = params.get("split") === "1" && !stemsId && song.data?.state === "done";
  const asked = useRef(false);
  useEffect(() => {
    if (!autoSplit || asked.current || !songId) return;
    asked.current = true;
    setSplitting(true);
    musicApi.stems(songId).then((card) => navigate(`/apps/music/studio?song=${encodeURIComponent(songId)}&stems=${encodeURIComponent(card.id)}`, { replace: true }))
      .catch((error: unknown) => setStemsProblem(error instanceof Error && error.message ? error.message : STEMS_UNAVAILABLE_LINE))
      .finally(() => setSplitting(false));
  }, [autoSplit, songId, navigate]);

  if (!adult) return <EmptyState icon="music" text={MAKE_SONG_ADULT_LINE} />;
  if (!songId) return <EmptyState icon="music" text="Open a song from your list, then choose Studio." actionLabel="Open Create" onAction={() => navigate("/apps/music/create")} />;
  if (song.isError) return <EmptyState icon="music" text="That song is not here any more. It may have been removed from your Library." actionLabel="Open Create" onAction={() => navigate("/apps/music/create")} />;

  const everyAudio = () => tracks.map((track) => audios.current.get(track.id)).filter((el): el is HTMLAudioElement => !!el);
  /** Routes every row through the EQ and compressor. An element can be wired once, so rows that arrive later (the stems) are added as they appear. */
  const wire = () => {
    chain.current ??= buildChain();
    const live = chain.current; if (!live) return;
    for (const el of everyAudio()) {
      if (live.wired.has(el)) continue;
      try { live.ctx.createMediaElementSource(el).connect(live.comp); live.wired.add(el); } catch { /* This row plays straight to the speakers. */ }
    }
    void live.ctx.resume();
  };
  const play = () => { wire(); void Promise.all(everyAudio().map((el) => { el.currentTime = now; return el.play(); })).then(() => setPlaying(true)).catch(() => push("The audio could not start. Press play again.")); };
  const pause = () => { everyAudio().forEach((el) => el.pause()); setPlaying(false); };
  const seek = (fraction: number) => { const at = fraction * duration; everyAudio().forEach((el) => { el.currentTime = at; }); setNow(at); };
  const flip = (set: Set<string>, id: string) => { const next = new Set(set); if (!next.delete(id)) next.add(id); return next; };
  const split = () => {
    setSplitting(true); setStemsProblem("");
    musicApi.stems(songId).then((card) => navigate(`/apps/music/studio?song=${encodeURIComponent(songId)}&stems=${encodeURIComponent(card.id)}`, { replace: true }))
      .catch((error: unknown) => setStemsProblem(error instanceof Error && error.message ? error.message : STEMS_UNAVAILABLE_LINE))
      .finally(() => setSplitting(false));
  };
  const stemsBusy = stems.data && (stems.data.state === "queued" || stems.data.state === "running");
  const barSeconds = (60 / bpm) * 4;
  const barCount = duration > 0 ? Math.max(1, Math.floor(duration / barSeconds)) : 0;
  const barStep = barCount > 24 ? 4 : barCount > 12 ? 2 : 1;
  const barMarks = Array.from({ length: Math.ceil(barCount / barStep) }, (_, index) => ({ bar: index * barStep + 1, at: ((index * barStep * barSeconds) / duration) * 100 }));
  const at = duration > 0 ? now / duration : 0;

  return <div className="dark flex min-h-0 flex-1 flex-col"><section className="music-surface bg-background text-foreground -mx-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 lg:mx-0 lg:rounded-3xl lg:px-6" data-testid="music-studio-view">
    <div className="flex shrink-0 flex-wrap items-center gap-4">
      <div className="size-16 shrink-0 overflow-hidden rounded-xl shadow-2xl sm:size-20"><Cover id={songId} title={song.data?.title ?? "Studio"} url={song.data?.cover_url ?? null} bare /></div>
      <div className="flex min-w-0 flex-1 flex-col gap-1"><p className="text-muted-foreground text-xs font-semibold tracking-widest uppercase">Studio</p>
        <h2 className="min-w-0 truncate text-2xl leading-none font-black tracking-tight uppercase sm:text-4xl">{song.data?.title ?? "Studio"}</h2></div>
      <div className="flex w-full flex-wrap gap-2 sm:w-auto">
        <Button asChild variant="secondary"><Link to={`/apps/music/create?song=${encodeURIComponent(songId)}`}>Back to the song</Link></Button>
        <Button type="button" disabled={splitting || !!stemsBusy || tracks.length > 1 || tracks.length === 0} onClick={split}>{stemsBusy || splitting ? "Splitting into stems" : tracks.length > 1 ? "Split into stems (done)" : "Split into stems"}</Button>
      </div>
    </div>
    {stemsProblem ? <p role="alert" className="text-muted-foreground bg-card rounded-xl p-3 text-sm">{stemsProblem}</p> : null}
    {tracks.length === 0 ? <p role="status" className="text-muted-foreground text-sm">{song.data?.state === "failed" ? "This song could not be made, so there is nothing to open." : "Opening your song. The Studio shows it as soon as it is made."}</p> : <div className="flex min-h-0 flex-col gap-4 lg:flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="bg-card grid grid-cols-(--lanes) overflow-hidden rounded-2xl" data-testid="studio-timeline">
          <div className="flex items-center justify-between gap-2 px-3 py-2"><span className="text-muted-foreground text-xs font-semibold tracking-widest uppercase">Tracks</span>
            <Button type="button" size="sm" variant="outline" disabled={splitting || !!stemsBusy || tracks.length > 1} onClick={split} aria-label="Add tracks by splitting the song into stems"><PlusIcon className="size-4" aria-hidden="true" />Add track</Button></div>
          <div className="relative h-14" data-testid="studio-ruler">
            {barMarks.map((mark) => <span key={mark.bar} className="text-muted-foreground absolute bottom-0 left-(--at) border-l border-foreground/20 pl-1 text-xs tabular-nums" style={{ "--at": `${mark.at}%` } as CSSProperties}>{mark.bar}</span>)}
            {sections.map((line) => <span key={`${line.t}`} className="bg-(--hue-orange) text-background absolute top-0 left-(--at) rounded-br px-1.5 text-xs font-semibold" style={{ "--at": `${(line.t / duration) * 100}%` } as CSSProperties}>{line.section}</span>)}
            {loop ? <><span className="bg-primary absolute top-0 left-(--at) h-3 w-1 rounded-b" aria-label="Loop start" style={{ "--at": `${loop[0] * 100}%` } as CSSProperties} /><span className="bg-primary absolute top-0 left-(--at) h-3 w-1 rounded-b" aria-label="Loop end" style={{ "--at": `${loop[1] * 100}%` } as CSSProperties} /></> : null}
            <span aria-hidden="true" className="bg-foreground absolute inset-y-0 left-(--at) w-0.5" style={{ "--at": `${at * 100}%` } as CSSProperties} />
          </div>
          {tracks.map((track, index) => <Row key={track.id} track={track} number={index + 1} duration={duration} now={now} muted={muted.has(track.id)} solo={soloed.has(track.id)} volume={volumes[track.id] ?? 1} bars={barMarks.map((mark) => mark.at)} loop={loop}
            onMute={() => setMuted(flip(muted, track.id))} onSolo={() => setSoloed(flip(soloed, track.id))} onVolume={(value) => setVolumes({ ...volumes, [track.id]: value })} onSeek={seek}
            audioRef={(el) => { if (el) audios.current.set(track.id, el); else audios.current.delete(track.id); }} />)}
          {tracks.length === 1 ? <div className="text-muted-foreground border-background col-span-2 flex flex-col items-start gap-3 border-t-2 p-4 text-sm" data-testid="studio-stems-hint">
            <p>{stemsBusy ? "Splitting the song into vocals, drums, bass and other. The rows appear here when it is done." : "Split the song to get a row for the vocals, the drums, the bass and the rest. Each one gets its own volume, mute and solo."}</p>
            {stemsBusy ? null : <Button type="button" disabled={splitting} onClick={split}>Split into stems</Button>}
          </div> : null}
        </div>
        <div className="bg-card sticky bottom-2 flex flex-wrap items-center gap-3 rounded-2xl p-3 shadow-2xl" data-testid="studio-transport">
          <Button type="button" size="lg" onClick={playing ? pause : play}>{playing ? <PauseIcon className="size-4" aria-hidden="true" /> : <PlayIcon className="size-4" aria-hidden="true" />}{playing ? "Pause" : "Play"}</Button>
          <Button type="button" variant="secondary" onClick={() => { pause(); seek(0); }}>Back to start</Button>
          <Button type="button" variant={looping ? "default" : "outline"} aria-pressed={looping} onClick={() => setLooping(!looping)}><LoopIcon className="size-4" aria-hidden="true" />Loop</Button>
          <div className="flex w-40 flex-col gap-1"><Knob label="BPM" value={bpm} unit="" min={60} max={180} step={1} onChange={setBpm} /></div>
          <span className="ml-auto font-mono text-sm tabular-nums">{timeLabel(now)} / {timeLabel(duration)}</span>
        </div>
      </div>
      <aside className="flex w-full shrink-0 flex-col gap-4 lg:w-80" aria-label="Listening effects" data-testid="studio-effects">
        <div className="bg-card flex flex-col gap-4 rounded-2xl p-4">
          <div className="flex items-baseline justify-between"><h3 className="text-sm font-black tracking-wide uppercase">EQ</h3><Button type="button" size="sm" variant="ghost" onClick={() => setEq(FLAT)}>Reset</Button></div>
          <div className="flex justify-between gap-1">
            {EQ_BANDS.map((band, index) => <div key={band.label} className="flex flex-col items-center gap-2">
              <span className="text-xs tabular-nums">{eq[index] ?? 0}</span>
              <Slider orientation="vertical" aria-label={`EQ ${band.label} Hz`} min={-12} max={12} step={1} value={[eq[index] ?? 0]} onValueChange={(next) => setEq(eq.map((gain, at) => (at === index ? (next[0] ?? 0) : gain)))} />
              <span className="text-muted-foreground text-xs">{band.label}</span>
            </div>)}
          </div>
        </div>
        <div className="bg-card flex flex-col gap-4 rounded-2xl p-4">
          <div className="flex items-baseline justify-between"><h3 className="text-sm font-black tracking-wide uppercase">Compressor</h3><Button type="button" size="sm" variant="ghost" onClick={() => setComp(COMP_DEFAULT)}>Reset</Button></div>
          <Knob label="Threshold" value={comp.threshold} unit=" dB" min={-60} max={0} step={1} onChange={(threshold) => setComp({ ...comp, threshold })} />
          <Knob label="Ratio" value={comp.ratio} unit=":1" min={1} max={20} step={1} onChange={(ratio) => setComp({ ...comp, ratio })} />
          <Knob label="Attack" value={comp.attack} unit=" ms" min={1} max={100} step={1} onChange={(attack) => setComp({ ...comp, attack })} />
          <Knob label="Release" value={comp.release} unit=" ms" min={50} max={1000} step={10} onChange={(release) => setComp({ ...comp, release })} />
        </div>
        <p className="text-muted-foreground text-xs">These change what you hear in the Studio. The saved song is not changed.</p>
      </aside>
    </div>}
  </section></div>;
}

// MUSIC-STUDIO-VIEW-01: the Music app's Studio (DAW) view of one song. A track row per audio part: the full song, and the stems (vocals, drums,
// bass, other) once Home has split it. Every row has its own waveform from the real file, mute, solo and volume; the timeline has a ruler, the
// song's sections as flags (from its timed words) and one playhead; the transport plays every row together. A split is the existing stems
// action (the same one the chat card uses), so nothing here is a second path. Not built yet: the EQ and compressor panel, the MIDI piano roll,
// warp markers and the floating "ask me to add a part" bar; they need an engine that edits audio, which Home does not have.
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

/** One audio row of the Studio. */
export interface StudioTrack { id: string; name: string; url: string; hue: string }

const HUES = ["var(--hue-orange)", "var(--hue-violet)", "var(--hue-blue)", "var(--hue-yellow)", "var(--hue-green)", "var(--hue-teal)", "var(--hue-pink)"];
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

function Row({ track, number, duration, now, muted, solo, volume, onMute, onSolo, onVolume, onSeek, audioRef }: {
  track: StudioTrack; number: number; duration: number; now: number; muted: boolean; solo: boolean; volume: number;
  onMute: () => void; onSolo: () => void; onVolume: (value: number) => void; onSeek: (fraction: number) => void; audioRef: (el: HTMLAudioElement | null) => void;
}) {
  const { peaks, failed } = usePeaks(track.url);
  return <div className="contents" data-testid="studio-row" style={{ "--track": track.hue } as CSSProperties}>
    <div className="bg-(--track)/10 flex flex-col justify-center gap-2 rounded-2xl p-3 sm:rounded-r-none">
      <div className="flex items-center gap-2">
        <span className="bg-(--track) text-background flex size-5 shrink-0 items-center justify-center rounded text-xs font-semibold">{number}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{track.name}</span>
        <Button type="button" size="sm" variant={muted ? "default" : "outline"} aria-pressed={muted} aria-label={`Mute ${track.name}`} onClick={onMute}>M</Button>
        <Button type="button" size="sm" variant={solo ? "default" : "outline"} aria-pressed={solo} aria-label={`Solo ${track.name}`} onClick={onSolo}>S</Button>
      </div>
      <Slider aria-label={`Volume of ${track.name}`} min={0} max={100} value={[Math.round(volume * 100)]} onValueChange={(value) => onVolume((value[0] ?? 100) / 100)} />
    </div>
    <button type="button" aria-label={`${track.name} waveform; click to move the playhead`} className="bg-(--track)/15 hover:bg-(--track)/25 relative h-24 w-full rounded-2xl sm:col-span-3 sm:rounded-l-none p-2 text-left transition-colors"
      onClick={(event) => { const box = event.currentTarget.getBoundingClientRect(); onSeek(Math.min(1, Math.max(0, (event.clientX - box.left) / box.width))); }}>
      {peaks ? <Waveform peaks={peaks} played={duration > 0 ? now / duration : 0} hue={track.hue} label={`${track.name} waveform`} />
        : <span className="text-muted-foreground text-xs">{failed ? "This audio could not be drawn. It still plays." : "Drawing the waveform"}</span>}
      <span className="text-foreground/80 absolute top-1 left-2 text-xs font-semibold tracking-wide uppercase">{track.name}</span>
    </button>
    <audio ref={audioRef} src={track.url} preload="auto" className="hidden"><track kind="captions" /></audio>
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
  const [playing, setPlaying] = useState(false); const [now, setNow] = useState(0);
  const [muted, setMuted] = useState<Set<string>>(new Set()); const [soloed, setSoloed] = useState<Set<string>>(new Set()); const [volumes, setVolumes] = useState<Record<string, number>>({});
  const [splitting, setSplitting] = useState(false); const [stemsProblem, setStemsProblem] = useState("");
  const duration = song.data?.duration_s ?? Math.max(0, ...[...audios.current.values()].map((el) => (Number.isFinite(el.duration) ? el.duration : 0)));

  useEffect(() => {
    for (const track of tracks) {
      const el = audios.current.get(track.id); if (!el) continue;
      el.volume = volumes[track.id] ?? 1;
      el.muted = muted.has(track.id) || (soloed.size > 0 && !soloed.has(track.id));
    }
  }, [tracks, muted, soloed, volumes]);
  useEffect(() => {
    if (!playing) return;
    const tick = window.setInterval(() => { const lead = tracks[0] && audios.current.get(tracks[0].id); if (lead) { setNow(lead.currentTime); if (lead.ended) setPlaying(false); } }, 100);
    return () => window.clearInterval(tick);
  }, [playing, tracks]);

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
  const play = () => { void Promise.all(everyAudio().map((el) => { el.currentTime = now; return el.play(); })).then(() => setPlaying(true)).catch(() => push("The audio could not start. Press play again.")); };
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
  const sections = (song.data?.timed_lyrics ?? []).filter((line, index, all) => line.section && line.section !== all[index - 1]?.section);
  const ticks = duration > 0 ? Array.from({ length: Math.floor(duration / 15) + 1 }, (_, index) => index * 15) : [];

  const lime = { "--accent-lime": "var(--hue-yellow)", "--primary": "var(--hue-yellow)", "--primary-foreground": "var(--background)" } as CSSProperties;
  return <section className="dark bg-background text-foreground -mx-4 flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 py-4 lg:mx-0 lg:rounded-3xl lg:px-6" style={lime} data-testid="music-studio-view">
    <div className="flex shrink-0 flex-wrap items-end gap-4">
      <div className="size-28 shrink-0 overflow-hidden rounded-2xl shadow-2xl sm:size-36"><Cover id={songId} title={song.data?.title ?? "Studio"} url={song.data?.cover_url ?? null} bare /></div>
      <div className="flex min-w-0 flex-1 flex-col gap-1"><p className="text-muted-foreground text-xs font-semibold tracking-widest uppercase">Studio</p>
        <h2 className="min-w-0 text-3xl leading-none font-black tracking-tight uppercase sm:text-5xl">{song.data?.title ?? "Studio"}</h2></div>
      <div className="flex w-full flex-wrap gap-2 sm:w-auto">
      <Button asChild variant="secondary"><Link to={`/apps/music/create?song=${encodeURIComponent(songId)}`}>Back to the song</Link></Button>
      <Button type="button" variant="secondary" disabled={splitting || !!stemsBusy || tracks.length > 1 || tracks.length === 0} onClick={split}>{stemsBusy ? "Splitting into stems" : tracks.length > 1 ? "Split into stems (done)" : "Split into stems"}</Button>
      </div>
    </div>
    {stemsProblem ? <p role="alert" className="text-muted-foreground text-sm">{stemsProblem}</p> : null}
    {tracks.length === 0 ? <p role="status" className="text-muted-foreground text-sm">{song.data?.state === "failed" ? "This song could not be made, so there is nothing to open." : "Opening your song. The Studio shows it as soon as it is made."}</p> : <>
      <div className="grid shrink-0 grid-cols-1 gap-y-1 sm:grid-cols-4" data-testid="studio-timeline">
        <div className="text-muted-foreground hidden p-2 text-xs font-semibold tracking-widest uppercase sm:block">Tracks</div>
        <div className="relative h-8 sm:col-span-3" data-testid="studio-ruler">
          {ticks.map((tick) => <span key={tick} className="text-muted-foreground absolute top-1 left-(--at) text-xs tabular-nums" style={{ "--at": `${(tick / duration) * 100}%` } as CSSProperties}>{timeLabel(tick)}</span>)}
          {sections.map((line) => <span key={`${line.t}`} className="bg-(--hue-orange) text-background absolute bottom-0 left-(--at) rounded-t px-1 text-xs font-semibold" style={{ "--at": `${(line.t / duration) * 100}%` } as CSSProperties}>{line.section}</span>)}
        </div>
        {tracks.map((track, index) => <Row key={track.id} track={track} number={index + 1} duration={duration} now={now} muted={muted.has(track.id)} solo={soloed.has(track.id)} volume={volumes[track.id] ?? 1}
          onMute={() => setMuted(flip(muted, track.id))} onSolo={() => setSoloed(flip(soloed, track.id))} onVolume={(value) => setVolumes({ ...volumes, [track.id]: value })} onSeek={seek}
          audioRef={(el) => { if (el) audios.current.set(track.id, el); else audios.current.delete(track.id); }} />)}
        {tracks.length === 1 ? <div className="bg-foreground/5 text-muted-foreground rounded-2xl sm:col-span-4 p-3 text-sm" data-testid="studio-stems-hint">{stemsBusy ? "Splitting the song into vocals, drums, bass and other. The rows appear here when it is done." : "Vocals, drums, bass and other rows appear here after you split the song into stems."}</div> : null}
      </div>
      <div className="bg-background/60 sticky bottom-2 flex items-center gap-3 rounded-3xl p-3 shadow-2xl backdrop-blur-xl" data-testid="studio-transport">
        <Button type="button" size="lg" onClick={playing ? pause : play}>{playing ? "Pause" : "Play"}</Button>
        <Button type="button" variant="secondary" onClick={() => { pause(); seek(0); }}>Back to start</Button>
        <span className="ml-auto font-mono text-sm tabular-nums">{timeLabel(now)} / {timeLabel(duration)}</span>
      </div>
    </>}
  </section>;
}

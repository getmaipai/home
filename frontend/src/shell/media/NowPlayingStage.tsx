import { i18n } from "@lingui/core";
// MEDIA-VIZ-01: the full-screen Now playing stage for the media host's audio: the cover (or one of the audio-reactive scenes ported from
// the pre-rebuild hub) over a soft blur of the cover, with the title, a seek bar and the transport. It drives the host's element
// directly, so closing it never restarts anything. The stage always uses the dark theme's tokens (the visualizers draw light colors on
// dark); every color is a theme token or comes from the cover art itself.
// MUSIC-STAGE-01: for a song the stage also has previous, next, shuffle, repeat, like, an Up next list and full-screen synced lyrics, and
// a soft gradient from the cover's colors behind it all (still when the person asks for reduced motion).
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { Slider } from "@maipai/ui/src/dashboard/components/ui/slider";
import { getIcon } from "@maipai/ui/src/icons";
import { LyricsList, type TimedLyricLine } from "@maipai/ui/src/elements/lyrics-list";
import { cn } from "@maipai/ui/src/utils";
import { api, request } from "@/lib/api";
import { useMediaDock, type HoistedMedia } from "@/shell/mediaHost";
import { liveStationIdOf } from "@/shell/radioLive";
import { nextRepeat, setPlayMode, usePlayMode } from "@/shell/media/playMode";
import { AudioVisualizer, VISUALIZERS, setVisualizerPref, useVisualizerPref } from "@/shell/media/AudioVisualizer";
import { EqualizerMenu } from "@/shell/media/EqualizerMenu";
import { useMediaAnalyser } from "@/shell/media/useMediaAnalyser";
import { accentOf, useArtPalette } from "@/lib/media/artPalette";

const SCENE_KEY = "media.stage.scene";
const readScene = (): boolean => { try { return localStorage.getItem(SCENE_KEY) !== "art"; } catch { return true; } };

export function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const h = Math.floor(whole / 3600), m = Math.floor((whole % 3600) / 60), s = whole % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/** What the stage reads about a song from the Music app's item data. */
export interface StageSong { liked?: boolean; lyrics?: string; timed_lyrics?: Array<{ t: number; line: string; section?: string | null }> }
type QueueRow = { id: string; title: string; channel?: string | null };

/** The lyrics the stage can show: timed lines when the song has them, else its plain text; null when it has none. */
export function lyricsOf(song: StageSong | null): { lines?: readonly TimedLyricLine[]; text?: string } | null {
  if (song?.timed_lyrics?.length) return { lines: song.timed_lyrics };
  return song?.lyrics?.trim() ? { text: song.lyrics } : null;
}

const prefersReducedMotion = (): boolean => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function NowPlayingStage({ media, onClose, initialView = "scene" }: { media: HoistedMedia; onClose: () => void; initialView?: "scene" | "lyrics" | "queue" }) {
  const el = media.el;
  const root = useRef<HTMLDivElement>(null);
  const [showScene, setShowScene] = useState(readScene);
  const variant = useVisualizerPref();
  const palette = useArtPalette(media.poster ?? null);
  const accent = accentOf(palette);
  const getAnalyser = useMediaAnalyser(el, true);
  const [playing, setPlaying] = useState(!el.paused);
  const [position, setPosition] = useState(el.currentTime || 0);
  const [duration, setDuration] = useState(Number.isFinite(el.duration) ? el.duration : 0);
  const dock = useMediaDock();
  const mode = usePlayMode();
  const isSong = media.appId === "music" && liveStationIdOf(media.src) === null;
  const [song, setSong] = useState<StageSong | null>(null);
  const [liked, setLiked] = useState(false);
  const [view, setView] = useState<"scene" | "lyrics" | "queue">(initialView);
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const reduced = prefersReducedMotion();

  useEffect(() => {
    setSong(null); setLiked(false); setView((old) => (old === "lyrics" ? "scene" : old));
    if (!isSong) return;
    let alive = true;
    api.appData<StageSong | []>("music", "item", { id: media.id }).then((item) => {
      if (!alive || Array.isArray(item)) return;
      setSong(item); setLiked(item.liked === true);
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [isSong, media.id]);
  const lyrics = lyricsOf(song);
  useEffect(() => {
    if (view !== "queue" || !isSong) return;
    let alive = true;
    api.appData<QueueRow[]>("music", "up-next", { id: media.id }).then((rows) => { if (alive) setQueue(Array.isArray(rows) ? rows : []); }).catch(() => { if (alive) setQueue([]); });
    return () => { alive = false; };
  }, [view, isSong, media.id]);
  const toggleLike = () => {
    const on = !liked;
    setLiked(on);
    request("/api/plugins/music/like", { method: "POST", body: JSON.stringify({ media_id: media.id, on }) }).catch(() => setLiked(!on));
  };

  useEffect(() => {
    const sync = () => {
      setPlaying(!el.paused);
      setPosition(el.currentTime || 0);
      setDuration(Number.isFinite(el.duration) ? el.duration : 0);
    };
    const events = ["play", "pause", "timeupdate", "durationchange", "seeked", "loadedmetadata"] as const;
    events.forEach((name) => el.addEventListener(name, sync));
    sync();
    return () => events.forEach((name) => el.removeEventListener(name, sync));
  }, [el]);

  // The browser's full screen when it allows it; Escape closes the stage either way.
  useEffect(() => {
    const node = root.current;
    void node?.requestFullscreen?.().catch(() => {});
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    const onFullscreen = () => { if (!document.fullscreenElement) onClose(); };
    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFullscreen);
      if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
    };
  }, [onClose]);

  const choose = (scene: "art" | (typeof VISUALIZERS)[number]["id"]) => {
    if (scene === "art") setShowScene(false);
    else { setVisualizerPref(scene); setShowScene(true); }
    try { localStorage.setItem(SCENE_KEY, scene === "art" ? "art" : "scene"); } catch { /* the choice lasts until reload */ }
  };

  const CloseIcon = getIcon("x"), PlayIcon = getIcon("play"), PauseIcon = getIcon("pause"), MusicIcon = getIcon("music");
  const HeartIcon = getIcon("heart"), ShuffleIcon = getIcon("shuffle"), RepeatIcon = getIcon("refresh-cw"), PrevIcon = getIcon("skip-back"), NextIcon = getIcon("skip-forward");
  const LyricsIcon = getIcon("mic-vocal"), QueueIcon = getIcon("list-music"), Back10Icon = getIcon("rotate-ccw"), Fwd30Icon = getIcon("rotate-cw");
  const pick = (next: "lyrics" | "queue") => setView((old) => (old === next ? "scene" : next));
  const repeatLabel = mode.repeat === "one" ? i18n._({ id: "Repeat one song", message: "Repeat one song" }) : mode.repeat === "all" ? i18n._({ id: "Repeat all songs", message: "Repeat all songs" }) : i18n._({ id: "Repeat off", message: "Repeat off" });
  const toggle = () => { if (el.paused) void el.play().catch(() => {}); else el.pause(); };

  return createPortal(
    <div ref={root} role="dialog" aria-modal="true" aria-label={`Now playing: ${media.title}`} data-testid="now-playing-stage" className="dark fixed inset-0 z-[60] flex flex-col overflow-hidden bg-background text-foreground">
      {media.poster ? <img src={media.poster} alt="" aria-hidden="true" className="pointer-events-none absolute inset-0 size-full scale-125 object-cover opacity-25 blur-3xl" /> : null}
      {media.poster ? (
        <div key={media.poster} aria-hidden="true" data-testid="stage-ambient" data-motion={reduced ? "still" : "fade"} className={cn("pointer-events-none absolute inset-0 opacity-40 blur-3xl", !reduced && "motion-safe:animate-in motion-safe:fade-in motion-safe:duration-1000")}
          style={{ "--stage-a": palette.corners[0], "--stage-b": palette.corners[1], "--stage-c": palette.corners[2], "--stage-d": palette.corners[3], backgroundImage: "radial-gradient(60% 50% at 15% 10%, var(--stage-a), transparent), radial-gradient(60% 50% at 90% 30%, var(--stage-b), transparent), radial-gradient(70% 60% at 20% 95%, var(--stage-c), transparent), radial-gradient(60% 50% at 95% 90%, var(--stage-d), transparent)" } as CSSProperties} />
      ) : <div aria-hidden="true" data-testid="stage-ambient" data-motion="tokens" className="pointer-events-none absolute inset-0 bg-gradient-to-b from-primary/20 to-transparent" />}
      <div className="relative z-10 flex items-center gap-2 p-4">
        <div className="flex min-w-0 flex-1 flex-wrap gap-1" role="group" aria-label={i18n._({ id: "What is on stage", message: "What is on stage" })}>
          <Button size="sm" variant={showScene ? "ghost" : "secondary"} aria-pressed={!showScene} onClick={() => choose("art")}>{i18n._({ id: "Cover", message: "Cover" })}</Button>
          {VISUALIZERS.map((v) => (
            <Button key={v.id} size="sm" variant={showScene && v.id === variant ? "secondary" : "ghost"} aria-pressed={showScene && v.id === variant} onClick={() => choose(v.id)}>{v.label}</Button>
          ))}
        </div>
        <Button variant="ghost" size="icon" aria-label={i18n._({ id: "Close Now playing", message: "Close Now playing" })} onClick={onClose}><CloseIcon aria-hidden="true" /></Button>
      </div>
      <div className="relative z-10 flex min-h-0 flex-1 items-center justify-center">
        {view === "lyrics" && lyrics ? (
          <div data-testid="stage-lyrics" className="size-full overflow-y-auto px-6 py-8">
            <div className="mx-auto max-w-3xl">
              <LyricsList lines={lyrics.lines} text={lyrics.text} currentTime={position} onSeek={(t) => { el.currentTime = t; setPosition(t); }} labels={{ label: i18n._({ id: "Lyrics", message: "Lyrics" }) }} largeCurrent blurByDistance />
            </div>
          </div>
        ) : view === "queue" ? (
          <div data-testid="stage-queue" className="size-full overflow-y-auto px-4 py-6">
            <ul aria-label={i18n._({ id: "Up next", message: "Up next" })} className="mx-auto flex max-w-3xl flex-col gap-1">
              {queue.length ? queue.map((row) => (
                <li key={row.id}>
                  <Button variant="ghost" onClick={() => { void dock.play?.(row.id); setView("scene"); }}>
                    <span className="truncate">{row.title}</span>
                    {row.channel ? <span className="truncate text-muted-foreground">{row.channel}</span> : null}
                  </Button>
                </li>
              )) : <li className="text-center text-muted-foreground">{i18n._({ id: "Nothing is queued after this song.", message: "Nothing is queued after this song." })}</li>}
            </ul>
          </div>
        ) : showScene ? (
          <AudioVisualizer variant={variant} mode="full" getAnalyser={getAnalyser} palette={palette} active={playing} progress={duration > 0 ? position / duration : 0} className="absolute inset-0" />
        ) : media.poster ? (
          <img src={media.poster} alt="" className="aspect-square w-[min(46vh,80vw)] rounded-xl object-cover shadow-2xl" />
        ) : (
          <div className="grid aspect-square w-[min(46vh,80vw)] place-items-center rounded-xl bg-muted"><MusicIcon aria-hidden="true" className="size-16 text-muted-foreground" /></div>
        )}
      </div>
      <div className={cn("relative z-10 flex flex-col gap-3 bg-gradient-to-t from-background to-transparent p-6 pb-8")}>
        <div className="mx-auto w-full max-w-3xl min-w-0">
          <div className="truncate text-2xl font-semibold md:text-4xl">{media.title}</div>
          {media.subtitle ? <div className="mt-1 truncate text-base text-muted-foreground md:text-xl">{media.subtitle}</div> : null}
        </div>
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3 text-base tabular-nums text-muted-foreground">
          <span>{clock(position)}</span>
          <Slider aria-label={i18n._({ id: "Seek", message: "Seek" })} min={0} max={Math.max(duration, 1)} step={1} value={[Math.min(position, Math.max(duration, 1))]} disabled={duration <= 0} onValueChange={(value) => { const next = Array.isArray(value) ? value[0] : value; if (typeof next === "number") { el.currentTime = next; setPosition(next); } }} />
          <span>{clock(duration)}</span>
        </div>
        {isSong ? (
          <div className="mx-auto flex items-center gap-2" role="group" aria-label={i18n._({ id: "Song controls", message: "Song controls" })}>
            <Button variant="ghost" size="icon" aria-label={i18n._({ id: "Shuffle", message: "Shuffle" })} aria-pressed={mode.shuffle} onClick={() => setPlayMode({ shuffle: !mode.shuffle })}><ShuffleIcon aria-hidden="true" className={mode.shuffle ? "text-primary" : undefined} /></Button>
            <Button variant="ghost" size="icon" aria-label={i18n._({ id: "Previous song", message: "Previous song" })} onClick={() => void dock.previous?.()}><PrevIcon aria-hidden="true" /></Button>
            <Button size="icon" aria-label={playing ? "Pause" : "Play"} onClick={toggle} style={{ background: accent }}>{playing ? <PauseIcon aria-hidden="true" /> : <PlayIcon aria-hidden="true" />}</Button>
            <Button variant="ghost" size="icon" aria-label={i18n._({ id: "Next song", message: "Next song" })} onClick={() => void dock.next()}><NextIcon aria-hidden="true" /></Button>
            <Button variant="ghost" size="icon" aria-label={repeatLabel} aria-pressed={mode.repeat !== "off"} onClick={() => setPlayMode({ repeat: nextRepeat(mode.repeat) })}>
              <RepeatIcon aria-hidden="true" className={mode.repeat !== "off" ? "text-primary" : undefined} />
              {mode.repeat === "one" ? <span aria-hidden="true" className="absolute end-1 bottom-1 font-semibold text-primary">1</span> : null}
            </Button>
          </div>
        ) : null}
        <div className="mx-auto flex items-center gap-2">
          {isSong ? <Button variant="ghost" size="icon" aria-label={liked ? i18n._({ id: "Unlike", message: "Unlike" }) : i18n._({ id: "Like", message: "Like" })} aria-pressed={liked} onClick={toggleLike}><HeartIcon aria-hidden="true" className={liked ? "fill-primary text-primary" : undefined} /></Button> : null}
          <Button variant="ghost" size="icon" aria-label={i18n._({ id: "Back 10 seconds", message: "Back 10 seconds" })} onClick={() => { el.currentTime = Math.max(0, el.currentTime - 10); }}><Back10Icon aria-hidden="true" /></Button>
          {isSong ? null : <Button size="icon" aria-label={playing ? "Pause" : "Play"} onClick={toggle} style={{ background: accent }}>{playing ? <PauseIcon aria-hidden="true" /> : <PlayIcon aria-hidden="true" />}</Button>}
          <Button variant="ghost" size="icon" aria-label={i18n._({ id: "Forward 30 seconds", message: "Forward 30 seconds" })} onClick={() => { el.currentTime = Math.min(Number.isFinite(el.duration) ? el.duration : el.currentTime + 30, el.currentTime + 30); }}><Fwd30Icon aria-hidden="true" /></Button>
          {isSong && lyrics ? <Button variant={view === "lyrics" ? "secondary" : "ghost"} size="icon" aria-label={i18n._({ id: "Lyrics", message: "Lyrics" })} aria-pressed={view === "lyrics"} onClick={() => pick("lyrics")}><LyricsIcon aria-hidden="true" /></Button> : null}
          {isSong ? <EqualizerMenu /> : null}
          {isSong ? <Button variant={view === "queue" ? "secondary" : "ghost"} size="icon" aria-label={i18n._({ id: "Up next", message: "Up next" })} aria-pressed={view === "queue"} onClick={() => pick("queue")}><QueueIcon aria-hidden="true" /></Button> : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

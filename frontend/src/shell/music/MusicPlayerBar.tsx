import { i18n } from "@lingui/core";
// MP-U4: the Music player bar. It is the shell's one bottom bar for a song made in Music, placed exactly where the global mini player is (same
// slot, same phone clearance above the nav) and drawn by the kit Player: `mini` is the bar, `audio` is the expanded player with the cover,
// the karaoke lyrics, shuffle and repeat. This file adds what Music needs beside them: the waveform seek bar, time, volume, shuffle and
// repeat on the bar, Open in Studio, and the keys. The song list, the details and the Studio all press play on `musicPlayer`; the bar only draws it.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { Player } from "@maipai/ui/src/primitives/Player";
import { Button } from "@maipai/ui/src/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@maipai/ui/src/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@maipai/ui/src/ui/drawer";
import { Slider } from "@maipai/ui/src/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@maipai/ui/src/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@maipai/ui/src/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/ui/select";
import { useToast } from "@maipai/ui/src/primitives/Toast";
import { useIsPhoneLayout } from "@maipai/ui/src/hooks/useIsPhoneLayout";
import { getIcon } from "@maipai/ui/src/icons";
import { useAudioSession } from "@/shell/audioSessionContext";
import { useMediaDock } from "@/shell/mediaHost";
import { getPlayMode, nextRepeat, setPlayMode, usePlayMode } from "@/shell/media/playMode";
import { clock } from "@/shell/media/NowPlayingStage";
import { studioAddress } from "@/shell/pages/musicAddresses";
import { musicPlayer, useMusicClock, useMusicPlayer, useMusicVolume } from "./musicPlayer";
import type { Track } from "./musicQueue";
import { WaveformSeek, usePeaks } from "./WaveformSeek";
import { musicPaneTabs } from "./MusicQueuePane";
import { say } from "./MusicQueuePane.helpers";
import { isMusicTab, musicPane, QUEUE_TAB, useMusicPane, type MusicPaneTab } from "./musicPane";
import { useMediaAnalyser } from "@/shell/media/useMediaAnalyser";
import { createSpectrum } from "./musicSpectrum";
import { useLike } from "./musicLike";
import { useLyricsFollow } from "./useLyricsFollow";
import { EQ_PRESETS, playerAudioAvailable } from "@/lib/media/audioGraph";
import { applyEqSettings, boundedBandGains, EQ_FREQUENCIES, loadEqSettings, saveEqSettings, type EqSettings } from "./musicEq";

const icon = (name: string, className?: string) => { const One = getIcon(name); return <One aria-hidden="true" {...(className ? { className } : {})} />; };

/** What the bar says when Next has nowhere to go. */
export const LAST_SONG_LINE = () => i18n._({ id: "No playable songs are left. Check the song files and try again.", message: "No playable songs are left. Check the song files and try again." });

/** True for a key press that belongs to a text box, a menu or a slider, which the player keys must leave alone. */
export function keyBelongsToControl(target: EventTarget | null, key: string): boolean {
  const node = target as HTMLElement | null;
  if (!node || typeof node.closest !== "function") return false;
  if (node.isContentEditable || node.closest('input, textarea, select, [role="menu"], [role="menuitem"], [role="listbox"], [role="combobox"], [role="slider"], [role="dialog"]:not([data-music-expanded])')) return true;
  return key === " " && !!node.closest('button, a, [role="button"]');
}

/** Space, Left, Right, Up, Down, M, N and P for the song that is loaded. */
export interface MusicShortcutActions {
  next: () => void;
  previous: () => void;
  like: () => void;
  shuffle: () => void;
  repeat: () => void;
  equalizer: () => void;
  shortcuts: () => void;
}

export function useMusicKeys(enabled: boolean, actions: MusicShortcutActions) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      if (keyBelongsToControl(event.target, key)) return;
      // Inside the kit Player its own handler already takes Space, the arrows and M.
      const inPlayer = !!(event.target as HTMLElement | null)?.closest?.('[data-slot="player"]');
      const ownByKit = inPlayer && !event.shiftKey && (key === " " || key === "ArrowLeft" || key === "ArrowRight" || key === "m");
      if (ownByKit) return;
      const volume = musicPlayer.volume();
      if (key === " ") musicPlayer.playPause();
      else if (event.shiftKey && key === "ArrowLeft") actions.previous();
      else if (event.shiftKey && key === "ArrowRight") actions.next();
      else if (key === "ArrowLeft") musicPlayer.seekBy(-5);
      else if (key === "ArrowRight") musicPlayer.seekBy(5);
      else if (key === "ArrowUp") musicPlayer.setVolume(volume.volume + 0.05);
      else if (key === "ArrowDown") musicPlayer.setVolume(volume.volume - 0.05);
      else if (key === "m") musicPlayer.toggleMute();
      else if (key === "l") actions.like();
      else if (key === "s") actions.shuffle();
      else if (key === "r") actions.repeat();
      else if (key === "e") actions.equalizer();
      else if (key === "?") actions.shortcuts();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, actions]);
}

/** The Open in Studio button for a song (a value, not a component: the Button is drawn where it is used). */
const studioButton = (track: Track) => track.songId
  ? <Button asChild variant="ghost" size="icon" data-testid="music-bar-studio"><Link to={studioAddress(track.songId)} aria-label={i18n._({ id: "Open in Studio", message: "Open in Studio" })} title={i18n._({ id: "Open in Studio", message: "Open in Studio" })}>{icon("sliders-horizontal")}</Link></Button>
  : null;

function PlayModeButtons() {
  const mode = usePlayMode();
  const repeatLabel = mode.repeat === "one" ? i18n._({ id: "Repeat one song", message: "Repeat one song" }) : mode.repeat === "all" ? i18n._({ id: "Repeat all songs", message: "Repeat all songs" }) : i18n._({ id: "Repeat off", message: "Repeat off" });
  return <>
    <Button type="button" variant="ghost" size="icon" aria-label={i18n._({ id: "Shuffle", message: "Shuffle" })} aria-pressed={mode.shuffle} className={mode.shuffle ? "text-primary" : undefined} onClick={() => setPlayMode({ shuffle: !getPlayMode().shuffle })}>{icon("shuffle")}</Button>
    <Button type="button" variant="ghost" size="icon" aria-label={repeatLabel} aria-pressed={mode.repeat !== "off"} className={mode.repeat !== "off" ? "text-primary" : undefined} onClick={() => setPlayMode({ repeat: nextRepeat(getPlayMode().repeat) })}>{icon(mode.repeat === "one" ? "repeat-1" : "repeat")}</Button>
  </>;
}

/** Follows the active line of the expanded lyrics. Its own component so the frame clock re-draws only this. */
function LyricsFollow({ track, children }: { track: Track; children: (resume: () => void) => ReactNode }) {
  const { time } = useMusicClock();
  const [root, setRoot] = useState<HTMLElement | null>(null);
  useEffect(() => { setRoot(document.querySelector<HTMLElement>("[data-music-expanded]")); }, []);
  const follow = useLyricsFollow(root, track.timed, time, (seconds) => musicPlayer.seek(seconds));
  return follow.following ? null : children(follow.resume);
}

const SHORTCUTS = [
  ["Space", i18n._({ id: "Play or pause", message: "Play or pause" })],
  ["← / →", i18n._({ id: "Seek 5 seconds", message: "Seek 5 seconds" })],
  ["Shift + ← / →", i18n._({ id: "Previous or next song", message: "Previous or next song" })],
  ["↑ / ↓", i18n._({ id: "Raise or lower volume", message: "Raise or lower volume" })],
  ["M", i18n._({ id: "Mute or unmute", message: "Mute or unmute" })],
  ["L", i18n._({ id: "Like or unlike", message: "Like or unlike" })],
  ["S", i18n._({ id: "Toggle shuffle", message: "Toggle shuffle" })],
  ["R", i18n._({ id: "Change repeat", message: "Change repeat" })],
  ["E", i18n._({ id: "Open equalizer", message: "Open equalizer" })],
  ["?", i18n._({ id: "Show keyboard shortcuts", message: "Show keyboard shortcuts" })],
] as const;

function VolumeControl() {
  const { volume, muted } = useMusicVolume();
  const level = muted ? 0 : volume;
  return <span className="flex items-center" data-testid="music-bar-volume">
    <Button type="button" variant="ghost" size="icon" aria-label={muted ? i18n._({ id: "Unmute", message: "Unmute" }) : i18n._({ id: "Mute", message: "Mute" })} aria-pressed={muted} onClick={() => musicPlayer.toggleMute()}>{icon(level === 0 ? "volume-x" : level < 0.5 ? "volume-1" : "volume-2")}</Button>
    <span className="w-20 max-xl:hidden"><Slider aria-label={i18n._({ id: "Volume", message: "Volume" })} min={0} max={100} step={1} value={[Math.round(level * 100)]} onValueChange={(value) => { const next = Array.isArray(value) ? value[0] : value; if (typeof next === "number") musicPlayer.setVolume(next / 100); }} /></span>
  </span>;
}

const EQ_NAMES: Record<keyof typeof EQ_PRESETS, string> = {
  flat: i18n._({ id: "Flat", message: "Flat" }), bass: i18n._({ id: "Bass boost", message: "Bass boost" }),
  treble: i18n._({ id: "Treble boost", message: "Treble boost" }), vocal: i18n._({ id: "Vocal", message: "Vocal" }),
  loud: i18n._({ id: "Loud", message: "Loud" }), acoustic: i18n._({ id: "Acoustic", message: "Acoustic" }),
  dance: i18n._({ id: "Dance", message: "Dance" }), jazz: i18n._({ id: "Jazz", message: "Jazz" }), rock: i18n._({ id: "Rock", message: "Rock" }),
};

/** Elapsed time, the waveform and the length. Its own component so the frame clock re-draws only this. */
function SeekRow({ track, wide }: { track: Track; wide: string }) {
  const { time, duration } = useMusicClock();
  const peaks = usePeaks(track);
  const label = i18n._({ id: "Seek", message: "Seek" });
  return <span className="flex items-center gap-2 pe-2 text-supporting tabular-nums text-muted-foreground" data-testid="music-bar-time">
    <span>{clock(time)}</span>
    <span className={wide}>{peaks
      ? <WaveformSeek peaks={peaks} time={time} duration={duration} onSeek={(seconds) => musicPlayer.seek(seconds)} label={label} />
      : <Slider aria-label={label} min={0} max={Math.max(duration, 1)} step={1} value={[Math.min(time, Math.max(duration, 1))]} disabled={duration <= 0} onValueChange={(value) => { const next = Array.isArray(value) ? value[0] : value; if (typeof next === "number") musicPlayer.seek(next); }} />}</span>
    <span>{clock(duration)}</span>
  </span>;
}

export function MusicPlayerBar() {
  const location = useLocation();
  const session = useAudioSession();
  const dock = useMediaDock();
  const { push } = useToast();
  const phone = useIsPhoneLayout();
  const snap = useMusicPlayer();
  const mode = usePlayMode();
  const [eqSettings, setEqSettings] = useState<EqSettings>(() => loadEqSettings());
  const [eqOpen, setEqOpen] = useState(false);
  const eqSupported = playerAudioAvailable();
  useEffect(() => { applyEqSettings(eqSettings, snap.track?.loudnessLufs); saveEqSettings(eqSettings); }, [eqSettings, snap.track?.loudnessLufs]);
  const [expanded, setExpanded] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const pane = useMusicPane();
  const [drawer, setDrawer] = useState<MusicPaneTab | null>(null);
  // The spectrum behind the bar: the analyser is made lazily on the one player element, and read only while a song plays and the page shows.
  const getAnalyser = useMediaAnalyser(musicPlayer.element(), true);
  const spectrum = useMemo(() => createSpectrum({ analyser: getAnalyser, playing: () => musicPlayer.get().playing }), [getAnalyser]);
  const held = dock.current;
  const track = snap.track;
  const { liked, toggle: toggleLike } = useLike(track);
  const likeLabel = liked ? i18n._({ id: "Unlike", message: "Unlike" }) : i18n._({ id: "Like", message: "Like" });

  // The bar starts the shell's audio session for this player, and clears the media dock when a song starts (one player at a time).
  useEffect(() => { musicPlayer.bind(session, () => dock.clear()); return () => musicPlayer.bind(null); }, [session, dock]);
  // Something else started while a song sat paused: the bar gives way to it.
  const heldStarted = !!held?.started;
  useEffect(() => { if (heldStarted && !musicPlayer.get().playing) musicPlayer.stop(); }, [heldStarted]);
  useEffect(() => { if (!track) setExpanded(false); }, [track]);
  // Closing the player closes its queue drawer too; the shell pane keeps its own state.
  useEffect(() => { if (!track) setDrawer(null); }, [track]);
  const pressQueue = () => {
    if (pane.hosted && !phone) { musicPane.request(QUEUE_TAB); return; }
    setDrawer((open) => (open ? null : QUEUE_TAB));
  };
  const queueOpen = drawer !== null || (pane.hosted && !phone && pane.tab !== null);
  useEffect(() => {
    if (snap.notice) push(i18n._({ id: "This song could not be played. Check the file and try again.", message: "This song could not be played. Check the file and try again." }));
  }, [snap.notice, push]);

  const askNext = () => { if (musicPlayer.canNext()) musicPlayer.next(); else push(LAST_SONG_LINE()); };
  const shortcutsActions = useRef<MusicShortcutActions>({ next: askNext, previous: () => musicPlayer.previous(), like: () => {}, shuffle: () => {}, repeat: () => {}, equalizer: () => {}, shortcuts: () => {} }).current;
  shortcutsActions.next = askNext;
  shortcutsActions.previous = () => musicPlayer.previous();
  shortcutsActions.like = () => { if (track?.mediaId) void toggleLike().then((kept) => { if (!kept) push(i18n._({ id: "That could not be saved. Try again.", message: "That could not be saved. Try again." })); }); };
  shortcutsActions.shuffle = () => setPlayMode({ shuffle: !getPlayMode().shuffle });
  shortcutsActions.repeat = () => setPlayMode({ repeat: nextRepeat(getPlayMode().repeat) });
  shortcutsActions.equalizer = () => setEqOpen(true);
  shortcutsActions.shortcuts = () => setShortcutsOpen(true);
  useMusicKeys(location.pathname.startsWith("/apps/audio"), shortcutsActions);
  const queueTabs = musicPaneTabs();
  const queueLabel = i18n._({ id: "Queue", message: "Queue" });

  const shortcutsDialog = <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
    <DialogContent size="sm" aria-label={i18n._({ id: "Music keyboard shortcuts", message: "Music keyboard shortcuts" })}>
      <DialogHeader><DialogTitle>{i18n._({ id: "Keyboard shortcuts", message: "Keyboard shortcuts" })}</DialogTitle><DialogDescription>{i18n._({ id: "Use these keys while Music is active and focus is outside a text field.", message: "Use these keys while Music is active and focus is outside a text field." })}</DialogDescription></DialogHeader>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3">
        {SHORTCUTS.map(([keys, action]) => <div key={keys} className="col-span-2 grid grid-cols-subgrid items-center">
          <dt><kbd>{keys}</kbd></dt><dd className="text-supporting text-muted-foreground">{action}</dd>
        </div>)}
      </dl>
    </DialogContent>
  </Dialog>;
  if (!track) return shortcutsDialog;
  const eqReason = i18n._({ id: "This browser cannot run the Equalizer because Web Audio is unavailable. Use a browser with Web Audio support.", message: "This browser cannot run the Equalizer because Web Audio is unavailable. Use a browser with Web Audio support." });
  const equalizer = <Popover open={eqOpen} onOpenChange={setEqOpen}>
    <PopoverTrigger asChild><Button type="button" variant="ghost" size="icon" aria-label={i18n._({ id: "Equalizer", message: "Equalizer" })} title={eqSupported ? i18n._({ id: "Equalizer", message: "Equalizer" }) : eqReason} disabled={!eqSupported}>{icon("sliders-horizontal")}</Button></PopoverTrigger>
    <PopoverContent align="end" aria-label={i18n._({ id: "Equalizer settings", message: "Equalizer settings" })}>
      <div className="flex flex-col gap-3">
        <Select value={eqSettings.preset} onValueChange={(value) => { const preset = value as keyof typeof EQ_PRESETS; setEqSettings({ preset, gains: [...EQ_PRESETS[preset]], preampDb: eqSettings.preampDb }); }}>
          <SelectTrigger aria-label={i18n._({ id: "Equalizer preset", message: "Equalizer preset" })}><SelectValue /></SelectTrigger>
          <SelectContent>{Object.keys(EQ_PRESETS).map((preset) => <SelectItem key={preset} value={preset}>{EQ_NAMES[preset as keyof typeof EQ_PRESETS]}</SelectItem>)}</SelectContent>
        </Select>
        <label className="flex items-center gap-3 text-supporting">{i18n._({ id: "Preamp", message: "Preamp" })}<Slider aria-label={i18n._({ id: "Preamp", message: "Preamp" })} min={-12} max={12} step={1} value={[eqSettings.preampDb]} onValueChange={(value) => { const n = Array.isArray(value) ? value[0] : value; if (typeof n === "number") setEqSettings({ ...eqSettings, preset: "flat", preampDb: n }); }} /><span>{`${eqSettings.preampDb} dB`}</span></label>
        {EQ_FREQUENCIES.map((frequency, index) => <label key={frequency} className="flex items-center gap-3 text-supporting"><span className="w-10">{frequency >= 1000 ? `${frequency / 1000}k` : frequency}</span><Slider aria-label={i18n._({ id: "{frequency} Hz", message: "{frequency} Hz", values: { frequency } })} min={-12} max={12} step={1} value={[eqSettings.gains[index] ?? 0]} onValueChange={(value) => { const n = Array.isArray(value) ? value[0] : value; if (typeof n === "number") { const gains = [...eqSettings.gains]; gains[index] = n; setEqSettings({ ...eqSettings, preset: "flat", gains: boundedBandGains(gains) }); } }} /><span className="w-9 text-end">{eqSettings.gains[index] ?? 0}</span></label>)}
      </div>
    </PopoverContent>
  </Popover>;
  const poster = track.artworkUrl ?? undefined;
  const lyrics = track.timed?.length ? { lines: track.timed } : track.lyrics?.trim() && track.lyrics.trim() !== "[Instrumental]" ? { text: track.lyrics } : undefined;
  const common = {
    media: musicPlayer.element(), src: track.url, kind: "audio" as const, title: track.title, mediaSession: false,
    ...(track.subtitle ? { subtitle: track.subtitle } : {}), ...(poster ? { poster } : {}),
    onNext: askNext, onPrevious: () => musicPlayer.previous(),
  };
  const body = (
    <Player key={`${track.key}-${expanded ? "full" : "bar"}`} {...common} layout={expanded ? "audio" : "mini"}
      {...(expanded
        ? { shuffle: mode.shuffle, repeat: mode.repeat, onShuffle: () => setPlayMode({ shuffle: !getPlayMode().shuffle }), onRepeat: () => setPlayMode({ repeat: nextRepeat(getPlayMode().repeat) }), lyricsBlur: true, artSpring: true, spectrum: { levels: spectrum.levels }, ...(lyrics ? { lyrics } : {}), actionsSlot: <>{equalizer}{studioButton(track)}</> }
        : { placement: "dock" as const, onClose: () => musicPlayer.stop(), onExpand: () => setExpanded(true), swipeUpToExpand: true, swipeToSkip: true,
          spectrum: { levels: spectrum.levels },
          actionsSlot: <>
            {track.mediaId ? <Button type="button" variant="ghost" size="icon" data-testid="music-bar-like" aria-label={likeLabel} title={likeLabel} aria-pressed={liked}
              onClick={() => { void toggleLike().then((kept) => { if (!kept) push(i18n._({ id: "That could not be saved. Try again.", message: "That could not be saved. Try again." })); }); }}>{icon("heart", liked ? "fill-primary text-primary" : undefined)}</Button> : null}
            <SeekRow track={track} wide="w-24 lg:w-48 xl:w-72" />
            <PlayModeButtons />
            {lyrics ? <Button type="button" variant="ghost" size="icon" data-testid="music-bar-lyrics" aria-label={i18n._({ id: "Lyrics", message: "Lyrics" })} title={i18n._({ id: "Lyrics", message: "Lyrics" })} onClick={() => setExpanded(true)}>{icon("mic")}</Button> : null}
            <Button type="button" variant="ghost" size="icon" aria-label={queueLabel} title={queueLabel} aria-pressed={queueOpen} className={queueOpen ? "text-primary" : undefined} data-testid="music-bar-queue" onClick={pressQueue}>{icon("list-music")}</Button>
            <VolumeControl />
            {studioButton(track)}
          </> })} />
  );
  const follow = expanded && track.timed?.length ? <LyricsFollow track={track}>{(resume) => <Button type="button" variant="secondary" size="sm" data-testid="music-lyrics-follow" onClick={resume}>{i18n._({ id: "Back to current line", message: "Back to current line" })}</Button>}</LyricsFollow> : null;
  const title = i18n._({ id: "Now playing", message: "Now playing" });
  const lead = i18n._({ id: "The song, its words and the player controls.", message: "The song, its words and the player controls." });
  return (
    <>
      {expanded ? null : <div data-slot="global-mini-player" data-testid="music-player-bar" className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-2 pb-2 md:start-14 md:ps-4 md:pe-4 md:pb-4 print:hidden">
        <div className="pointer-events-auto surface-float relative overflow-hidden">{body}</div>
      </div>}
      <Drawer open={drawer !== null} onOpenChange={(open) => { if (!open) setDrawer(null); }}>
        <DrawerContent data-testid="music-queue-drawer">
          <DrawerHeader><DrawerTitle>{say("Queue")}</DrawerTitle><DrawerDescription className="sr-only">{say("The songs coming up, and the songs you played lately.")}</DrawerDescription></DrawerHeader>
          <Tabs value={drawer ?? QUEUE_TAB} onValueChange={(value) => { if (isMusicTab(value)) setDrawer(value as MusicPaneTab); }}>
            <TabsList>{queueTabs.map((one) => <TabsTrigger key={one.id} value={one.id}>{one.label}</TabsTrigger>)}</TabsList>
            {queueTabs.map((one) => <TabsContent key={one.id} value={one.id}><div className="max-h-[60vh] overflow-y-auto">{one.content}</div></TabsContent>)}
          </Tabs>
        </DrawerContent>
      </Drawer>
      {expanded && phone ? <Drawer open onOpenChange={(open) => { if (!open) setExpanded(false); }}>
        <DrawerContent data-testid="music-player-expanded" data-music-expanded>
          <DrawerHeader><DrawerTitle>{title}</DrawerTitle><DrawerDescription className="sr-only">{lead}</DrawerDescription></DrawerHeader>
          <div className="overflow-y-auto px-4 pb-6">{body}{follow}</div>
        </DrawerContent>
      </Drawer> : null}
      {expanded && !phone ? <Dialog open onOpenChange={(open) => { if (!open) setExpanded(false); }}>
        <DialogContent size="xl" scroll="viewport" data-testid="music-player-expanded" data-music-expanded>
          <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription className="sr-only">{lead}</DialogDescription></DialogHeader>
          {body}{follow}
        </DialogContent>
      </Dialog> : null}
      {shortcutsDialog}
    </>
  );
}

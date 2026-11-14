import { i18n } from "@lingui/core";
// MP-U4: the Music player bar. It is the shell's one bottom bar for a song made in Music, placed exactly where the global mini player is (same
// slot, same phone clearance above the nav) and drawn by the kit Player: `mini` is the bar, `audio` is the expanded player with the cover,
// the karaoke lyrics, shuffle and repeat. This file adds what Music needs beside them: the waveform seek bar, time, volume, shuffle and
// repeat on the bar, Open in Studio, and the keys. The song list, the details and the Studio all press play on `musicPlayer`; the bar only draws it.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Player } from "@maipai/ui/src/primitives/Player";
import { Button } from "@maipai/ui/src/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@maipai/ui/src/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@maipai/ui/src/ui/drawer";
import { Slider } from "@maipai/ui/src/ui/slider";
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
import { MusicQueueDrawer } from "./MusicQueuePane";
import { isMusicTab, musicPane, QUEUE_TAB, useMusicPane, type MusicPaneTab } from "./musicPane";

const icon = (name: string, className?: string) => { const One = getIcon(name); return <One aria-hidden="true" {...(className ? { className } : {})} />; };

/** What the bar says when Next has nowhere to go. */
export const LAST_SONG_LINE = () => i18n._({ id: "That was the last song in the list. Turn on repeat to go round again.", message: "That was the last song in the list. Turn on repeat to go round again." });

/** True for a key press that belongs to a text box, a menu or a slider, which the player keys must leave alone. */
export function keyBelongsToControl(target: EventTarget | null, key: string): boolean {
  const node = target as HTMLElement | null;
  if (!node || typeof node.closest !== "function") return false;
  if (node.isContentEditable || node.closest('input, textarea, select, [role="menu"], [role="menuitem"], [role="listbox"], [role="combobox"], [role="slider"], [role="dialog"]:not([data-music-expanded])')) return true;
  return key === " " && !!node.closest('button, a, [role="button"]');
}

/** Space, Left, Right, Up, Down, M, N and P for the song that is loaded. */
export function useMusicKeys(enabled: boolean, ask: { next: () => void }) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      if (keyBelongsToControl(event.target, key)) return;
      // Inside the kit Player its own handler already takes Space, the arrows and M.
      const inPlayer = !!(event.target as HTMLElement | null)?.closest?.('[data-slot="player"]');
      const ownByKit = inPlayer && (key === " " || key === "ArrowLeft" || key === "ArrowRight" || key === "m");
      if (ownByKit) return;
      const volume = musicPlayer.volume();
      if (key === " ") musicPlayer.playPause();
      else if (key === "ArrowLeft") musicPlayer.seekBy(-5);
      else if (key === "ArrowRight") musicPlayer.seekBy(5);
      else if (key === "ArrowUp") musicPlayer.setVolume(volume.volume + 0.05);
      else if (key === "ArrowDown") musicPlayer.setVolume(volume.volume - 0.05);
      else if (key === "m") musicPlayer.toggleMute();
      else if (key === "n") ask.next();
      else if (key === "p") musicPlayer.previous();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, ask]);
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

/** SF-08c: the queue button. It asks the shell's one right pane for the Queue tab; with no pane to give, the bar opens a drawer (see MusicPlayerBar). */
function QueueButton({ open, onPress }: { open: boolean; onPress: () => void }) {
  const label = i18n._({ id: "Queue", message: "Queue" });
  return <Button type="button" variant="ghost" size="icon" aria-label={label} title={label} aria-pressed={open} className={open ? "text-primary" : undefined} data-testid="music-bar-queue" onClick={onPress}>{icon("list-music")}</Button>;
}

function VolumeControl() {
  const { volume, muted } = useMusicVolume();
  const level = muted ? 0 : volume;
  return <span className="flex items-center" data-testid="music-bar-volume">
    <Button type="button" variant="ghost" size="icon" aria-label={muted ? i18n._({ id: "Unmute", message: "Unmute" }) : i18n._({ id: "Mute", message: "Mute" })} aria-pressed={muted} onClick={() => musicPlayer.toggleMute()}>{icon(level === 0 ? "volume-x" : level < 0.5 ? "volume-1" : "volume-2")}</Button>
    <span className="w-20 max-xl:hidden"><Slider aria-label={i18n._({ id: "Volume", message: "Volume" })} min={0} max={100} step={1} value={[Math.round(level * 100)]} onValueChange={(value) => { const next = Array.isArray(value) ? value[0] : value; if (typeof next === "number") musicPlayer.setVolume(next / 100); }} /></span>
  </span>;
}

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
  const session = useAudioSession();
  const dock = useMediaDock();
  const { push } = useToast();
  const phone = useIsPhoneLayout();
  const snap = useMusicPlayer();
  const mode = usePlayMode();
  const [expanded, setExpanded] = useState(false);
  const pane = useMusicPane();
  const [drawer, setDrawer] = useState<MusicPaneTab | null>(null);
  const held = dock.current;
  const track = snap.track;

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
  const latest = useRef(askNext); latest.current = askNext;
  const keys = useRef({ next: () => latest.current() }).current;
  useMusicKeys(!!track, keys);

  if (!track) return null;
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
        ? { shuffle: mode.shuffle, repeat: mode.repeat, onShuffle: () => setPlayMode({ shuffle: !getPlayMode().shuffle }), onRepeat: () => setPlayMode({ repeat: nextRepeat(getPlayMode().repeat) }), lyricsBlur: true, artSpring: true, ...(lyrics ? { lyrics } : {}), actionsSlot: studioButton(track) }
        : { placement: "dock" as const, onClose: () => musicPlayer.stop(), onExpand: () => setExpanded(true), swipeUpToExpand: true, swipeToSkip: true,
          actionsSlot: <>
            <SeekRow track={track} wide="w-24 lg:w-48 xl:w-72" />
            <PlayModeButtons />
            <QueueButton open={queueOpen} onPress={pressQueue} />
            <VolumeControl />
            {studioButton(track)}
          </> })} />
  );
  const title = i18n._({ id: "Now playing", message: "Now playing" });
  const lead = i18n._({ id: "The song, its words and the player controls.", message: "The song, its words and the player controls." });
  return (
    <>
      {expanded ? null : <div data-slot="global-mini-player" data-testid="music-player-bar" className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-2 pb-2 md:start-14 md:ps-4 md:pe-4 md:pb-4 print:hidden">
        <div className="pointer-events-auto surface-float relative overflow-hidden">{body}</div>
      </div>}
      <MusicQueueDrawer open={drawer !== null} onOpenChange={(open) => { if (!open) setDrawer(null); }} tab={drawer ?? QUEUE_TAB} onTabChange={(next) => { if (isMusicTab(next)) setDrawer(next); }} />
      {expanded && phone ? <Drawer open onOpenChange={(open) => { if (!open) setExpanded(false); }}>
        <DrawerContent data-testid="music-player-expanded" data-music-expanded>
          <DrawerHeader><DrawerTitle>{title}</DrawerTitle><DrawerDescription className="sr-only">{lead}</DrawerDescription></DrawerHeader>
          <div className="overflow-y-auto px-4 pb-6">{body}</div>
        </DrawerContent>
      </Drawer> : null}
      {expanded && !phone ? <Dialog open onOpenChange={(open) => { if (!open) setExpanded(false); }}>
        <DialogContent size="xl" scroll="viewport" data-testid="music-player-expanded" data-music-expanded>
          <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription className="sr-only">{lead}</DialogDescription></DialogHeader>
          {body}
        </DialogContent>
      </Dialog> : null}
    </>
  );
}

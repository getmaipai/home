// MP-U2: the one audio element the song list and the details panel share, so a row's play button, the details cover and the karaoke
// lyrics all follow the same sound. It joins the shell's audio session (one thing plays at a time, the media keys work); the full player
// bar is MP-U4's.
import { useCallback, useEffect, useRef, useState } from "react";
import { useAudioSession } from "@/shell/audioSessionContext";
import type { AudioHandle } from "@/shell/audioSession";

export interface RowTrack { key: string; url: string; title: string; artworkUrl?: string | null; loop?: boolean }
export interface RowPlayer {
  /** The key of the track loaded now (a version's file id, or a sound's id), or null. */
  key: string | null;
  playing: boolean;
  /** Seconds into the track, refreshed about 30 times a second while it plays and still when it does not. */
  time: number;
  /** Play the track; pressing it again while it plays pauses it. */
  toggle: (track: RowTrack) => void;
  seek: (seconds: number) => void;
  stop: () => void;
}

export function useRowPlayer(): RowPlayer {
  const session = useAudioSession();
  const audio = useRef<HTMLAudioElement | null>(null);
  const handle = useRef<AudioHandle | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);

  useEffect(() => () => { audio.current?.pause(); handle.current?.release(); handle.current = null; audio.current = null; }, []);

  // A smooth clock for the karaoke wipe: the element's own timeupdate is too coarse (about four a second).
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => { setTime(audio.current?.currentTime ?? 0); frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const toggle = useCallback((track: RowTrack) => {
    let el = audio.current;
    if (!el) {
      el = new Audio();
      el.preload = "auto";
      el.addEventListener("play", () => setPlaying(true));
      el.addEventListener("pause", () => setPlaying(false));
      el.addEventListener("ended", () => { setPlaying(false); setTime(0); });
      el.addEventListener("seeked", () => setTime(el?.currentTime ?? 0));
      audio.current = el;
    }
    const item = { title: track.title, ...(track.artworkUrl ? { artworkUrl: track.artworkUrl } : {}) };
    if (!handle.current) handle.current = session.registerElement(el, { kind: "music", item });
    else handle.current.updateItem(item);
    if (el.dataset.key === track.key) {
      if (el.paused) { handle.current.requestFocus(); void el.play().catch(() => setPlaying(false)); } else el.pause();
      return;
    }
    el.dataset.key = track.key;
    el.src = track.url;
    el.loop = track.loop === true;
    setKey(track.key); setTime(0);
    handle.current.requestFocus();
    void el.play().catch(() => setPlaying(false));
  }, [session]);

  const seek = useCallback((seconds: number) => { if (audio.current) { audio.current.currentTime = Math.max(0, seconds); setTime(audio.current.currentTime); } }, []);
  const stop = useCallback(() => { const el = audio.current; if (!el) return; el.pause(); el.removeAttribute("src"); delete el.dataset.key; setKey(null); setPlaying(false); setTime(0); }, []);

  return { key, playing, time, toggle, seek, stop };
}

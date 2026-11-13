// MP-U4: the one player for Music. The song list, the details panel and the Studio all press play on this one store; the bar (MusicPlayerBar)
// draws it. It owns one audio element, joins the shell's audio session (one thing plays at a time, the media keys work), and keeps the queue.
// It outlives the page, so a song carries on while the person moves between Music pages; Close in the bar stops it and drops the queue.
import { useSyncExternalStore } from "react";
import type { AudioHandle, AudioSession } from "@/shell/audioSession";
import { getPlayMode } from "@/shell/media/playMode";
import { pickNext, pickPrevious, queueFor, type Track } from "./musicQueue";

export type { Track } from "./musicQueue";

export interface MusicSnapshot {
  track: Track | null;
  queue: readonly Track[];
  index: number;
  playing: boolean;
  /** True when the browser could not play the file; cleared by the next song. */
  failed: boolean;
}

const VOLUME_KEY = "music.volume";
const EMPTY: MusicSnapshot = { track: null, queue: [], index: -1, playing: false, failed: false };

function readVolume(): { volume: number; muted: boolean } {
  try {
    const saved = JSON.parse(localStorage.getItem(VOLUME_KEY) ?? "null") as { volume?: unknown; muted?: unknown } | null;
    const volume = typeof saved?.volume === "number" && saved.volume >= 0 && saved.volume <= 1 ? saved.volume : 1;
    return { volume, muted: saved?.muted === true };
  } catch { return { volume: 1, muted: false }; }
}

export interface MusicPlayerStore {
  get(): MusicSnapshot;
  subscribe(listener: () => void): () => void;
  /** The audio element; made on first use. The bar hands it to the kit Player. */
  element(): HTMLAudioElement;
  /** Play `track`; the queue is the songs around it (the list's rows). Pressing the song that plays pauses it. */
  toggle(track: Track, queue?: readonly Track[]): void;
  playPause(): void;
  next(): void;
  /** False when Next has nowhere to go (the last song, repeat off). */
  canNext(): boolean;
  previous(): void;
  seek(seconds: number): void;
  seekBy(seconds: number): void;
  setVolume(volume: number): void;
  toggleMute(): void;
  volume(): { volume: number; muted: boolean };
  stop(): void;
  /** The shell's audio session, and what to do when this player starts (the bar clears the media dock). */
  bind(session: AudioSession | null, onStart?: () => void): void;
  /** Seconds and length as of the last clock tick (a frame while playing, and every seek, time and length event). The same object until
   * the next tick: React reads it twice per render, and Safari's `currentTime` moves between two reads (2026-11-13 crash). */
  clock(): { time: number; duration: number };
  subscribeClock(listener: () => void): () => void;
}

/** Made once per page for the shell; tests make their own with a fake element. */
export function createMusicPlayer(makeElement: () => HTMLAudioElement = () => new Audio()): MusicPlayerStore {
  let snap: MusicSnapshot = EMPTY;
  let el: HTMLAudioElement | null = null;
  let handle: AudioHandle | null = null;
  let session: AudioSession | null = null;
  let onStart: (() => void) | undefined;
  let played = new Set<string>();
  let history: string[] = [];
  let vol = readVolume();
  const listeners = new Set<() => void>();
  const clockListeners = new Set<() => void>();
  let frame = 0;
  let clockNow = { time: 0, duration: 0 };
  const set = (patch: Partial<MusicSnapshot>) => { snap = { ...snap, ...patch }; listeners.forEach((listener) => listener()); };
  /** Reads the element once and keeps the result until the next tick; a new object only when a number changed. */
  const readClock = () => {
    const time = el?.currentTime ?? 0, duration = el && Number.isFinite(el.duration) ? el.duration : snap.track?.duration ?? 0;
    if (time !== clockNow.time || duration !== clockNow.duration) clockNow = { time, duration };
  };
  const clockTick = () => { readClock(); clockListeners.forEach((listener) => listener()); };
  // A smooth clock for the waveform and the karaoke wipe: the element's own timeupdate is about four a second. Runs only while sound plays and someone watches.
  const startFrames = () => {
    if (frame || typeof requestAnimationFrame !== "function" || !snap.playing || clockListeners.size === 0) return;
    const tick = () => { clockTick(); frame = snap.playing && clockListeners.size > 0 ? requestAnimationFrame(tick) : 0; };
    frame = requestAnimationFrame(tick);
  };

  const ensure = (): HTMLAudioElement => {
    if (el) return el;
    const made = makeElement();
    made.preload = "auto";
    made.volume = vol.volume; made.muted = vol.muted;
    made.addEventListener("play", () => { set({ playing: true, failed: false }); startFrames(); });
    made.addEventListener("pause", () => { set({ playing: false }); clockTick(); });
    made.addEventListener("ended", () => { goNext(true); });
    made.addEventListener("error", () => set({ playing: false, failed: true }));
    // The kit Player's own M key and the session's sleep fade change the element directly; follow it so the bar's volume stays true.
    made.addEventListener("volumechange", () => {
      if (vol.volume === made.volume && vol.muted === made.muted) return;
      vol = { volume: made.volume, muted: made.muted };
      try { localStorage.setItem(VOLUME_KEY, JSON.stringify(vol)); } catch { /* the level lasts until reload */ }
      listeners.forEach((listener) => listener());
    });
    for (const name of ["seeked", "timeupdate", "durationchange", "loadedmetadata"] as const) made.addEventListener(name, clockTick);
    el = made;
    return made;
  };
  const register = (track: Track) => {
    const item = { title: track.title, ...(track.subtitle ? { artist: track.subtitle } : {}), ...(track.artworkUrl ? { artworkUrl: track.artworkUrl } : {}) };
    if (handle) { handle.updateItem(item); return; }
    if (session && el) handle = session.registerElement(el, { kind: "music", item, previous: () => store.previous(), next: () => store.next() });
  };
  const load = (queue: readonly Track[], index: number, fresh: boolean) => {
    const track = queue[index];
    if (!track) return;
    const audio = ensure();
    if (fresh) { played = new Set(); history = []; }
    played.add(track.key);
    onStart?.();
    register(track);
    audio.dataset.key = track.key;
    audio.src = track.url;
    audio.loop = track.loop === true;
    set({ track, queue, index, failed: false });
    clockTick();
    handle?.requestFocus();
    void audio.play().catch(() => set({ playing: false }));
  };
  const goNext = (ended: boolean): boolean => {
    const { queue, index, track } = snap;
    if (!track) return false;
    const at = pickNext({ queue, index, mode: getPlayMode(), played, ended });
    if (at === null) { if (ended) { set({ playing: false }); } return false; }
    if (at !== index) history.push(track.key);
    load(queue, at, false);
    return true;
  };

  const store: MusicPlayerStore = {
    get: () => snap,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    element: ensure,
    toggle(track, queue) {
      if (snap.track?.key === track.key && el) { store.playPause(); return; }
      const list = queueFor(track, queue);
      load(list, list.findIndex((one) => one.key === track.key), true);
    },
    playPause() {
      if (!el || !snap.track) return;
      if (el.paused) { handle?.requestFocus(); void el.play().catch(() => set({ playing: false })); } else el.pause();
    },
    next() { goNext(false); },
    canNext: () => !!snap.track && pickNext({ queue: snap.queue, index: snap.index, mode: getPlayMode(), played, ended: false, random: () => 0 }) !== null,
    previous() {
      const { queue, index, track } = snap;
      if (!track || !el) return;
      const to = pickPrevious({ queue, index, mode: getPlayMode(), time: el.currentTime, history });
      if (to === "restart") { el.currentTime = 0; clockTick(); if (el.paused) store.playPause(); return; }
      if (getPlayMode().shuffle) history.pop();
      load(queue, to, false);
    },
    seek(seconds) {
      if (!el) return;
      const length = Number.isFinite(el.duration) ? el.duration : seconds;
      el.currentTime = Math.min(Math.max(0, seconds), length);
      clockTick();
    },
    seekBy(seconds) { if (el) store.seek(el.currentTime + seconds); },
    setVolume(volume) {
      vol = { volume: Math.min(1, Math.max(0, volume)), muted: false };
      if (el) { el.volume = vol.volume; el.muted = false; }
      try { localStorage.setItem(VOLUME_KEY, JSON.stringify(vol)); } catch { /* the level lasts until reload */ }
      listeners.forEach((listener) => listener());
    },
    toggleMute() {
      vol = { ...vol, muted: !vol.muted };
      if (el) el.muted = vol.muted;
      try { localStorage.setItem(VOLUME_KEY, JSON.stringify(vol)); } catch { /* the level lasts until reload */ }
      listeners.forEach((listener) => listener());
    },
    volume: () => vol,
    stop() {
      if (el) { el.pause(); el.removeAttribute("src"); delete el.dataset.key; }
      handle?.release(); handle = null;
      played = new Set(); history = [];
      snap = EMPTY;
      listeners.forEach((listener) => listener());
      clockTick();
    },
    bind(next, start) {
      if (session !== next) { handle?.release(); handle = null; session = next; if (snap.track && el && next) register(snap.track); }
      onStart = start;
    },
    clock: () => clockNow,
    subscribeClock(listener) { readClock(); clockListeners.add(listener); startFrames(); return () => { clockListeners.delete(listener); }; },
  };
  return store;
}

/** The player the shell and the Music pages share. */
export const musicPlayer: MusicPlayerStore = createMusicPlayer();

export function useMusicPlayer(store: MusicPlayerStore = musicPlayer): MusicSnapshot & Pick<MusicPlayerStore, "toggle" | "playPause" | "next" | "previous" | "seek" | "seekBy" | "stop"> {
  const snap = useSyncExternalStore(store.subscribe, store.get, store.get);
  return { ...snap, toggle: store.toggle, playPause: store.playPause, next: store.next, previous: store.previous, seek: store.seek, seekBy: store.seekBy, stop: store.stop };
}
export type MusicPlayer = ReturnType<typeof useMusicPlayer>;

/** The level and mute, for the bar's volume control. */
export function useMusicVolume(store: MusicPlayerStore = musicPlayer): { volume: number; muted: boolean } {
  useSyncExternalStore(store.subscribe, store.get, store.get);
  return store.volume();
}

/** Seconds into the song and its length, refreshed about 60 times a second while it plays. Only what draws a clock should call this.
 * The snapshot is the store's cached tick, never a fresh element read (a fresh read differs between React's two reads in Safari). */
export function useMusicClock(store: MusicPlayerStore = musicPlayer): { time: number; duration: number } {
  return useSyncExternalStore(store.subscribeClock, store.clock, store.clock);
}

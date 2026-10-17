// AUDIO-SESSION-01: the one audio session of the shell. One thing plays at a time across the media apps and chat voice
// (read-aloud and spoken replies). The session coordinates; it draws nothing (RULES S2: the docked mini bar is the kit
// Player's `mini` layout, placed by a media app inside its own area; S6: no status UI of its own).
//
//   register(element|voice, {kind, item}) -> handle   a player hands the session what it plays
//   handle.requestFocus()                              pauses whatever else plays; an element's own `play` event does this too
//   handle.release()                                   the player is done (unmount, source changed)
//
// It also owns: playback speed per kind (person settings `audio.speed.<kind>`, applied on register, written back when the
// person changes the rate), one sleep timer that fades and pauses the focused thing, and the Media Session metadata and
// action handlers (published once). React reads it through audioSessionContext.tsx.

export type SpeedKind = "podcast" | "audiobook" | "video" | "spoken_reply";
export type AudioKind = SpeedKind | "music";
export const SPEED_KINDS: readonly SpeedKind[] = ["podcast", "audiobook", "video", "spoken_reply"];
export const SPEED_MIN = 0.5;
export const SPEED_MAX = 3;
export const speedSettingKey = (kind: SpeedKind): string => `audio.speed.${kind}`;

export interface AudioChapter { start_s: number; end_s: number; title?: string }
export interface AudioItem {
  title: string;
  artist?: string;
  album?: string;
  artworkUrl?: string;
  /** With chapters, the sleep timer's "end of chapter or episode" stops at the end of the chapter playing now. */
  chapters?: readonly AudioChapter[];
}

/** Something that plays sound without an HTMLMediaElement (chat voice runs on Web Audio). */
export interface VoiceSource {
  pause(): void;
  resume?(): void;
  /** 0 to 1, for the sleep timer's fade. */
  setVolume?(volume: number): void;
  setRate?(rate: number): void;
}

export interface RegisterOptions {
  kind: AudioKind;
  item: AudioItem;
  /** Media Session previoustrack / nexttrack, when the app has a queue. */
  previous?: () => void;
  next?: () => void;
}

export interface AudioHandle {
  /** Make this the playing thing: pauses whatever else plays. Call it before `element.play()`. */
  requestFocus(): void;
  release(): void;
  updateItem(item: AudioItem): void;
  readonly focused: boolean;
}

export type SleepOption = 15 | 30 | 45 | 60 | "end_of_item";
export const SLEEP_OPTIONS: readonly SleepOption[] = [15, 30, 45, 60, "end_of_item"];

export interface CurrentAudio {
  kind: AudioKind;
  item: AudioItem;
  playing: boolean;
  /** Playback speed now (1 for music and chat voice without a rate). */
  rate: number;
  hasPrevious: boolean;
  hasNext: boolean;
}

/** What a media app needs to place the kit Player's `mini` layout. Null when nothing is loaded or only chat voice plays. */
export type MiniBarState = CurrentAudio;

export interface AudioSnapshot {
  current: CurrentAudio | null;
  miniBar: MiniBarState | null;
  sleep: { option: SleepOption; endsAt: number | null } | null;
  /** True after the sleep timer stopped playback at the end of an item, until anything plays again. An app that
   * advances to the next item on `ended` checks this first. */
  sleepHold: boolean;
}

export interface TimeSnapshot { position: number; duration: number }

export const FADE_MS = 4000;
const FADE_STEP_MS = 100;
const SEEK_BACK_S = 15;
const SEEK_FORWARD_S = 30;
const RELEASE_GRACE_S = 0.25;

type Writer = (kind: SpeedKind, rate: number) => void;

interface Entry {
  id: number;
  kind: AudioKind;
  item: AudioItem;
  el: HTMLMediaElement | null;
  voice: VoiceSource | null;
  previous: (() => void) | undefined;
  next: (() => void) | undefined;
  /** The rate the session last set; a different rate on `ratechange` is the person's choice. */
  appliedRate: number;
  playing: boolean;
  detach: () => void;
}

const isSpeedKind = (kind: AudioKind): kind is SpeedKind => (SPEED_KINDS as readonly string[]).includes(kind);
/** An app often passes a fresh object literal each render; only a real change republishes. */
const sameItem = (a: AudioItem, b: AudioItem): boolean =>
  a === b || (a.title === b.title && a.artist === b.artist && a.album === b.album && a.artworkUrl === b.artworkUrl && JSON.stringify(a.chapters ?? null) === JSON.stringify(b.chapters ?? null));
const clampRate = (rate: number): number => Math.min(SPEED_MAX, Math.max(SPEED_MIN, rate));

export function createAudioSession() {
  let nextId = 1;
  const entries = new Set<Entry>();
  let focused: Entry | null = null;
  let speeds: Partial<Record<SpeedKind, number>> = {};
  let writer: Writer | null = null;
  let sleep: { option: SleepOption; endsAt: number | null; timer: ReturnType<typeof setTimeout> | null } | null = null;
  let fade: { entry: Entry; base: number; elapsed: number; ms: number; timer: ReturnType<typeof setInterval> } | null = null;
  let sleepHold = false;
  let mediaSessionInstalled = false;
  let snapshot: AudioSnapshot = { current: null, miniBar: null, sleep: null, sleepHold: false };
  let time: TimeSnapshot = { position: 0, duration: 0 };
  const listeners = new Set<() => void>();
  const timeListeners = new Set<() => void>();
  let lastPositionPublish = 0;

  // ---- snapshot -----------------------------------------------------------------------------------------------

  function rateOf(entry: Entry): number {
    if (entry.el) return entry.el.playbackRate || 1;
    return entry.appliedRate;
  }

  function computeSnapshot(): AudioSnapshot {
    const current: CurrentAudio | null = focused
      ? { kind: focused.kind, item: focused.item, playing: focused.playing, rate: rateOf(focused), hasPrevious: Boolean(focused.previous), hasNext: Boolean(focused.next) }
      : null;
    return {
      current,
      miniBar: current && current.kind !== "spoken_reply" ? current : null,
      sleep: sleep ? { option: sleep.option, endsAt: sleep.endsAt } : null,
      sleepHold,
    };
  }

  function publish(): void {
    const next = computeSnapshot();
    const a = snapshot.current;
    const b = next.current;
    const same =
      a === b ||
      (a !== null && b !== null && a.kind === b.kind && a.item === b.item && a.playing === b.playing && a.rate === b.rate && a.hasPrevious === b.hasPrevious && a.hasNext === b.hasNext);
    const sleepSame = (snapshot.sleep === null && next.sleep === null) || (snapshot.sleep !== null && next.sleep !== null && snapshot.sleep.option === next.sleep.option && snapshot.sleep.endsAt === next.sleep.endsAt);
    if (same && sleepSame && snapshot.sleepHold === next.sleepHold) return;
    snapshot = same ? { ...next, current: a, miniBar: snapshot.miniBar } : next;
    updateMediaSession();
    for (const listener of [...listeners]) listener();
  }

  function publishTime(entry: Entry): void {
    if (entry !== focused || !entry.el) return;
    const position = entry.el.currentTime || 0;
    const duration = Number.isFinite(entry.el.duration) ? entry.el.duration : 0;
    if (time.position === position && time.duration === duration) return;
    time = { position, duration };
    for (const listener of [...timeListeners]) listener();
    const now = Date.now();
    if (now - lastPositionPublish >= 1000) {
      lastPositionPublish = now;
      updatePositionState(entry);
    }
  }

  // ---- Media Session (installed once) -------------------------------------------------------------------------

  function mediaSession(): MediaSession | null {
    return typeof navigator !== "undefined" && "mediaSession" in navigator ? navigator.mediaSession : null;
  }

  function installMediaSession(): void {
    if (mediaSessionInstalled) return;
    const ms = mediaSession();
    if (!ms) return;
    mediaSessionInstalled = true;
    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler): void => {
      try { ms.setActionHandler(action, handler); } catch { /* an action this browser lacks */ }
    };
    set("play", () => controls.play());
    set("pause", () => controls.pause());
    set("stop", () => controls.stop());
    set("seekbackward", (details) => controls.seekBy(-(details.seekOffset ?? SEEK_BACK_S)));
    set("seekforward", (details) => controls.seekBy(details.seekOffset ?? SEEK_FORWARD_S));
    set("seekto", (details) => { if (details.seekTime !== undefined) controls.seekTo(details.seekTime); });
    set("previoustrack", () => { if (focused?.previous) focused.previous(); else controls.seekTo(0); });
    set("nexttrack", () => { if (focused?.next) focused.next(); else controls.seekBy(SEEK_FORWARD_S); });
  }

  function updateMediaSession(): void {
    const ms = mediaSession();
    if (!ms || !mediaSessionInstalled) return;
    if (!focused) {
      ms.metadata = null;
      ms.playbackState = "none";
      return;
    }
    const { item } = focused;
    if (typeof MediaMetadata !== "undefined") {
      ms.metadata = new MediaMetadata({
        title: item.title,
        artist: item.artist ?? "",
        album: item.album ?? "",
        artwork: item.artworkUrl ? [{ src: item.artworkUrl }] : [],
      });
    }
    ms.playbackState = focused.playing ? "playing" : "paused";
  }

  function updatePositionState(entry: Entry): void {
    const ms = mediaSession();
    if (!ms || !entry.el || !Number.isFinite(entry.el.duration) || entry.el.duration <= 0) return;
    try {
      ms.setPositionState({ duration: entry.el.duration, position: Math.min(entry.el.currentTime, entry.el.duration), playbackRate: entry.el.playbackRate || 1 });
    } catch { /* an out-of-range position while seeking */ }
  }

  // ---- speed ---------------------------------------------------------------------------------------------------

  function speedFor(kind: AudioKind): number {
    if (!isSpeedKind(kind)) return 1;
    const value = speeds[kind];
    return typeof value === "number" && Number.isFinite(value) ? clampRate(value) : 1;
  }

  function applyRate(entry: Entry, rate: number): void {
    entry.appliedRate = rate;
    if (entry.el) {
      entry.el.defaultPlaybackRate = rate;
      if (entry.el.playbackRate !== rate) entry.el.playbackRate = rate;
    } else entry.voice?.setRate?.(rate);
  }

  /** The person's saved speeds arrived or changed elsewhere (Settings, another tab): apply to what is registered. */
  function setSpeeds(next: Partial<Record<SpeedKind, number>>): void {
    speeds = { ...next };
    for (const entry of entries) {
      const rate = speedFor(entry.kind);
      if (isSpeedKind(entry.kind) && rate !== entry.appliedRate) applyRate(entry, rate);
    }
    publish();
  }

  function onRateChange(entry: Entry): void {
    const el = entry.el;
    if (!el || !isSpeedKind(entry.kind)) return;
    const rate = clampRate(el.playbackRate);
    if (el.playbackRate === entry.appliedRate) return;
    // The person changed the rate (the Player's menu, a key): it becomes their speed for this kind.
    entry.appliedRate = el.playbackRate;
    if (speeds[entry.kind] !== rate) {
      speeds = { ...speeds, [entry.kind]: rate };
      el.defaultPlaybackRate = el.playbackRate;
      for (const other of entries) {
        if (other !== entry && other.kind === entry.kind && other.appliedRate !== rate) applyRate(other, rate);
      }
      writer?.(entry.kind, rate);
    }
    publish();
  }

  // ---- focus ---------------------------------------------------------------------------------------------------

  function pauseEntry(entry: Entry): void {
    if (fade && fade.entry === entry) endFade(true);
    entry.playing = false;
    if (entry.el) {
      if (!entry.el.paused) entry.el.pause();
    } else entry.voice?.pause();
  }

  function takeFocus(entry: Entry): void {
    if (focused && focused !== entry) pauseEntry(focused);
    focused = entry;
    sleepHold = false;
    installMediaSession();
    publish();
  }

  function releaseEntry(entry: Entry): void {
    if (!entries.has(entry)) return;
    entry.detach();
    entries.delete(entry);
    if (fade && fade.entry === entry) endFade(false);
    if (focused === entry) {
      focused = null;
      if (sleep?.option === "end_of_item") cancelSleep();
      time = { position: 0, duration: 0 };
      for (const listener of [...timeListeners]) listener();
    }
    publish();
  }

  function makeEntry(opts: RegisterOptions, el: HTMLMediaElement | null, voice: VoiceSource | null): { entry: Entry; handle: AudioHandle } {
    const entry: Entry = {
      id: nextId++,
      kind: opts.kind,
      item: opts.item,
      el,
      voice,
      previous: opts.previous,
      next: opts.next,
      appliedRate: 1,
      playing: false,
      detach: () => {},
    };
    entries.add(entry);
    const handle: AudioHandle = {
      requestFocus: () => { if (entries.has(entry)) takeFocus(entry); },
      release: () => releaseEntry(entry),
      updateItem: (item) => {
        if (sameItem(entry.item, item)) return;
        entry.item = item;
        if (focused === entry) publish();
      },
      get focused() { return focused === entry; },
    };
    return { entry, handle };
  }

  function registerElement(el: HTMLMediaElement, opts: RegisterOptions): AudioHandle {
    const { entry, handle } = makeEntry(opts, el, null);
    if (isSpeedKind(opts.kind)) applyRate(entry, speedFor(opts.kind));
    else entry.appliedRate = el.playbackRate || 1;
    entry.playing = !el.paused && !el.ended;
    const on = (type: string, listener: () => void): (() => void) => {
      el.addEventListener(type, listener);
      return () => el.removeEventListener(type, listener);
    };
    const offs = [
      on("play", () => { entry.playing = true; takeFocus(entry); }),
      on("playing", () => { if (!entry.playing) { entry.playing = true; takeFocus(entry); } }),
      on("pause", () => { entry.playing = false; if (focused === entry) publish(); }),
      on("ended", () => {
        entry.playing = false;
        if (focused === entry && sleep?.option === "end_of_item") {
          cancelSleep();
          sleepHold = true;
        }
        if (focused === entry) publish();
      }),
      on("ratechange", () => onRateChange(entry)),
      on("loadedmetadata", () => { if (isSpeedKind(entry.kind)) applyRate(entry, speedFor(entry.kind)); publishTime(entry); }),
      on("durationchange", () => publishTime(entry)),
      on("seeked", () => publishTime(entry)),
      on("timeupdate", () => { publishTime(entry); if (focused === entry) checkEndOfItem(entry); }),
    ];
    entry.detach = () => { for (const off of offs) off(); };
    if (entry.playing) takeFocus(entry);
    return handle;
  }

  function registerVoice(source: VoiceSource, opts?: Partial<RegisterOptions>): AudioHandle {
    const { entry, handle } = makeEntry({ kind: "spoken_reply", item: { title: "MaiPai" }, ...opts }, null, source);
    applyRate(entry, speedFor(entry.kind));
    entry.playing = true;
    return handle;
  }

  // ---- controls (the mini bar and Media Session call these) -----------------------------------------------------

  const controls = {
    play(): void {
      const entry = focused;
      if (!entry) return;
      takeFocus(entry);
      entry.playing = true;
      if (entry.el) void Promise.resolve(entry.el.play()).catch(() => { entry.playing = false; publish(); });
      else entry.voice?.resume?.();
      publish();
    },
    pause(): void {
      if (focused) pauseEntry(focused);
      publish();
    },
    toggle(): void {
      if (focused?.playing) controls.pause(); else controls.play();
    },
    stop(): void {
      if (focused) {
        pauseEntry(focused);
        if (focused.el) focused.el.currentTime = 0;
      }
      publish();
    },
    seekBy(seconds: number): void {
      const el = focused?.el;
      if (el) controls.seekTo(el.currentTime + seconds);
    },
    seekTo(seconds: number): void {
      const el = focused?.el;
      if (!el) return;
      const duration = Number.isFinite(el.duration) ? el.duration : Infinity;
      el.currentTime = Math.min(Math.max(0, seconds), duration);
    },
    /** The person picks a speed (the mini bar's menu): applied to the focused thing and saved as their speed for its kind. */
    setRate(rate: number): void {
      const entry = focused;
      if (!entry || !isSpeedKind(entry.kind)) return;
      const next = clampRate(rate);
      if (entry.el) entry.el.playbackRate = next; // fires ratechange, which writes it back
      else {
        applyRate(entry, next);
        speeds = { ...speeds, [entry.kind]: next };
        writer?.(entry.kind, next);
      }
      publish();
    },
    previous(): void { focused?.previous?.(); },
    next(): void { focused?.next?.(); },
  };

  // ---- sleep timer ----------------------------------------------------------------------------------------------

  function volumeOf(entry: Entry): number {
    return entry.el ? entry.el.volume : 1;
  }
  function setVolume(entry: Entry, volume: number): void {
    const v = Math.min(1, Math.max(0, volume));
    if (entry.el) entry.el.volume = v;
    else entry.voice?.setVolume?.(v);
  }

  function endFade(restore: boolean): void {
    if (!fade) return;
    clearInterval(fade.timer);
    const { entry, base } = fade;
    fade = null;
    if (restore) setVolume(entry, base);
  }

  /** Fade the focused thing to silence over `ms`, then pause it and put the volume back for the next play. */
  function beginFade(ms: number): void {
    const entry = focused;
    if (!entry || !entry.playing || fade) return;
    const base = volumeOf(entry);
    const timer = setInterval(() => {
      if (!fade) return;
      // Counted in steps, not read from the clock, so a throttled background tab still ends the fade on time.
      fade.elapsed += FADE_STEP_MS;
      const t = Math.min(1, fade.elapsed / fade.ms);
      if (t >= 1) { finishSleep(entry, base); return; }
      setVolume(entry, base * (1 - t));
    }, FADE_STEP_MS);
    fade = { entry, base, elapsed: 0, ms: Math.max(1, ms), timer };
  }

  function finishSleep(entry: Entry, base: number): void {
    endFade(false);
    pauseEntry(entry);
    setVolume(entry, base);
    cancelSleep();
    publish();
  }

  function cancelSleep(): void {
    if (sleep?.timer) clearTimeout(sleep.timer);
    sleep = null;
    if (fade) endFade(true);
    publish();
  }

  function startSleep(option: SleepOption): void {
    cancelSleep();
    sleepHold = false;
    if (option === "end_of_item") {
      sleep = { option, endsAt: null, timer: null };
      publish();
      if (focused) checkEndOfItem(focused);
      return;
    }
    const total = option * 60_000;
    const endsAt = Date.now() + total;
    // The fade ends exactly at the deadline, so "15 minutes" pauses at 15 minutes.
    const timer = setTimeout(() => {
      const entry = focused;
      if (!entry || !entry.playing) { cancelSleep(); return; }
      beginFade(FADE_MS);
    }, Math.max(0, total - FADE_MS));
    sleep = { option, endsAt, timer };
    publish();
  }

  /** "End of chapter or episode": the boundary is the end of the chapter playing now, else the end of the item. */
  function checkEndOfItem(entry: Entry): void {
    if (sleep?.option !== "end_of_item" || !entry.el || !entry.playing) return;
    const el = entry.el;
    const duration = Number.isFinite(el.duration) ? el.duration : 0;
    const chapter = entry.item.chapters?.find((c) => el.currentTime >= c.start_s && el.currentTime < c.end_s);
    const boundary = chapter ? chapter.end_s : duration;
    if (boundary <= 0) return;
    const remainingMs = ((boundary - el.currentTime) / (el.playbackRate || 1)) * 1000;
    if (chapter && remainingMs <= RELEASE_GRACE_S * 1000) {
      const base = fade ? fade.base : volumeOf(entry);
      finishSleep(entry, base);
      return;
    }
    if (!fade && remainingMs <= FADE_MS) beginFade(Math.max(remainingMs, FADE_STEP_MS));
  }

  // ---- public ---------------------------------------------------------------------------------------------------

  return {
    registerElement,
    registerVoice,
    controls,
    startSleepTimer: startSleep,
    cancelSleepTimer: cancelSleep,
    setSpeeds,
    /** The shell wires this once (the provider): how a rate the person chose is saved. */
    setSpeedWriter(next: Writer | null): void { writer = next; },
    speedFor,
    subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot(): AudioSnapshot { return snapshot; },
    subscribeTime(listener: () => void): () => void { timeListeners.add(listener); return () => { timeListeners.delete(listener); }; },
    getTime(): TimeSnapshot { return time; },
    /** Test seam. */
    _reset(): void {
      for (const entry of [...entries]) releaseEntry(entry);
      cancelSleep();
      speeds = {};
      writer = null;
      sleepHold = false;
    },
  };
}

export type AudioSession = ReturnType<typeof createAudioSession>;

/** The shell's one session. Chat voice classes in lib/ import it directly; React reads it through the provider. */
export const audioSession: AudioSession = createAudioSession();

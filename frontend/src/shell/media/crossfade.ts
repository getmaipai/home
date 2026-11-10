// MEDIA-PARITY-02: crossfade. The end of a song fades out while the start of the next fades in, over `music.crossfade_s` seconds (0 to 12).
// Two audio elements, volume ramps: the held element fades out and a second element (the next song, started silent) fades in. When the
// fade ends the host takes the second element as the held one, so the song carries on without a restart. Only songs crossfade: a station,
// podcast or audiobook never does, a song that repeats itself never does, and nothing starts unless the next song is there.
// iOS ignores a script's volume on an element, so a crossfade there would be a hard overlap; it is skipped on iOS.

export const CROSSFADE_MAX_S = 12;
const TICK_MS = 50;

/** The stored setting as a whole number of seconds from 0 to 12; anything else is 0. */
export function crossfadeSeconds(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(CROSSFADE_MAX_S, Math.max(0, Math.round(value))) : 0;
}

/** Whether the held item may crossfade at all: a song of the Music app, not a live station, not looping, and long enough for the fade. */
export function mayCrossfade(held: { appId: string; kind: string; live: boolean; loop: boolean; duration: number }, seconds: number, ios = false): boolean {
  if (ios || seconds <= 0 || held.appId !== "music" || held.kind !== "audio" || held.live || held.loop) return false;
  return Number.isFinite(held.duration) && held.duration >= seconds * 2;
}

/** The fade has begun when the song has `seconds` or less to go (and has not already ended). */
export const fadeDue = (el: Pick<HTMLMediaElement, "currentTime" | "duration" | "paused" | "ended">, seconds: number): boolean =>
  !el.paused && !el.ended && Number.isFinite(el.duration) && el.duration - el.currentTime <= seconds;

export interface FadeRun {
  /** Stop without handing over: the incoming element is dropped and the held one is back at its own volume. */
  abort(): void;
}

export interface FadeOptions {
  from: HTMLMediaElement;
  to: HTMLMediaElement;
  seconds: number;
  /** The fade finished (or the person paused, or the song ended): hand over to `to`. `paused` is true when the person paused during the fade. */
  onDone(result: { paused: boolean }): void;
  /** Drop the incoming element after an abort. */
  onAbort(): void;
  setTimer?: (tick: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/** Ramps `from` down and `to` up with an equal-power curve over the time `from` has left (at most `seconds`). The sound never exceeds the volume the person had set. */
export function runCrossfade(options: FadeOptions): FadeRun {
  const { from, to, seconds } = options;
  const setTimer = options.setTimer ?? ((tick, ms) => setInterval(tick, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearInterval(handle as ReturnType<typeof setInterval>));
  const level = from.volume;
  const total = Math.max(0.1, Math.min(seconds, Number.isFinite(from.duration) ? from.duration - from.currentTime : seconds));
  const startedAt = from.currentTime;
  let finished = false;
  to.volume = 0;
  const stop = () => { finished = true; clearTimer(handle); from.removeEventListener("pause", onPause); from.removeEventListener("ended", onEnded); };
  const finish = (paused: boolean) => {
    if (finished) return;
    stop();
    to.volume = level;
    from.volume = level;
    options.onDone({ paused });
  };
  const onPause = () => finish(!from.ended);
  const onEnded = () => finish(false);
  from.addEventListener("pause", onPause);
  from.addEventListener("ended", onEnded);
  const tick = () => {
    if (finished) return;
    const done = from.currentTime - startedAt;
    // The person moved back in the song: the fade is off, and the song goes on as it was.
    if (done < -0.5) { stop(); from.volume = level; options.onAbort(); return; }
    const fraction = Math.min(1, Math.max(0, done / total));
    from.volume = level * Math.cos(fraction * Math.PI / 2);
    to.volume = level * Math.sin(fraction * Math.PI / 2);
    if (fraction >= 1) finish(false);
  };
  const handle = setTimer(tick, TICK_MS);
  return { abort() { if (finished) return; stop(); from.volume = level; options.onAbort(); } };
}

/** Elements whose song was handed over to the next one by a crossfade: the host's song-ended step must not advance them a second time. */
export const handedOff = new WeakSet<HTMLMediaElement>();

export interface CrossfadeNext { id: string; src: string; title: string; subtitle?: string; poster?: string }
export interface CrossfadeHeld { id: string; appId: string; kind: string; src: string; el: HTMLMediaElement; live: boolean }
export interface CrossfadeDeps {
  seconds: number;
  ios?: boolean;
  /** The store the host holds the song in. */
  store: {
    get(): { el: HTMLMediaElement } | null;
    prime(ref: { id: string; src: string }, el: HTMLMediaElement): void;
    unprime(el: HTMLMediaElement): void;
    elementFor(ref: { id: string; src: string; kind: "audio"; title: string; subtitle?: string; poster?: string }, appId: string): HTMLMediaElement;
  };
  /** Which song comes next in the queue (shuffle and repeat applied); null when there is none. */
  pickNext(held: CrossfadeHeld): Promise<string | null>;
  /** The next song's playable data; null when it is missing. */
  readNext(id: string): Promise<CrossfadeNext | null>;
  makeElement(): HTMLMediaElement;
  /** The next song is now the held one: move the queue to it, remember the old one, show it. */
  afterHandOff(info: { from: CrossfadeHeld; next: CrossfadeNext; el: HTMLMediaElement }): void;
  setTimer?: FadeOptions["setTimer"];
  clearTimer?: FadeOptions["clearTimer"];
}

const release = (el: HTMLMediaElement) => { el.pause(); el.removeAttribute("src"); el.load(); el.remove(); };

/** Watches the held song and, when it has `seconds` left, fades it into the next one. Returns the cleanup: if the held song changes first, a fade under way is cancelled and the held song is back at its own volume. */
export function attachCrossfade(held: CrossfadeHeld, deps: CrossfadeDeps): () => void {
  const el = held.el;
  let state: "idle" | "preparing" | "fading" | "done" = "idle";
  let disposed = false;
  let incoming: HTMLMediaElement | null = null;
  let run: FadeRun | null = null;
  const still = () => !disposed && deps.store.get()?.el === el;

  const handOff = (next: CrossfadeNext, paused: boolean) => {
    state = "done";
    const taken = incoming!;
    incoming = null;
    handedOff.add(el);
    const there = deps.store.elementFor({ id: next.id, src: next.src, kind: "audio", title: next.title, subtitle: next.subtitle, poster: next.poster }, held.appId);
    if (paused) there.pause();
    deps.afterHandOff({ from: held, next, el: taken });
  };

  const begin = async () => {
    try {
      const nextId = await deps.pickNext(held);
      if (!still()) return;
      if (!nextId || nextId === held.id) { state = "done"; return; }
      const next = await deps.readNext(nextId);
      if (!still()) return;
      if (!next || !next.src) { state = "done"; return; }
      const audio = deps.makeElement();
      audio.setAttribute("src", next.src);
      audio.volume = 0;
      incoming = audio;
      try { await audio.play(); } catch { release(audio); incoming = null; state = "done"; return; }
      if (!still() || el.paused) { release(audio); incoming = null; state = disposed ? state : "done"; return; }
      deps.store.prime({ id: next.id, src: next.src }, audio);
      state = "fading";
      run = runCrossfade({
        from: el, to: audio, seconds: deps.seconds, setTimer: deps.setTimer, clearTimer: deps.clearTimer,
        onDone: ({ paused }) => handOff(next, paused),
        onAbort: () => { deps.store.unprime(audio); incoming = null; state = "done"; },
      });
    } catch {
      if (incoming) { release(incoming); incoming = null; }
      state = "done";
    }
  };

  const onTime = () => {
    if (state !== "idle" || disposed) return;
    if (!mayCrossfade({ appId: held.appId, kind: held.kind, live: held.live, loop: el.loop, duration: el.duration }, deps.seconds, deps.ios)) return;
    if (!fadeDue(el, deps.seconds)) return;
    state = "preparing";
    void begin();
  };
  el.addEventListener("timeupdate", onTime);
  return () => {
    disposed = true;
    el.removeEventListener("timeupdate", onTime);
    if (state === "fading") run?.abort();
    else if (incoming) { release(incoming); incoming = null; }
  };
}

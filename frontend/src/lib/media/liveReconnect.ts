// A live station's stream drops: retry with backoff, and tell the person only after the last attempt fails.
export const MAX_RECONNECT_ATTEMPTS = 4;

/** Wait before retry number `attempt` (1 to 4): 1, 2, 4, 8 seconds. Null means give up. */
export function reconnectDelayMs(attempt: number): number | null {
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > MAX_RECONNECT_ATTEMPTS) return null;
  return 1000 * 2 ** (attempt - 1);
}

type Timer = ReturnType<typeof setTimeout>;
export type ReconnectTimers = { set: (fn: () => void, ms: number) => Timer; clear: (t: Timer) => void };

/**
 * Watches a live element. On error, stalled or ended it reloads the stream after the backoff delay, unless the person paused on purpose.
 * `reload` restarts the source (hls.js or a plain load). `giveUp` runs once after the last attempt fails. Returns the cleanup.
 */
export function watchLiveReconnect(
  el: HTMLMediaElement,
  reload: () => void,
  giveUp: () => void,
  timers: ReconnectTimers = { set: (fn, ms) => setTimeout(fn, ms), clear: (t) => clearTimeout(t) },
): () => void {
  let attempt = 0;
  let timer: Timer | null = null;
  let userPaused = false;
  let gaveUp = false;
  // Only a stream the person asked for can drop. An element that was never asked to play (a closed station the page asked the host for
  // again) loads, stalls and errors on its own; retrying it would call play() and restart the station that was just closed.
  let asked = !el.paused || el.autoplay;
  const cancel = () => { if (timer !== null) { timers.clear(timer); timer = null; } };
  const retry = () => {
    timer = null;
    if (userPaused) return;
    reload();
    void el.play().catch(() => undefined);
  };
  const drop = () => {
    // One pending retry at a time: error, stalled and ended often arrive together for the same drop.
    if (!asked || userPaused || gaveUp || timer !== null) return;
    attempt += 1;
    const delay = reconnectDelayMs(attempt);
    if (delay === null) { gaveUp = true; giveUp(); return; }
    timer = timers.set(retry, delay);
  };
  // A pause that is not the stream ending or failing is the person's own.
  const onPause = () => { if (!el.ended && !el.error) { userPaused = true; cancel(); } };
  const onPlay = () => { userPaused = false; asked = true; };
  const onPlaying = () => { attempt = 0; gaveUp = false; cancel(); };
  const events: Array<[string, () => void]> = [["error", drop], ["stalled", drop], ["ended", drop], ["pause", onPause], ["play", onPlay], ["playing", onPlaying]];
  for (const [name, fn] of events) el.addEventListener(name, fn);
  return () => { cancel(); for (const [name, fn] of events) el.removeEventListener(name, fn); };
}

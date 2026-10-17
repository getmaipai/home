// One shared microphone stream for the whole page. Dictation, the live voice
// session, the wake word and the permission probe all ask here instead of
// calling getUserMedia themselves. A release does not stop the tracks right
// away: they stay open for MIC_GRACE_MS so a quick reopen reuses the stream
// (no second browser prompt in Safari), then stop so the browser's mic
// indicator goes off. Nothing keeps the mic open longer than the grace.
export const MIC_GRACE_MS = 10_000;

export interface MicStreamDeps {
  /** Test-only: grace before an unused stream stops (default MIC_GRACE_MS). */
  graceMs?: number;
}

export interface MicLease {
  stream: MediaStream;
  /** Give the stream back; idempotent. Tracks stop after the grace period if no one else holds it. */
  release: () => void;
}

interface Held { key: string; stream: MediaStream; refs: number; timer: ReturnType<typeof setTimeout> | null }
let held: Held | null = null;
let pending: { key: string; promise: Promise<Held> } | null = null;

const isLive = (stream: MediaStream) => stream.getTracks().length > 0 && stream.getTracks().every((t) => t.readyState !== "ended");

function stopNow(h: Held) {
  if (h.timer) clearTimeout(h.timer);
  h.timer = null;
  for (const track of h.stream.getTracks()) {
    try { track.stop(); } catch { /* ignore */ }
  }
  if (held === h) held = null;
}

/** `key` names the stream shape (e.g. the chosen device); `open` is the one
 * getUserMedia call, made only when nothing live is held for that key. On a
 * cold start `open` runs before any await, so a Safari tap still counts. */
export async function acquireMicStream(key: string, open: () => Promise<MediaStream>, deps: MicStreamDeps = {}): Promise<MicLease> {
  const graceMs = deps.graceMs ?? MIC_GRACE_MS;
  let h: Held | null = held && held.key === key && isLive(held.stream) ? held : null;
  if (!h && held && held.refs === 0) stopNow(held); // a different shape: do not leave the old one open
  if (!h && pending && pending.key === key) h = await pending.promise;
  if (!h) {
    const promise = open().then((stream): Held => {
      const next: Held = { key, stream, refs: 0, timer: null };
      held = next;
      return next;
    });
    pending = { key, promise };
    try { h = await promise; } finally { if (pending?.promise === promise) pending = null; }
  }
  const lease = h;
  if (lease.timer) { clearTimeout(lease.timer); lease.timer = null; }
  lease.refs++;
  let released = false;
  return {
    stream: lease.stream,
    release: () => {
      if (released) return;
      released = true;
      lease.refs--;
      if (lease.refs > 0) return;
      if (graceMs <= 0) { stopNow(lease); return; }
      lease.timer = setTimeout(() => stopNow(lease), graceMs);
    },
  };
}

/** Test-only: drop any held stream. */
export function resetMicStreamForTests() {
  if (held) stopNow(held);
  held = null;
  pending = null;
}

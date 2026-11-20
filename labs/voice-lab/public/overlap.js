// Device-side overlap detector for the reference-based cut-in: with the browser's echo canceller using her playback as its reference, what is
// left in the microphone while she speaks is the person (plus a little residue). Returns how long, in ms, sound clearly above that residue
// has been going on without a real pause. Pure: the page feeds it each 32 ms frame.
export class OverlapDetector {
  floor = 0.002; hotMs = 0; quietMs = 0;
  frame(samples, { playing }, frameMs = 32) {
    let p = 0; for (const v of samples) p += v * v; const rms = Math.sqrt(p / Math.max(1, samples.length));
    // When she is not playing (a gap between her phrases) the floor learns the room, but never from a clearly loud frame: a person talking in that gap used to pull the floor up to their own voice, and the overlap was then missed once she resumed (recorded: the missed "wait, stop").
    if (!playing) { if (rms < Math.max(0.006, this.floor * 3)) this.floor = this.floor * 0.98 + rms * 0.02; this.hotMs = 0; this.quietMs = 0; return 0; }
    const hot = rms >= Math.max(0.006, this.floor * 3);
    if (hot) { this.hotMs += frameMs; this.quietMs = 0; }
    else { this.quietMs += frameMs; this.floor = this.floor * 0.95 + rms * 0.05; if (this.quietMs >= 160) this.hotMs = 0; }
    return this.hotMs;
  }
}

export const LOCAL_STOP_MS = 650, BRIEF_OVERLAP_MS = 250;
/** Once a person has clearly been talking over her for LOCAL_STOP_MS the page stops her itself, without waiting for the hub. Shorter overlap (a brief "mm-hm", "right", a half-second of both talking) never stops her on the device: the hub judges the words. */
export function shouldStopLocally(overlapMs, { playing, alreadySent }) { return !!playing && !alreadySent && overlapMs >= LOCAL_STOP_MS; }
export const isBriefOverlap = (overlapMs) => overlapMs >= BRIEF_OVERLAP_MS && overlapMs < LOCAL_STOP_MS;

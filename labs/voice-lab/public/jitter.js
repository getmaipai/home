// Adaptive start gate for reply playback. Audio is held until `targetMs` of it is queued, so a slow
// stretch from the voice does not break the sound up. The target starts at about one voice block (measured: the voice's first blocks leave only ~60 ms of margin, which was the cause of the tiny breakups) and
// grows only when the reply actually ran dry and more audio then arrived soon after (an underrun).
// It shrinks again over quiet turns. Pure logic: the player feeds it the queue length and the clock.
export class JitterGate {
  constructor({ startMs = 200, minMs = 160, maxMs = 700, lateMs = 1500, holdMs = 150, slowStartMs = 0 } = {}) {
    Object.assign(this, { minMs, maxMs, lateMs, holdMs, slowStartMs });
    this.targetMs = startMs; this.underruns = 0; this.reset();
  }
  /** New turn (or stop): wait for the first audio. */
  reset(now = 0) { this.state = 'buffering'; this.drainedAt = 0; this.bufferingSince = now; this.lastArrival = 0; this.firstArrival = 0; this.arrivedMs = 0; }
  /** A turn finished with no underrun: ease the target back toward the minimum. */
  cleanTurn() { this.targetMs = Math.max(this.minMs, Math.round(this.targetMs * 0.85)); }
  noteArrival(now, sec = 0) { if (!this.firstArrival) { this.firstArrival = now; this.firstSec = sec; } this.arrivedMs += sec * 1000; this.lastArrival = now; }
  /** When the voice is slow at the start of a turn (the first blocks arrive at less than twice real time) a gap is likely: start with a bigger buffer then, not after the first gap (recorded: a turn whose first phrase took 887 ms had 3 gaps with the gate at its cap). */
  startTarget(now = 0) { if (!this.slowStartMs || this.state !== 'buffering' || !this.firstArrival) return this.targetMs; /* off unless slowStartMs is set (not yet proven on the live page) */ if (this.lastArrival === this.firstArrival) return this.firstSec > 0 && this.firstSec < 0.35 && now - this.firstArrival < 120 ? Math.min(this.maxMs, Math.max(this.targetMs, this.slowStartMs)) : this.targetMs; /* one block so far: give the second block 120 ms to show how fast the voice is */ const rate = this.arrivedMs / (this.lastArrival - this.firstArrival); return rate < 2 ? Math.min(this.maxMs, Math.max(this.targetMs, this.slowStartMs)) : this.targetMs; }
  /** Called every pump tick. Returns true when the player may schedule audio. */
  update(queuedMs, now) {
    if (this.state === 'playing') {
      if (queuedMs <= 1) { this.state = 'buffering'; this.drainedAt = now; this.bufferingSince = now; }
      else return true;
    }
    if (queuedMs <= 0) { this.bufferingSince = now; return false; }
    if (!this.bufferingSince) this.bufferingSince = now;
    const quiet = this.lastArrival && now - this.lastArrival > 150; // the voice has stopped sending: play what there is
    const target = this.startTarget(now);
    if (queuedMs >= target || quiet || now - this.bufferingSince > this.holdMs + target) {
      if (this.drainedAt && now - this.drainedAt < this.lateMs && queuedMs < this.targetMs * 3 && !quiet) {
        this.underruns++; this.targetMs = Math.min(this.maxMs, Math.round(this.targetMs * 1.6 + 30));
      }
      this.state = 'playing'; this.drainedAt = 0; return true;
    }
    return false;
  }
}
// Offline replay used by the rig and the tests: frames = [{at, sec}] in ms and seconds. Returns when sound starts
// and every gap (underrun) the listener would hear.
export function replay(frames, gate, tickMs = 10) {
  if (!frames.length) return { startAt: null, gaps: 0, gapMs: 0 };
  let i = 0, playedUntil = 0, startAt = null, gaps = 0, gapMs = 0, pending = 0;
  const end = frames.at(-1).at + 3000; gate.reset(0);
  for (let t = frames[0].at; t < end; t += tickMs) {
    while (i < frames.length && frames[i].at <= t) { pending += frames[i].sec * 1000; gate.noteArrival(frames[i].at, frames[i].sec); i++; }
    if (gate.update(pending + Math.max(0, playedUntil - t), t) && pending > 0) {
      if (playedUntil < t) { if (startAt === null) startAt = t; else { gaps++; gapMs += t - playedUntil; } playedUntil = t; }
      playedUntil += pending; pending = 0;
    }
  }
  return { startAt, gaps, gapMs: Math.round(gapMs) };
}

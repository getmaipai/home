/** Count played audio time without counting seeks. A short song reaches half its length; longer songs reach 30 seconds. */
export function musicHistoryThreshold(duration: number): number {
  return Number.isFinite(duration) && duration > 0 ? Math.min(30, duration / 2) : 30;
}

/** Tracks forward playback deltas. Large jumps (seeks/background stalls) do not count as listening time. */
export function createMusicHistoryTracker() {
  let elapsed = 0;
  let lastTime: number | null = null;
  let recorded = false;
  let skipNext = false;
  return {
    reset(time = 0) { elapsed = 0; lastTime = time; recorded = false; skipNext = false; },
    skipNextObservation() { skipNext = true; },
    observe(time: number, duration: number, playing: boolean): boolean {
      if (skipNext) { skipNext = false; lastTime = time; return false; }
      if (lastTime !== null && playing) {
        const delta = time - lastTime;
        if (delta > 0 && delta <= 5) elapsed += delta;
      }
      lastTime = time;
      if (!recorded && elapsed >= musicHistoryThreshold(duration)) { recorded = true; return true; }
      return false;
    },
    elapsed: () => elapsed,
  };
}

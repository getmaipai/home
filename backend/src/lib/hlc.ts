// Hybrid logical clock, `wall_ms:counter:node` (spec/schemas/setting-
// value.schema.json's `hlc` field, 7.3). Per-field last-writer-wins for
// settings is one of this whole platform's settled sync primitives
// (0.4's research findings), so the write path generates a real HLC now
// even though there's only one writer today (no link/sync yet, Hub v0.3):
// getting the comparison right from the first write means a future
// remote write compares correctly against it with no shape change.
import { getDeviceId6 } from "@/lib/deviceId";

let lastWallMs = 0;
let counter = 0;

export function nextHlc(): string {
  const wallMs = Date.now();
  if (wallMs > lastWallMs) {
    lastWallMs = wallMs;
    counter = 0;
  } else {
    counter++;
  }
  return `${lastWallMs}:${counter}:${getDeviceId6()}`;
}

function parseHlc(hlc: string): { wallMs: number; counter: number; node: string } {
  const [wallMs, counter, node] = hlc.split(":");
  return { wallMs: Number(wallMs), counter: Number(counter), node: node ?? "" };
}

// A review (2026-09-04) found nextHlc() only guaranteed monotonicity
// within one process's lifetime: lastWallMs/counter reset to 0 on every
// restart with nothing recovering from what was already persisted. If
// the wall clock is ever behind where it was before a restart (no RTC,
// NTP not synced yet at boot, a manual/DST clock change), a freshly
// generated hlc could be SMALLER than an hlc already stored, and
// lib/settings.ts's compareHlc(hlc, existing.hlc) <= 0 check would then
// permanently refuse every future write to that key with a misleading
// "a newer value already exists" error, never recovering until the wall
// clock naturally caught back up. Callers that own hlc-stamped storage
// (lib/settings.ts, at module load, from every stored hlc) call this once
// at boot with the highest hlc they already have on disk, so a restart
// can never regress behind what was already committed.
export function seedHlc(knownHlc: string): void {
  const { wallMs, counter: c } = parseHlc(knownHlc);
  if (wallMs > lastWallMs || (wallMs === lastWallMs && c > counter)) {
    lastWallMs = wallMs;
    counter = c;
  }
}

/** >0 if a is newer, <0 if b is newer, 0 if equal. Node is the final,
 * rarely-needed tiebreak for two nodes writing at the identical wall_ms
 * and counter (astronomically unlikely locally; matters once a second
 * node exists via sync). */
export function compareHlc(a: string, b: string): number {
  const pa = parseHlc(a);
  const pb = parseHlc(b);
  if (pa.wallMs !== pb.wallMs) return pa.wallMs - pb.wallMs;
  if (pa.counter !== pb.counter) return pa.counter - pb.counter;
  return pa.node.localeCompare(pb.node);
}

/** Test-only: the counter is module-local state with no other reset hook. */
export function __resetHlcForTests(): void {
  lastWallMs = 0;
  counter = 0;
}

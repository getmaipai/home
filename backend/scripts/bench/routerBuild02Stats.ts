// ROUTER-BUILD-03: the statistics of ROUTER-BUILD-02 section 5. The unit is the question family: repeats inside a row are
// averaged first, then rows inside a family, then a seeded percentile bootstrap resamples families (10,000 by default).
// Pure; no engine, no database.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/** Seeded generator so a rerun prints the same interval. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Obs { family: string; row: string; value: number }
export interface Interval { n: number; mean: number; low: number; high: number }

const avg = (xs: readonly number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

/** Observations are one value per (row, repeat). Repeats average within a row, rows within a family. */
export function familyValues(obs: readonly Obs[]): Map<string, number> {
  const rows = new Map<string, { family: string; vals: number[] }>();
  for (const o of obs) {
    const r = rows.get(o.row) ?? { family: o.family, vals: [] };
    r.vals.push(o.value);
    rows.set(o.row, r);
  }
  const fams = new Map<string, number[]>();
  for (const r of rows.values()) fams.set(r.family, [...(fams.get(r.family) ?? []), avg(r.vals)]);
  return new Map([...fams].map(([f, v]) => [f, avg(v)] as const));
}

/** Cluster bootstrap over families. With `base`, the interval is of the paired difference over the families both share. */
export function clusterBootstrap(arm: ReadonlyMap<string, number>, base: ReadonlyMap<string, number> | null = null, iterations = 10000, seed = 1): Interval | null {
  const values = [...arm].filter(([f]) => base === null || base.has(f)).map(([f, v]) => v - (base ? base.get(f)! : 0));
  const n = values.length;
  if (n < 2) return null;
  const rnd = mulberry32(seed);
  const means: number[] = new Array(iterations);
  for (let i = 0; i < iterations; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) sum += values[Math.floor(rnd() * n)]!;
    means[i] = sum / n;
  }
  means.sort((a, b) => a - b);
  return { n, mean: avg(values), low: means[Math.floor(0.025 * iterations)]!, high: means[Math.min(iterations - 1, Math.floor(0.975 * iterations))]! };
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function sha256Text(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export const median = (xs: readonly number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export const percentile = (xs: readonly number[], p: number): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
};

/** Refuses to continue when the lock box on disk is not the one the pre-registration names. */
export function assertLockboxMatches(lockboxPath: string, prereg: { lockbox?: { sha256?: string } }): void {
  const want = prereg.lockbox?.sha256;
  if (!want) throw new Error("PREREG.json names no lock box sha256. Generate it with router_build_02_dev.py --prereg-only after the lock box is final.");
  const got = sha256File(lockboxPath);
  if (got !== want) throw new Error(`the lock box at ${lockboxPath} has sha256 ${got} but PREREG.json froze ${want}. A changed lock box needs a new pre-registration; do not run against it.`);
}

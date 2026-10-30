// WEATHER-PORT-04: the moon tile on the Weather page uses the almanac-moon app's own answer, never a second
// phase calculation. The phase is the same everywhere, so one run per calendar day (UTC) serves every place.
export type MoonTile = { phase: string; illumination: number; nextFull?: string; nextNew?: string };
type MoonRun = () => Promise<{ phase?: unknown; illumination?: unknown; next_full_moon?: unknown; next_new_moon?: unknown } | undefined>;

/** A `YYYY-MM-DD` string that names a real calendar day, else undefined (the tile then leaves that line out). */
function calendarDay(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value ? value : undefined;
}

let cached: { day: string; tile: MoonTile | undefined } | null = null;

export function __resetMoonForTests(): void { cached = null; }

/** The phase name and percent lit for `now`, or undefined when the almanac app cannot answer (the tile is then left out). */
export async function moonTile(run: MoonRun, now: Date = new Date()): Promise<MoonTile | undefined> {
  const day = now.toISOString().slice(0, 10);
  if (cached?.day === day) return cached.tile;
  let tile: MoonTile | undefined;
  try {
    const data = await run();
    if (data && typeof data.phase === "string" && typeof data.illumination === "number" && Number.isFinite(data.illumination)) {
      const nextFull = calendarDay(data.next_full_moon);
      const nextNew = calendarDay(data.next_new_moon);
      tile = { phase: data.phase, illumination: Math.round(Math.min(1, Math.max(0, data.illumination)) * 100), ...(nextFull ? { nextFull } : {}), ...(nextNew ? { nextNew } : {}) };
    }
  } catch {
    tile = undefined;
  }
  if (tile) cached = { day, tile };
  return tile;
}

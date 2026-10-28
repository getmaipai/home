// WEATHER-PORT-04: the moon tile on the Weather page uses the almanac-moon app's own answer, never a second
// phase calculation. The phase is the same everywhere, so one run per calendar day (UTC) serves every place.
export type MoonTile = { phase: string; illumination: number };
type MoonRun = () => Promise<{ phase?: unknown; illumination?: unknown } | undefined>;

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
      tile = { phase: data.phase, illumination: Math.round(Math.min(1, Math.max(0, data.illumination)) * 100) };
    }
  } catch {
    tile = undefined;
  }
  if (tile) cached = { day, tile };
  return tile;
}

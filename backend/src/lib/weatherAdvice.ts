// WEATHER-PORT-01: what to wear and bring, from numbers the weather recipe already fetched. Deterministic: no wording is read and no
// model is involved. Pure on purpose (no Home imports) so it can move to the shared core when the robot needs the same definition.
// UV boundaries are the kit weather page's own bands (3, 6, 8); sunscreen starts at High, sunglasses at Moderate on a clear day.

export type AdviceInput = {
  unit?: "fahrenheit" | "celsius";
  feelsLike?: number;
  isDay?: boolean;
  /** WMO weather code of the current reading. */
  code?: number;
  uvIndex?: number;
  windKph?: number;
  /** Rain falling now, millimetres. */
  precipitationMm?: number;
  /** Chance of rain, percent, one entry per hour starting with the current hour. */
  hourPop?: number[];
  /** ISO local times, same order as `hourPop`. */
  hourTimes?: string[];
};

export type AdviceItem = { id: string; kind: "clothing" | "rain" | "sun" | "wind"; text: string };

const WINDOW_HOURS = 12;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function clothing(feelsLike: number, unit: "fahrenheit" | "celsius"): AdviceItem | null {
  const f = unit === "celsius" ? feelsLike * 1.8 + 32 : feelsLike;
  if (f < 28) return { id: "hat-gloves", kind: "clothing", text: "Wear a hat and gloves with a heavy coat." };
  if (f < 32) return { id: "heavy-coat", kind: "clothing", text: "Wear a heavy coat." };
  if (f < 60) return { id: "jacket", kind: "clothing", text: "Wear a jacket." };
  if (f < 68) return { id: "light-jacket", kind: "clothing", text: "Bring a light jacket." };
  return null;
}

function hourLabel(iso: string | undefined): string | null {
  const match = iso ? /T(\d{2}):/.exec(iso) : null;
  if (!match) return null;
  const hour = Number(match[1]);
  return `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? "AM" : "PM"}`;
}

export function weatherAdvice(input: AdviceInput): AdviceItem[] {
  const items: AdviceItem[] = [];
  if (finite(input.feelsLike)) {
    const layer = clothing(input.feelsLike, input.unit === "celsius" ? "celsius" : "fahrenheit");
    if (layer) items.push(layer);
  }

  const pops = (input.hourPop ?? []).slice(0, WINDOW_HOURS).filter(finite);
  const worst = pops.length > 0 ? Math.max(...pops) : 0;
  const wetNow = finite(input.precipitationMm) && input.precipitationMm >= 2.54;
  if (worst >= 70) items.push({ id: "rain-gear", kind: "rain", text: "Bring rain gear." });
  else if (worst >= 30) items.push({ id: "umbrella", kind: "rain", text: "Bring an umbrella." });
  if (worst >= 50 || wetNow) items.push({ id: "boots", kind: "rain", text: "Wear waterproof shoes." });
  const firstWet = (input.hourPop ?? []).slice(0, WINDOW_HOURS).findIndex((pop) => finite(pop) && pop >= 50);
  const when = firstWet >= 0 ? hourLabel(input.hourTimes?.[firstWet]) : null;
  if (when) items.push({ id: "rain-timing", kind: "rain", text: `Rain is likely around ${when}.` });

  if (input.isDay !== false && finite(input.uvIndex)) {
    if (input.uvIndex >= 6) {
      items.push({ id: "sunscreen", kind: "sun", text: "Wear sunscreen." });
      items.push({ id: "shade", kind: "sun", text: "Look for shade." });
    }
    const clear = finite(input.code) && input.code <= 2;
    if (input.uvIndex >= 3 && clear) items.push({ id: "sunglasses", kind: "sun", text: "Wear sunglasses." });
  }

  if (finite(input.windKph)) {
    if (input.windKph >= 40) items.push({ id: "windy", kind: "wind", text: "It is windy, so secure anything loose." });
    else if (input.windKph >= 25) items.push({ id: "breezy", kind: "wind", text: "It is breezy." });
  }
  return items;
}

export function adviceLine(items: AdviceItem[]): string {
  return items.map((item) => item.text).join(" ");
}

const nums = (value: unknown): number[] => (Array.isArray(value) ? value.filter(finite) : []);
const num = (value: unknown): number | undefined => (finite(value) ? value : undefined);

/** The advice for one weather recipe run, read from the keys the recipe binds (`block_*`). */
export function adviceFromRecipeData(data: Record<string, unknown> | undefined): AdviceItem[] {
  if (!data) return [];
  return weatherAdvice({
    unit: data.unit === "celsius" ? "celsius" : "fahrenheit",
    feelsLike: num(data.block_detail_feels_like),
    isDay: data.block_is_day === 0 || data.block_is_day === false ? false : true,
    code: num(data.block_code),
    uvIndex: num(data.block_detail_uv_index),
    windKph: num(data.block_detail_wind_speed),
    precipitationMm: num(data.block_detail_precipitation),
    hourPop: nums(data.block_hour_pop),
    hourTimes: Array.isArray(data.block_hour_times) ? data.block_hour_times.filter((t): t is string => typeof t === "string") : [],
  });
}

const CHIP_LABELS: Record<string, string> = {
  "hat-gloves": "Hat and gloves", "heavy-coat": "Heavy coat", jacket: "Jacket", "light-jacket": "Light jacket",
  "rain-gear": "Rain gear", umbrella: "Umbrella", boots: "Waterproof shoes",
  sunscreen: "Sunscreen", shade: "Seek shade", sunglasses: "Sunglasses", windy: "Windy", breezy: "Breezy",
};

const CHIP_ICONS: Record<string, string> = {
  "hat-gloves": "snowflake", "heavy-coat": "shirt", jacket: "shirt", "light-jacket": "shirt", "rain-gear": "cloud-rain", umbrella: "umbrella",
  boots: "footprints", sunscreen: "sun", shade: "tree-pine", sunglasses: "glasses", windy: "wind", breezy: "wind", "rain-timing": "cloud-rain",
};

/** The advice as short chips for the kit weather elements: a label of a few words, a sun icon on the sun items. */
export function adviceChips(items: readonly AdviceItem[]): Array<{ id: string; label: string; icon?: string }> {
  return items.slice(0, 12).map((item) => ({
    id: item.id,
    label: item.id === "rain-timing" ? item.text.replace(/^Rain is likely around /, "Rain around ").replace(/\.$/, "") : CHIP_LABELS[item.id] ?? item.text,
    ...(CHIP_ICONS[item.id] ? { icon: CHIP_ICONS[item.id] } : {}),
  }));
}

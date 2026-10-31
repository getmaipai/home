// GENUI-05: the answer blocks a bundled Tier 0 package returns from data its
// own run already holds. The pinned recipe interpreter has no `blocks` output
// (a recipe binds `reply`, `data` and `actions`), so a recipe package names the
// kinds it may return in its manifest's `returns_blocks`, binds the typed
// fields in its `format` step's `data` (or, for a list read, in the host's own
// capture of the rows it already read), and the hub shapes them here, in the
// same run, from nothing else. No fetch, no model, no second read.
//
// What this returns is raw: filterAnswerBlocks() (answerBlocks.ts) still
// validates every block against the spec, checks the manifest allowlist,
// applies the age band and the output floor to each string and drops what
// fails, one block at a time. A producer that cannot build a block returns
// nothing; the package reply is never affected.
import { AnswerBlock } from "@maipai/spec/gen/ts/answer-block.js";
import { nextHlc } from "@/lib/hlc";
import { adviceChips, adviceFromRecipeData } from "@/lib/weatherAdvice";
import { undoPropsFor } from "@/lib/toolUndo";

/** Rows a host read already holds, handed to the block producers of the same
 * run. Filled by packageHost.ts (never by a package). */
export interface BlockCapture {
  /** The open rows of the shopping list, as list-view read them. */
  listItems?: { id: string; text: string }[];
}

type RecipeResult = { reply?: { text: string }; data?: Record<string, unknown> };

const ALT_MAX = 300;
const NAME_MAX = 200;
const LIST_ITEMS_MAX = 100;

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}\u2026`;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** The one envelope every block here carries: a fresh id, the producing
 * package, the run's provenance and a stamp from the hub's own clock. */
export function blockEnvelope(kind: string, producer: string, alt: string, provenance: string, props: Record<string, unknown>): Record<string, unknown> {
  return {
    id: `blk-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
    kind,
    schema_version: 1,
    producer,
    alt: clip(alt, ALT_MAX),
    provenance,
    created_at: new Date().toISOString(),
    hlc: nextHlc(),
    props,
  };
}

function scheduleCard(producer: string, provenance: string, verb: string, name: string | null, whenText: string | null, cadence = "Once"): Record<string, unknown>[] {
  if (!name || !whenText) return [];
  return [blockEnvelope(
    "schedule_card",
    producer,
    `${verb}: ${name} (${whenText}).`,
    provenance,
    { name: clip(name, NAME_MAX), cadence, nextRun: whenText, enabled: true, history: [] },
  )];
}

/** "weekdays at 6:30 AM" reads "Weekdays" on the card; a one-time alarm stays "Once". */
function alarmCadence(whenText: string | null): string {
  const repeat = whenText?.match(/^(weekdays|weekends|every day|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:, (?:Mon|Tue|Wed|Thu|Fri|Sat|Sun))*) at /);
  return repeat?.[1] ? `${repeat[1][0]!.toUpperCase()}${repeat[1].slice(1)}` : "Once";
}

function todoList(producer: string, provenance: string, items: readonly { id: string; text: string }[]): Record<string, unknown>[] {
  const rows = items.filter((item) => item.id.length > 0 && item.text.trim().length > 0).slice(0, LIST_ITEMS_MAX);
  if (rows.length === 0) return [];
  const count = rows.length === 1 ? "1 item" : `${rows.length} items`;
  return [blockEnvelope(
    "todo_list",
    producer,
    `Shopping list, ${count}: ${rows.map((row) => row.text.trim()).join(", ")}.`,
    provenance,
    { title: "Shopping list", items: rows.map((row) => ({ id: row.id, text: row.text.trim(), status: "pending" })) },
  )];
}

/** GENUI-04: data keys a recipe binds only to feed its blocks. The host strips
 * them from the result once the blocks are built, so the composer and the
 * model never see (or pay for) the arrays. */
export const BLOCK_ONLY_DATA_PREFIX = "block_";

export function withoutBlockOnlyData<T extends { data?: Record<string, unknown> }>(result: T): T {
  if (!result.data) return result;
  const kept = Object.fromEntries(Object.entries(result.data).filter(([key]) => !key.startsWith(BLOCK_ONLY_DATA_PREFIX)));
  return { ...result, data: kept };
}

function numbers(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out = value.map((item) => (typeof item === "number" && Number.isFinite(item) ? item : null));
  return out.every((item): item is number => item !== null) ? out : null;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "2026-10-09" to "Fri Oct 9", from the calendar date alone (no time zone,
 * no clock): Open-Meteo already gave the place's own local dates. */
function dayLabel(iso: unknown): string | null {
  const match = typeof iso === "string" ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.getTime())) return null;
  return `${WEEKDAYS[date.getUTCDay()]} ${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}


function finite(value: unknown): number | null {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function wmoCode(value: unknown): number | null {
  const n = finite(value);
  return n !== null && Number.isInteger(n) && n >= 0 ? n : null;
}

const CARD_HOURS_MAX = 24;
const CARD_DAYS_MAX = 8;
// The card draws no attribution line (owner, 2026-10-28); the data source still names its credit in the package manifest.
const WEATHER_ATTRIBUTION = "";

/** The one `weather_card` block: the current reading, up to 24 hours and 1 to 8
 * days, all from the response the recipe already fetched. Returns null when
 * the current reading or every day row is missing (the card needs both).
 * Exported for tests; weatherBlocks() decides whether it is shown. */
export function weatherCard(producer: string, provenance: string, data: Record<string, unknown> | undefined, attribution: string = WEATHER_ATTRIBUTION): Record<string, unknown> | null {
  if (!data) return null;
  const place = text(data.place);
  const temp = finite(data.temperature);
  const code = wmoCode(data.block_code);
  const condition = text(data.conditions);
  if (!place || temp === null || code === null || !condition) return null;
  const unit = data.unit === "celsius" ? "C" : "F";
  const isDay = data.block_is_day === 0 || data.block_is_day === false ? false : true;

  const highs = Array.isArray(data.block_day_highs) ? data.block_day_highs : [];
  const lows = Array.isArray(data.block_day_lows) ? data.block_day_lows : [];
  const dates = Array.isArray(data.block_day_dates) ? data.block_day_dates : [];
  const codes = Array.isArray(data.block_day_codes) ? data.block_day_codes : [];
  const chances = Array.isArray(data.block_day_rain) ? data.block_day_rain : [];
  const daily: Record<string, unknown>[] = [];
  for (let i = 0; i < dates.length && daily.length < CARD_DAYS_MAX; i++) {
    const date = typeof dates[i] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dates[i] as string) ? (dates[i] as string) : null;
    const high = finite(highs[i]);
    const low = finite(lows[i]);
    const dayCode = wmoCode(codes[i]);
    if (!date || high === null || low === null || dayCode === null) continue;
    const pop = finite(chances[i]);
    daily.push({ date, high, low, code: dayCode, ...(pop !== null && pop >= 0 && pop <= 100 ? { pop } : {}) });
  }
  if (daily.length === 0) return null;

  const times = Array.isArray(data.block_hour_times) ? data.block_hour_times : [];
  const temps = Array.isArray(data.block_hour_temps) ? data.block_hour_temps : [];
  const pops = Array.isArray(data.block_hour_pop) ? data.block_hour_pop : [];
  const hourly: Record<string, unknown>[] = [];
  for (let i = 0; i < times.length && hourly.length < CARD_HOURS_MAX; i++) {
    const t = typeof times[i] === "string" && times[i] !== "" ? (times[i] as string) : null;
    const hourTemp = finite(temps[i]);
    if (!t || hourTemp === null) continue;
    const pop = finite(pops[i]);
    hourly.push({ time: t, temp: hourTemp, ...(pop !== null && pop >= 0 && pop <= 100 ? { pop } : {}) });
  }

  const today = daily[0]!;
  const alt = `Weather in ${place} now: ${temp}°${unit} and ${condition}; today's high ${today.high}°${unit}, low ${today.low}°${unit}.`;
  const advice = adviceChips(adviceFromRecipeData(data));
  const alert = data.alert && typeof data.alert === "object" ? data.alert as Record<string, unknown> : undefined;
  const alertTitle = alert && typeof alert.title === "string" ? alert.title.trim() : "";
  const alertDescription = alert && typeof alert.text === "string" ? alert.text.trim() : "";
  return blockEnvelope("weather_card", producer, alt, provenance, {
    place,
    unit,
    current: { temp, condition, code, is_day: isDay },
    ...(advice.length > 0 ? { advice } : {}),
    ...(alertTitle ? { alert: { title: alertTitle, ...(alertDescription ? { text: alertDescription } : {}), ...(alert?.severity === "info" || alert?.severity === "warn" || alert?.severity === "severe" ? { severity: alert.severity } : {}) } } : {}),
    ...(hourly.length > 0 ? { hourly } : {}),
    daily,
    attribution,
  });
}

/** Weather: the current reading, the next 24 hours and the next 7 days, all
 * from the one forecast response the recipe already fetched. A part the
 * response lacks is simply not built; the reply is never affected. */
function weatherBlocks(producer: string, provenance: string, data: Record<string, unknown> | undefined, attribution?: string, cardAllowed = false): Record<string, unknown>[] {
  if (!data) return [];
  // The card replaces the sheet, chart and table: one answer, never both. It is
  // returned alone when the manifest lists `weather_card` and the pinned spec knows it; until then (or
  // when the card cannot be built) the three older blocks are the answer.
  const card = cardAllowed ? weatherCard(producer, provenance, data, attribution) : null;
  if (card && AnswerBlock.safeParse(card).success) return [card];
  const blocks: Record<string, unknown>[] = [];
  const place = text(data.place);
  const unit = data.unit === "celsius" ? "°C" : "°F";
  const present = (v: unknown): boolean => v !== undefined && v !== null && v !== "";
  const now = present(data.temperature) ? `${data.temperature}${unit}` : null;

  const rows = [
    now ? { label: "Temperature", value: now } : null,
    text(data.conditions) ? { label: "Conditions", value: text(data.conditions)! } : null,
    present(data.high) ? { label: "High", value: `${data.high}${unit}` } : null,
    present(data.low) ? { label: "Low", value: `${data.low}${unit}` } : null,
    present(data.precipitation_chance) ? { label: "Chance of rain", value: `${data.precipitation_chance}%` } : null,
  ].filter((row): row is { label: string; value: string } => row !== null);
  if (place && rows.length > 0) {
    const summary = rows.map((row) => `${row.label.toLowerCase()} ${row.value}`).join(", ");
    blocks.push(blockEnvelope("spec_sheet", producer, `Weather in ${place} now: ${summary}.`, provenance, { title: place, rows }));
  }

  const temps = numbers(data.block_hour_temps);
  if (temps) {
    const low = Math.min(...temps);
    const high = Math.max(...temps);
    const change = round1(temps[temps.length - 1]! - temps[0]!);
    const trend = Math.abs(change) < 1 ? "flat" : change > 0 ? "up" : "down";
    const delta = trend === "flat" ? undefined : `${change > 0 ? "+" : "-"}${Math.abs(change)}°`;
    blocks.push(blockEnvelope(
      "chart",
      producer,
      `Temperature over the next 24 hours, from a low of ${low}${unit} to a high of ${high}${unit}.`,
      provenance,
      { label: `Next 24 hours, ${unit}`, value: now ?? `${temps[0]}${unit}`, ...(delta ? { delta } : {}), points: temps, variant: "area", trend },
    ));
  }

  const highs = numbers(data.block_day_highs);
  const lows = numbers(data.block_day_lows);
  const dates = Array.isArray(data.block_day_dates) ? data.block_day_dates : null;
  if (highs && lows && dates && dates.length === highs.length && lows.length === highs.length) {
    const chances = Array.isArray(data.block_day_rain) ? data.block_day_rain : [];
    const rowsOut: Record<string, string | number | null>[] = [];
    for (let i = 0; i < dates.length; i++) {
      const day = dayLabel(dates[i]);
      if (!day) continue;
      const chance = chances[i];
      rowsOut.push({ day, high: highs[i]!, low: lows[i]!, rain: typeof chance === "number" && Number.isFinite(chance) ? chance : null });
    }
    if (rowsOut.length > 0) {
      const hottest = rowsOut.reduce((a, b) => ((b.high as number) > (a.high as number) ? b : a));
      blocks.push(blockEnvelope(
        "data_table",
        producer,
        `Forecast for the next ${rowsOut.length} days with highs, lows and chance of rain; ${hottest.day} is the warmest at ${hottest.high}${unit}.`,
        provenance,
        {
          columns: [
            { id: "day", header: "Day" },
            { id: "high", header: "High", align: "end", format: { kind: "number", decimals: 0, unit } },
            { id: "low", header: "Low", align: "end", format: { kind: "number", decimals: 0, unit } },
            { id: "rain", header: "Rain", align: "end", format: { kind: "number", decimals: 0, unit: "%" } },
          ],
          rows: rowsOut,
          caption: `Next ${rowsOut.length} days`,
          emptyLabel: "No forecast",
        },
      ));
    }
  }
  return blocks;
}

/** The blocks a Tier 0 recipe package returns for one successful run, or an
 * empty array. Only a kind the manifest lists in `returns_blocks` is built. */
export function blocksForRecipeRun(
  manifest: { id: string; returns_blocks?: readonly string[]; data_sources?: readonly { attribution?: string }[] },
  result: RecipeResult,
  capture: BlockCapture,
  turnId?: string,
): Record<string, unknown>[] {
  const allowed = manifest.returns_blocks ?? [];
  const provenance = `${manifest.id} result${turnId ? ` in turn ${turnId}` : ""}`;
  switch (manifest.id) {
    case "remind": {
      const blocks = allowed.includes("schedule_card")
        ? scheduleCard(
            manifest.id,
            provenance,
            "Reminder set",
            text(result.data?.task),
            text(result.data?.when_text),
          )
        : [];
      const undoId = text(result.data?.undo_id);
      if (undoId && allowed.includes("confirmation")) {
        const undo = undoPropsFor(undoId);
        if (undo) {
          const whenText = text(result.data?.when_text) ?? "later";
          const sentence = `Reminder set for ${whenText}.`;
          const confirmation = blockEnvelope(
            "confirmation",
            manifest.id,
            sentence,
            provenance,
            { icon: "clock", sentence, undo },
          );
          confirmation.id = undoId;
          blocks.push(confirmation);
        }
      }
      return blocks;
    }
    case "alarm":
      if (!allowed.includes("schedule_card")) return [];
      if (text(result.data?.action) === "list") return [];
      return scheduleCard(manifest.id, provenance, text(result.data?.action) === "cancel" ? "Alarm or reminder cancelled" : "Alarm set", text(result.data?.schedule_task) || text(result.data?.task), text(result.data?.when_text), alarmCadence(text(result.data?.when_text)));
    case "timer": {
      const blocks = allowed.includes("schedule_card")
        ? scheduleCard(
            manifest.id,
            provenance,
            "Timer set",
            text(result.data?.label),
            text(result.data?.when_text),
          )
        : [];
      const undoId = text(result.data?.undo_id);
      if (undoId && allowed.includes("confirmation")) {
        const undo = undoPropsFor(undoId);
        if (undo) {
          const sentence = `Timer set for ${text(result.data?.when_text) ?? "later"}.`;
          const confirmation = blockEnvelope(
            "confirmation",
            manifest.id,
            sentence,
            provenance,
            { icon: "clock", sentence, undo },
          );
          confirmation.id = undoId;
          blocks.push(confirmation);
        }
      }
      return blocks;
    }
    case "list-view":
      return allowed.includes("todo_list") ? todoList(manifest.id, provenance, capture.listItems ?? []) : [];
    case "weather":
      return weatherBlocks(manifest.id, provenance, result.data, undefined, allowed.includes("weather_card")).filter((block) => allowed.includes(String(block.kind)));
    default:
      return [];
  }
}

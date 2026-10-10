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
import { nextHlc } from "@/lib/hlc";

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

function scheduleCard(producer: string, provenance: string, verb: string, name: string | null, whenText: string | null): Record<string, unknown>[] {
  if (!name || !whenText) return [];
  return [blockEnvelope(
    "schedule_card",
    producer,
    `${verb}: ${name} (${whenText}).`,
    provenance,
    { name: clip(name, NAME_MAX), cadence: "Once", nextRun: whenText, enabled: true, history: [] },
  )];
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

/** Weather: the current reading, the next 24 hours and the next 7 days, all
 * from the one forecast response the recipe already fetched. A part the
 * response lacks is simply not built; the reply is never affected. */
function weatherBlocks(producer: string, provenance: string, data: Record<string, unknown> | undefined): Record<string, unknown>[] {
  if (!data) return [];
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
  manifest: { id: string; returns_blocks?: readonly string[] },
  result: RecipeResult,
  capture: BlockCapture,
  turnId?: string,
): Record<string, unknown>[] {
  const allowed = manifest.returns_blocks ?? [];
  const provenance = `${manifest.id} result${turnId ? ` in turn ${turnId}` : ""}`;
  switch (manifest.id) {
    case "remind":
      return allowed.includes("schedule_card")
        ? scheduleCard(manifest.id, provenance, "Reminder set", text(result.data?.task), text(result.data?.when_text))
        : [];
    case "timer":
      return allowed.includes("schedule_card")
        ? scheduleCard(manifest.id, provenance, "Timer set", text(result.data?.label), text(result.data?.when_text))
        : [];
    case "list-view":
      return allowed.includes("todo_list") ? todoList(manifest.id, provenance, capture.listItems ?? []) : [];
    case "weather":
      return weatherBlocks(manifest.id, provenance, result.data).filter((block) => allowed.includes(String(block.kind)));
    default:
      return [];
  }
}

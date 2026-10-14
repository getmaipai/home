// Moon phase is the same everywhere on Earth. Sunrise and sunset need
// only the household's rounded home coordinates. All calculations stay
// in this local sandbox.
import { Body, Illumination, MoonPhase, NextMoonQuarter, Observer, SearchMoonQuarter, SearchRiseSet } from "npm:astronomy-engine@2.1.19";
import { McpServer } from "npm:@modelcontextprotocol/sdk@1.30.0/server/mcp.js";
import { StdioServerTransport } from "npm:@modelcontextprotocol/sdk@1.30.0/server/stdio.js";
import { z } from "npm:zod@4.6.5";

const MOON_PHASE_NAMES = [
  "New Moon",
  "Waxing Crescent",
  "First Quarter",
  "Waxing Gibbous",
  "Full Moon",
  "Waning Gibbous",
  "Last Quarter",
  "Waning Crescent",
];

export interface AlmanacMoonData {
  phase: typeof MOON_PHASE_NAMES[number];
  illumination?: number;
  next_full_moon?: string;
  next_new_moon?: string;
  sunrise?: string | null;
  sunset?: string | null;
}

export interface HomeSkyInput { lat: number; lon: number }
export interface SunTimes { sunrise: string | null; sunset: string | null; sunriseText: string; sunsetText: string }
export interface AlmanacMoonReply { text: string; speech: string }
export interface AlmanacMoonResult { reply: AlmanacMoonReply; actions: []; data: AlmanacMoonData }

const NO_HOME = "I don't know where you are, so I can't work out sunrise or sunset. An owner or admin can set the home place in Settings.";

export function moonPhase(now: Date = new Date()): AlmanacMoonReply {
  const text = `The moon is in its ${moonName(now)} phase.`;
  return { text, speech: text };
}

export function moonPhaseData(now: Date = new Date()): AlmanacMoonData {
  const phase = moonName(now);
  const fraction = MoonPhase(now) / 360;
  const illumination = Illumination(Body.Moon, now).phase_fraction;
  const data: AlmanacMoonData = { phase };
  if (Number.isFinite(illumination)) data.illumination = round2(illumination);
  if (Number.isFinite(fraction)) {
    let quarter = SearchMoonQuarter(now);
    let nextFull: Date | undefined;
    let nextNew: Date | undefined;
    for (let i = 0; i < 8 && (!nextFull || !nextNew); i += 1) {
      if (quarter.quarter === 0 && !nextNew) nextNew = quarter.time.date;
      if (quarter.quarter === 2 && !nextFull) nextFull = quarter.time.date;
      quarter = NextMoonQuarter(quarter);
    }
    if (nextFull) data.next_full_moon = nextFull.toISOString().slice(0, 10);
    if (nextNew) data.next_new_moon = nextNew.toISOString().slice(0, 10);
  }
  return data;
}

function moonName(now: Date): typeof MOON_PHASE_NAMES[number] {
  const fraction = ((MoonPhase(now) % 360) + 360) % 360 / 360;
  // Math.round centers each named window between principal phases, keeping
  // the spoken name useful before the exact astronomical instant.
  return MOON_PHASE_NAMES[Math.round(fraction * MOON_PHASE_NAMES.length) % MOON_PHASE_NAMES.length]!;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function localDateNoon(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
}

function localDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function localTime(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

function sameLocalDate(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function nextEventText(verb: "rise" | "set", now: Date, observer: Observer): string {
  const direction = verb === "rise" ? 1 : -1;
  const next = SearchRiseSet(Body.Sun, observer, direction, localDateNoon(now), 366);
  if (!next) return `It ${verb === "rise" ? "rises" : "sets"} again later this year.`;
  if (!Number.isFinite(next.date.getTime())) throw new Error("the sky calculation returned an invalid time");
  return `It ${verb === "rise" ? "rises" : "sets"} again on ${localDate(next.date)}.`;
}

export function sunTimes(now: Date, sky: HomeSkyInput): SunTimes {
  const observer = new Observer(sky.lat, sky.lon, 0);
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const rise = SearchRiseSet(Body.Sun, observer, 1, midnight, 1);
  const set = rise
    ? SearchRiseSet(Body.Sun, observer, -1, rise.date, 1.25)
    : SearchRiseSet(Body.Sun, observer, -1, midnight, 1);
  if (rise && !Number.isFinite(rise.date.getTime())) throw new Error("the sky calculation returned an invalid time");
  if (set && !Number.isFinite(set.date.getTime())) throw new Error("the sky calculation returned an invalid time");
  const sunrise = rise && sameLocalDate(rise.date, now) ? localTime(rise.date) : null;
  const sunset = set ? localTime(set.date) : null;
  const sunriseText = sunrise ?? `The sun does not rise today where you are. ${nextEventText("rise", now, observer)}`;
  const sunsetText = sunset ?? `The sun does not set today where you are. ${nextEventText("set", now, observer)}`;
  return { sunrise, sunset, sunriseText, sunsetText };
}

function handlerNow(args: Record<string, unknown>): Date {
  const value = args.__now;
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function validSky(value: unknown): value is HomeSkyInput {
  if (!value || typeof value !== "object") return false;
  const point = value as Record<string, unknown>;
  return typeof point.lat === "number" && Number.isFinite(point.lat) && typeof point.lon === "number" && Number.isFinite(point.lon);
}

export function handleAlmanacMoon(args: Record<string, unknown>): AlmanacMoonResult {
  const now = handlerNow(args);
  const reply = moonPhase(now);
  const data = moonPhaseData(now);
  if (!Object.hasOwn(args, "__home_sky") || args.__home_sky === null) return { reply: { text: `${reply.text} ${NO_HOME}`, speech: `${reply.speech} ${NO_HOME}` }, actions: [], data };
  if (!validSky(args.__home_sky)) return { reply, actions: [], data };

  try {
    const times = sunTimes(now, args.__home_sky);
    data.sunrise = times.sunrise;
    data.sunset = times.sunset;
    const text = `${times.sunriseText} ${times.sunsetText} ${reply.text}`;
    return { reply: { text, speech: text }, actions: [], data };
  } catch {
    return { reply, actions: [], data };
  }
}

if (import.meta.main) {
  const server = new McpServer({ name: "almanac-moon", version: "0.2.0" });
  server.registerTool("handle", {
    inputSchema: z.object({
      __now: z.string().optional(),
      __home_sky: z.object({ lat: z.number(), lon: z.number() }).nullable().optional(),
    }).passthrough(),
  }, async (args: Record<string, unknown>) => ({ content: [{ type: "text", text: JSON.stringify(handleAlmanacMoon(args)) }] }));
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

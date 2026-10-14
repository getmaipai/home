import { McpServer } from "npm:@modelcontextprotocol/sdk@1.30.0/server/mcp.js";
import { StdioServerTransport } from "npm:@modelcontextprotocol/sdk@1.30.0/server/stdio.js";
import { z } from "npm:zod@4.6.5";

export interface Reply { text: string; speech: string }
export interface AlmanacHolidayData { date: string; name: string }

const UNKNOWN_HOME = "I don't know which country's holidays to use. An owner or admin can set the home place in Settings.";
const NOT_FOUND = "I couldn't find an upcoming holiday.";
type Holiday = { date: string; name: string; observed?: string };
type HolidayFile = {
  year_range: { first: number; last: number };
  country_codes: Record<string, string>;
  years: Record<string, Record<string, Holiday[]>>;
};

function plain(text: string): Reply { return { text, speech: text }; }
function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function formatDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!)).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" });
}
function parseNow(value: unknown): { date: string; year: number } {
  if (typeof value === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})T/.exec(value);
    if (match) return { year: Number(match[1]), date: `${match[1]}-${match[2]}-${match[3]}` };
  }
  const now = new Date();
  return { year: now.getFullYear(), date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}` };
}
function validFile(input: unknown): input is HolidayFile {
  if (!input || typeof input !== "object") return false;
  const file = input as Partial<HolidayFile>;
  return !!file.country_codes && typeof file.country_codes === "object"
    && !!file.year_range && Number.isInteger(file.year_range.first) && Number.isInteger(file.year_range.last)
    && !!file.years && typeof file.years === "object";
}

export function summarizeNextHoliday(input: unknown, homeCountry: unknown, nowValue: unknown): Reply {
  if (!validFile(input)) return plain(NOT_FOUND);
  if (typeof homeCountry !== "string" || !homeCountry.trim()) return plain(UNKNOWN_HOME);
  const matched = Object.entries(input.country_codes).find(([name]) => name.toLocaleLowerCase("en-US") === homeCountry.trim().toLocaleLowerCase("en-US"));
  if (!matched) return plain(UNKNOWN_HOME);
  const countryName = matched[0];
  const countryCode = matched[1];
  if (!Object.values(input.years).some((countries) => Object.hasOwn(countries, countryCode))) {
    return plain(`I don't have holiday dates for ${countryName} yet. Ask an owner or admin to check for a Home update.`);
  }
  const now = parseNow(nowValue);
  const first = input.year_range.first;
  const last = input.year_range.last;
  if (now.year < first || now.year > last) return plain(`I don't have holiday dates for ${now.year} yet. Update Home to get newer dates.`);

  for (const year of [now.year, now.year + 1]) {
    if (year > last || year < first) return plain(`I don't have holiday dates for ${year} yet. Update Home to get newer dates.`);
    const holidays = input.years[String(year)]?.[countryCode];
    if (!Array.isArray(holidays)) return plain(NOT_FOUND);
    const next = holidays.find((holiday) => holiday && validDate(holiday.date) && typeof holiday.name === "string" && holiday.date >= now.date);
    if (!next) continue;
    const observed = validDate(next.observed) && next.observed !== next.date ? ` (observed on ${formatDate(next.observed)})` : "";
    return plain(`The next holiday is ${next.name} on ${formatDate(next.date)}${observed}.`);
  }
  return plain(NOT_FOUND);
}

export function nextHolidayData(input: unknown, homeCountry: unknown, nowValue: unknown): AlmanacHolidayData | null {
  if (!validFile(input) || typeof homeCountry !== "string") return null;
  const match = Object.entries(input.country_codes).find(([name]) => name.toLocaleLowerCase("en-US") === homeCountry.trim().toLocaleLowerCase("en-US"));
  if (!match || !Object.values(input.years).some((countries) => Object.hasOwn(countries, match[1]))) return null;
  const now = parseNow(nowValue);
  for (const year of [now.year, now.year + 1]) {
    const next = input.years[String(year)]?.[match[1]]?.find((holiday) => holiday && validDate(holiday.date) && typeof holiday.name === "string" && holiday.date >= now.date);
    if (next) return { date: next.date, name: next.name };
  }
  return null;
}

async function readHolidayFile(): Promise<unknown> {
  try { return JSON.parse(await Deno.readTextFile(new URL("./holidays.json", import.meta.url))); }
  catch { return null; }
}

if (import.meta.main) {
  const server = new McpServer({ name: "almanac-holiday", version: "0.2.0" });
  server.registerTool("handle", { inputSchema: z.object({ __now: z.string().optional(), __home_country: z.string().nullable().optional() }).passthrough() }, async (args: Record<string, unknown>) => {
    const holidays = await readHolidayFile();
    const reply = summarizeNextHoliday(holidays, args.__home_country, args.__now);
    const data = nextHolidayData(holidays, args.__home_country, args.__now);
    return { content: [{ type: "text", text: JSON.stringify({ reply, actions: [], ...(data ? { data } : {}) }) }] };
  });
  await server.connect(new StdioServerTransport());
}

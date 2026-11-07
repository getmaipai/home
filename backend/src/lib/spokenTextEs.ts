// I18N-B1: the Spanish path of the speech normalizer (spokenText.ts calls it for an `es` locale). Numbers, clock times, dates, percents,
// degrees and common units become words; the English path is untouched. Numbers are spelled by a small table (Intl has no spell-out in V8)
// for 0 to 999 999; larger numbers, and anything unrecognized, stay as written. Month names come from Intl.DateTimeFormat.
const SMALL = ["cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte", "veintiuno", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve"];
const TENS = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const HUNDREDS = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];

function underThousand(n: number): string {
  if (n < 30) return SMALL[n]!;
  if (n < 100) return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` y ${SMALL[n % 10]}` : ""}`;
  if (n === 100) return "cien";
  return `${HUNDREDS[Math.floor(n / 100)]}${n % 100 ? ` ${underThousand(n % 100)}` : ""}`;
}
/** Words for 0 to 999 999, or null when out of range. `apocope` turns a trailing "uno" into "un" (before a noun such as "mil"). */
export function spanishNumber(n: number): string | null {
  if (!Number.isInteger(n) || n < 0 || n > 999_999) return null;
  if (n < 1000) return underThousand(n);
  const thousands = Math.floor(n / 1000);
  const rest = n % 1000;
  const head = thousands === 1 ? "mil" : `${underThousand(thousands).replace(/uno$/, "ún").replace(/veintiún$/, "veintiún")} mil`;
  return rest ? `${head} ${underThousand(rest)}` : head;
}
const words = (n: number, raw: string): string => spanishNumber(n) ?? raw;
function monthName(month: number): string { return new Intl.DateTimeFormat("es", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, month - 1, 15))); }
function dayWords(day: number): string { return day === 1 ? "primero" : words(day, String(day)); }
function dateWords(day: number, month: number, year: number): string { return `${dayWords(day)} de ${monthName(month)} de ${words(year, String(year))}`; }

function hourName(hour: number): string { return hour === 1 ? "la una" : `las ${words(hour, String(hour))}`; }
function clock(hour: number, minute: number, meridiem?: "am" | "pm"): string {
  if (meridiem && hour === 12 && minute === 0) return meridiem === "pm" ? "el mediodía" : "la medianoche";
  if (!meridiem && hour === 0 && minute === 0) return "la medianoche";
  let part = "";
  let h = hour;
  if (meridiem) {
    h = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    const day24 = meridiem === "pm" ? (hour === 12 ? 12 : hour + 12) : hour === 12 ? 0 : hour;
    part = day24 < 6 ? "de la madrugada" : day24 < 12 ? "de la mañana" : day24 < 20 ? "de la tarde" : "de la noche";
  }
  else if (hour > 12 || hour === 0) { h = hour === 0 ? 12 : hour - 12; part = hour === 0 ? "de la madrugada" : hour < 20 ? "de la tarde" : "de la noche"; }
  let body: string;
  if (minute === 0) body = `${hourName(h)}${part ? "" : " en punto"}`;
  else if (minute === 15) body = `${hourName(h)} y cuarto`;
  else if (minute === 30) body = `${hourName(h)} y media`;
  else if (minute === 45) body = `${hourName(h === 12 ? 1 : h + 1)} menos cuarto`;
  else body = `${hourName(h)} y ${words(minute, String(minute))}`;
  return part ? `${body} ${part}` : body;
}

const UNITS: Record<string, string> = { km: "kilómetros", kg: "kilogramos", cm: "centímetros", mm: "milímetros", m: "metros", min: "minutos", gb: "gigabytes", mb: "megabytes", tb: "terabytes" };
function decimalWords(raw: string): string {
  const [whole, fraction] = raw.replace(",", ".").split(".");
  const w = spanishNumber(Number(whole));
  if (w === null) return raw;
  return fraction === undefined ? w : `${w} coma ${[...fraction].map((d) => SMALL[Number(d)]).join(" ")}`;
}

/** The Spanish pass: the caller has already protected URLs, code and ids. */
export function spanishSpoken(input: string): string {
  let out = input;
  // "a las 7:30" must not become "a las las siete": the clock phrase drops its own article when the text already has one.
  const clockAt = (hour: number, minute: number, meridiem: "am" | "pm" | undefined, offset: number, whole: string): string => {
    const phrase = clock(hour, minute, meridiem);
    return /\b(?:las|la|el)\s$/i.test(whole.slice(0, offset)) ? phrase.replace(/^(?:las|la|el)\s/, "") : phrase;
  };
  out = out.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m, y: string, mo: string, d: string) => Number(mo) >= 1 && Number(mo) <= 12 ? dateWords(Number(d), Number(mo), Number(y)) : m);
  out = out.replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, (m, d: string, mo: string, y: string) => Number(mo) >= 1 && Number(mo) <= 12 ? dateWords(Number(d), Number(mo), Number(y)) : m);
  out = out.replace(/\b(\d{1,2}):(\d{2})\s*([ap])\.?\s?m\.?(?![\p{L}\d])/giu, (_m, h: string, min: string, ap: string, offset: number, whole: string) => clockAt(Number(h), Number(min), ap.toLowerCase() === "p" ? "pm" : "am", offset, whole));
  out = out.replace(/\b(\d{1,2})\s*([ap])\.?\s?m\.?(?![\p{L}\d])/giu, (_m, h: string, ap: string, offset: number, whole: string) => clockAt(Number(h), 0, ap.toLowerCase() === "p" ? "pm" : "am", offset, whole));
  out = out.replace(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g, (_m, h: string, min: string, offset: number, whole: string) => clockAt(Number(h), Number(min), undefined, offset, whole));
  out = out.replace(/(-?\d+(?:[.,]\d{1,2})?)\s*°\s*([FC])\b/gi, (_m, v: string, u: string) => `${decimalWords(v.replace("-", ""))} grados ${u.toUpperCase() === "F" ? "Fahrenheit" : "centígrados"}`.replace(/^/, v.startsWith("-") ? "menos " : ""));
  out = out.replace(/(\d+(?:[.,]\d{1,2})?)\s*%/g, (_m, v: string) => `${decimalWords(v)} por ciento`);
  out = out.replace(/\b(\d+(?:[.,]\d{1,2})?)\s*(km|kg|cm|mm|min|gb|mb|tb|m)\b/gi, (_m, v: string, u: string) => `${decimalWords(v)} ${UNITS[u.toLowerCase()]}`);
  out = out.replace(/(?<![\w.,])(\d+)(?:[.,](\d{1,2}))?(?![\w.,])/g, (m, whole: string, fraction?: string) => (spanishNumber(Number(whole)) === null ? m : decimalWords(fraction === undefined ? whole : `${whole}.${fraction}`)));
  return out;
}

/** Fixed spoken lines (alarm ringing, timer done, reminder due), written by hand: the only Spanish spoken lines. Every other spoken line stays English. */
export const SPOKEN_LINES_ES = {
  "alarm.due": (v: { task?: string; time?: string }) => `Suena tu alarma${v.time ? ` de ${v.time}` : ""}${v.task && v.task !== "Alarm" ? `: ${v.task}` : ""}.`,
  "timer.done": (v: { duration_text?: string }) => (v.duration_text ? `Tu temporizador de ${v.duration_text} terminó.` : "Tu temporizador terminó."),
  "remind.due": (v: { task?: string }) => (v.task ? `Recordatorio: ${v.task}.` : "Tienes un recordatorio."),
} as const;

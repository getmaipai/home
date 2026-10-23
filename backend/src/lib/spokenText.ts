/** Deterministic English wording for text sent to speech engines. */
const SMALL = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH_PATTERN = "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?";

function underThousand(n: number): string {
  if (n < 20) return SMALL[n]!;
  if (n < 100) return `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${SMALL[n % 10]}` : ""}`;
  return `${SMALL[Math.floor(n / 100)]} hundred${n % 100 ? ` ${underThousand(n % 100)}` : ""}`;
}
function integerWords(n: number): string {
  if (n < 1000) return underThousand(n);
  const groups: string[] = [];
  for (const [size, name] of [[1_000_000_000, "billion"], [1_000_000, "million"], [1_000, "thousand"], [1, ""]] as const) {
    const part = Math.floor(n / size);
    if (part) {
      groups.push(`${underThousand(part)}${name ? ` ${name}` : ""}`);
      n %= size;
    }
  }
  return groups.join(" ");
}
function numberWords(raw: string): string {
  const negative = raw.startsWith("-");
  const value = raw.replace(/^[+-]/, "").replace(/,/g, "");
  const [whole, fraction] = value.split(".");
  const wholeNumber = Number(whole);
  if (!Number.isSafeInteger(wholeNumber) || wholeNumber > 999_999_999_999) return raw;
  const out = `${negative ? "minus " : ""}${integerWords(wholeNumber)}`;
  return fraction === undefined ? out : `${out} point ${[...fraction].map((d) => SMALL[Number(d)]).join(" ")}`;
}
function ordinal(n: number): string {
  const base: Record<number, string> = { 1: "first", 2: "second", 3: "third", 5: "fifth", 8: "eighth", 9: "ninth", 12: "twelfth" };
  if (base[n]) return base[n];
  if (n < 20) return `${SMALL[n]}th`;
  if (n < 100) {
    const rem = n % 10;
    return rem ? `${TENS[Math.floor(n / 10)]}-${ordinal(rem)}` : `${TENS[n / 10]}ieth`;
  }
  if (n < 1000) return n % 100 ? `${underThousand(Math.floor(n / 100))} ${ordinal(n % 100)}` : `${underThousand(n / 100)}th`;
  return `${integerWords(n)}th`;
}
function yearWords(year: number): string {
  if (year >= 2000 && year <= 2009) return year === 2000 ? "two thousand" : `two thousand ${SMALL[year - 2000]}`;
  if (year >= 2010 && year <= 2099) return `twenty ${underThousand(year - 2000)}`;
  if (year >= 1900 && year <= 1999) return `nineteen ${underThousand(year - 1900)}`;
  return numberWords(String(year));
}
function monthName(value: string): string { return MONTHS.find((m) => m.toLowerCase().startsWith(value.toLowerCase().slice(0, 3))) ?? value; }
function timeHour(hour: number): string { return numberWords(String(hour)); }
function timeMinute(minute: number): string { return minute < 10 ? `oh ${numberWords(String(minute))}` : numberWords(String(minute)); }
function clockWords(hour: number, minute: number, meridiem?: string): string {
  if (meridiem) {
    const pm = meridiem.toLowerCase() === "pm";
    if (hour === 12 && minute === 0) return pm ? "noon" : "midnight";
    const h = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    return `${timeHour(h)}${minute ? ` ${timeMinute(minute)}` : ""} ${pm ? "P M" : "A M"}`;
  }
  // Unmarked: a 24-hour time says which part of the day it is ("15:30" is "three thirty in the afternoon"); an hour below 12 is read as written.
  if (hour === 0 && minute === 0) return "midnight";
  if (hour > 12 || hour === 0) {
    const h = hour === 0 ? 12 : hour - 12;
    const part = hour === 0 ? "in the morning" : hour < 18 ? "in the afternoon" : hour < 22 ? "in the evening" : "at night";
    return `${timeHour(h)}${minute ? ` ${timeMinute(minute)}` : ""} ${part}`;
  }
  return `${timeHour(hour)}${minute ? ` ${timeMinute(minute)}` : ""}`;
}

export function toSpokenText(text: string, opts: { locale?: string } = {}): string {
  if (opts.locale && !/^en(?:-|$)/i.test(opts.locale)) return text;
  const protectedParts: string[] = [];
  const tokenFor = (index: number) => {
    let n = index;
    let key = "";
    do { key = String.fromCharCode(65 + n % 26) + key; n = Math.floor(n / 26) - 1; } while (n >= 0);
    return `\uE000${key}\uE001`;
  };
  const hold = (value: string) => tokenFor(protectedParts.push(value) - 1);
  let out = text
    .replace(/```[\s\S]*?```|`[^`]*`/g, hold)
    .replace(/(?:https?:\/\/|ftp:\/\/|www\.)[^\s<>]+/gi, hold)
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, hold)
    .replace(/\b\d+(?:\.\d+){2,}\b/g, hold)
    .replace(/#[\p{L}\p{N}_]+/gu, hold)
    .replace(/\b(?:COVID-\d+|[A-Z]*\d+[A-Z][A-Z\d]*|[A-Z]{2,}\d+[A-Z\d]*)\b/g, hold);

  // Full dates before clocks and general numbers.
  out = out.replace(new RegExp(`\\b(${MONTH_PATTERN})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, "gi"), (_m, month: string, day: string, year?: string) => `${monthName(month)} ${ordinal(Number(day))}${year ? `, ${yearWords(Number(year))}` : ""}`);
  out = out.replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, (_m, month: string, day: string, year: string) => `${MONTHS[Number(month) - 1] ?? month} ${ordinal(Number(day))}, ${yearWords(Number(year))}`);
  out = out.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_m, year: string, month: string, day: string) => `${MONTHS[Number(month) - 1] ?? month} ${ordinal(Number(day))}, ${yearWords(Number(year))}`);

  // Clock times, including both 12-hour and unmarked 24-hour forms.
  out = out.replace(/\b(\d{1,2}):(\d{2})\s*([ap])\.?m\.?\b/gi, (_m, h: string, min: string, ap: string) => clockWords(Number(h), Number(min), ap.toLowerCase() + "m"));
  out = out.replace(/\b(\d{1,2})\s*([ap])\.?m\.?\b/gi, (_m, h: string, ap: string) => clockWords(Number(h), 0, ap.toLowerCase() + "m"));
  out = out.replace(/\b(\d{1,2}):(\d{2})\b/g, (_m, h: string, min: string) => clockWords(Number(h), Number(min)));

  // Currency, temperature and common units.
  out = out.replace(/\$\s*(-?\d[\d,]*)(?:\.(\d{1,2}))?/g, (_m, dollars: string, cents?: string) => {
    const d = Number(dollars.replace(/,/g, ""));
    const c = cents ? Number(cents.padEnd(2, "0")) : 0;
    if (d > 999_999_999_999) return _m;
    const dollarWords = d || !c ? `${numberWords(dollars)} dollar${d === 1 ? "" : "s"}` : "";
    const centWords = c ? `${numberWords(String(c))} cent${c === 1 ? "" : "s"}` : "";
    return dollarWords && centWords ? `${dollarWords} and ${centWords}` : dollarWords || centWords;
  });
  out = out.replace(/([€£])\s*(-?\d[\d,]*(?:\.\d+)?)/g, (_m, symbol: string, value: string) => `${numberWords(value)} ${symbol === "€" ? "euros" : "pounds"}`);
  out = out.replace(/(-?\d[\d,]*(?:\.\d+)?)\s*°\s*([FC])\b/gi, (_m, value: string, unit: string) => `${numberWords(value)} degrees ${unit.toUpperCase() === "F" ? "Fahrenheit" : "Celsius"}`);
  const units: Record<string, string> = { km: "kilometers", mi: "miles", lb: "pounds", lbs: "pounds", kg: "kilograms", m: "meters", cm: "centimeters", mm: "millimeters", gb: "gigabytes", mb: "megabytes", tb: "terabytes", mph: "miles per hour", kmh: "kilometers per hour", min: "minutes", sec: "seconds", hr: "hours", ft: "feet", in: "inches" };
  out = out.replace(/\b(-?\d[\d,]*(?:\.\d+)?)\s*(km|mi|lbs?|kg|cm|mm|gb|mb|tb|mph|kmh|min|sec|hr|ft|in)\b/gi, (_m, value: string, unit: string) => `${numberWords(value)} ${units[unit.toLowerCase()]}`);
  out = out.replace(/\b(-?\d[\d,]*\.?\d*)%/g, (_m, value: string) => `${numberWords(value)} percent`);

  // Phone-like strings take precedence over standalone year wording.
  out = out.replace(/(?<![\w.])(?:\+?\d[\d(). -]{7,}\d)(?![\w.])/g, (value) => [...value.replace(/\D/g, "")].map((d) => SMALL[Number(d)]).join(" "));

  // Date years, ordinals, ranges and remaining plain numbers.
  out = out.replace(/\b(19\d{2}|20\d{2})\b/g, (_m, year: string) => yearWords(Number(year)));
  out = out.replace(/\b(\d{1,3})(st|nd|rd|th)\b/gi, (_m, n: string) => ordinal(Number(n)));
  out = out.replace(/\b(\d{1,3})\s*-\s*(\d{1,3})\b/g, (_m, a: string, b: string) => `${numberWords(a)} to ${numberWords(b)}`);
  out = out.replace(/(?<![\w.])(-?\d[\d,]*(?:\.\d+)?)(?![\w.]|\s*(?:%|°|[A-Za-z]))/g, (_m, value: string) => numberWords(value));

  return out.replace(/\uE000([A-Z]+)\uE001/g, (_m, key: string) => {
    let index = 0;
    for (const letter of key) index = index * 26 + letter.charCodeAt(0) - 64;
    return protectedParts[index - 1] ?? _m;
  });
}

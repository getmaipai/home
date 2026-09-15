// ALM-01, chunk A: the almanac compute module. Rule-layer grammar for
// date and time questions plus their deterministic answers, from the
// same frozen clock the handlers read (the bench pins it through
// promptNow in lib/benchSampling). Pure: every function takes `now` as
// an argument and never reads the process clock itself. Design record:
// docs/dev.md section 16 part 6 (rule 1). No engine wiring in this chunk.

/** The weekday names, Sunday first, index == getDay(). */
export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** A date referenced in the question, day-first. */
export type DateReferent = {
  day: number;
  month?: number; // 1-12
  year?: number;
};

export type DateQuestion =
  | { kind: "relative_weekday"; which: "next" | "this" | "last"; weekday: number }
  | { kind: "relative_day"; offset: number }
  | { kind: "days_until"; referent: DateReferent }
  | { kind: "days_since"; referent: DateReferent }
  | { kind: "weekday_of"; referent: DateReferent }
  | { kind: "is_weekday"; referent: DateReferent; weekday: number }
  | { kind: "next_clock"; hour: number; minute: number }
  | { kind: "date_of_next_clock"; hour: number; minute: number };

export type DateAnswer = {
  text: string;
  inputs: { clock: string; referent?: string; term: string };
  readings?: [string, string];
};

/** A date phrase: "the 27th", "the 27th of june", "june 27", "june 27th
 * 2026". A bare "27/6" is ambiguous and not read. */
const MONTH_RE =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

/** Parse a clock from stripped text: "1041", "1041pm", "10pm", "12". */
const CLOCK_RE =
  "(\\d{1,4})(am|pm)?";

/** Lower-case and drop every non-alphanumeric character. */
function strip(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function monthIndex(name: string): number {
  const i = MONTHS.findIndex((m) => m.toLowerCase().startsWith(name.toLowerCase()));
  return i + 1; // 1-based
}

function parseReferent(text: string): DateReferent | null {
  const t = strip(text);

  // Day-first: "the27th", "the27thofjune", "the27thofjune2026", "27th2026"
  const dm = t.match(new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?(?:(?:of)?(${MONTH_RE}))?(?:(?:of)?(\\d{4}))?`));
  if (dm) {
    const day = Number(dm[1]);
    if (day >= 1 && day <= 31) {
      return {
        day,
        month: dm[2] ? monthIndex(dm[2]) : undefined,
        year: dm[3] ? Number(dm[3]) : undefined,
      };
    }
  }

  // Month-first: "june27", "june27th2026"
  const md = t.match(new RegExp(`(${MONTH_RE})(\\d{1,2})(?:st|nd|rd|th)?(?:(\\d{4}))?`));
  if (md) {
    const day = Number(md[2]);
    if (day >= 1 && day <= 31) {
      return {
        day,
        month: monthIndex(md[1] ?? ""),
        year: md[3] ? Number(md[3]) : undefined,
      };
    }
  }
  return null;
}

function parseClock(text: string): { hour: number; minute: number; meridiem: "am" | "pm" | null } | null {
  const t = strip(text);
  const m = t.match(new RegExp(CLOCK_RE));
  if (!m) return null;
  const digits = m[1] ?? "";
  const meridiem = (m[2] as "am" | "pm" | undefined) ?? null;
  let hour: number;
  let minute: number;
  if (digits.length === 4) {
    hour = Number(digits.slice(0, 2));
    minute = Number(digits.slice(2));
  } else if (digits.length === 2) {
    hour = Number(digits);
    minute = 0;
  } else if (digits.length === 1) {
    hour = Number(digits);
    minute = 0;
  } else {
    return null;
  }
  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
  } else {
    if (hour > 23) return null;
  }
  return { hour, minute, meridiem };
}

/** The next instant at or after `now` at which the wall clock reads
 * `hour:minute`. 12-hour reading when no meridiem was given, so a bare
 * "10:41" at 10:43 pm is 10:41 am tomorrow, never tonight. */
function nextClockInstant(hour: number, minute: number, now: Date): Date {
  const cand = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    hour,
    minute,
    0,
    0
  );
  if (cand <= now) {
    cand.setDate(cand.getDate() + 1);
  }
  return cand;
}

/** The referent's date: with a year, that year; with a month, the next
 * occurrence of month+day on or after today; day only, the next
 * occurrence of that day-of-month on or after today (this month if still
 * ahead, else next month). */
function resolveReferentDate(referent: DateReferent, now: Date): Date {
  const y = referent.year ?? now.getFullYear();
  const mo = referent.month ?? now.getMonth() + 1;
  const d = new Date(y, mo - 1, referent.day);
  if (d >= now) return d;
  // Roll forward by year.
  let yy = y;
  for (;;) {
    const cand = new Date(yy, mo - 1, referent.day);
    if (cand >= now) return cand;
    yy += 1;
  }
}

/** Relative-weekday target: the named weekday's occurrence. "next" is
 * strictly after today; "this" is today if it is that weekday, else the
 * upcoming one; "last" is the previous one. */
function resolveRelativeWeekday(which: "next" | "this" | "last", weekday: number, now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const delta = (weekday - d.getDay() + 7) % 7;
  if (which === "this") {
    return delta === 0
      ? d
      : new Date(d.getFullYear(), d.getMonth(), d.getDate() + delta);
  }
  if (which === "last") {
    const back = delta === 0 ? 7 : delta;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back);
  }
  const fwd = delta === 0 ? 7 : delta;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + fwd);
}

/** Rule-layer grammar. One deterministic regex family, lower-cased input,
 * punctuation ignored (stripped to concatenated alphanumeric).
 * Returns null when nothing matches. */
export function parseDateQuestion(
  text: string,
  carried?: string | null
): DateQuestion | null {
  const t = strip(text);
  if (!t) return null;
  const weekdayNames = WEEKDAYS.map((w) => w.toLowerCase()).join("|");

  // relative_weekday: "nextfriday", "whatsthe datenextfriday", "thismonday", "lastsunday"
  const rw = t.match(new RegExp(`^(?:whatsthe)?date?(?:next|this|last)(${weekdayNames})$`));
  if (rw) {
    const w = t.includes("next") ? "next" : t.includes("this") ? "this" : "last";
    const weekday = WEEKDAYS.findIndex((d) => d.toLowerCase() === (rw[1] ?? ""));
    if (weekday >= 0) {
      return { kind: "relative_weekday", which: w, weekday };
    }
  }

  // relative_day: "tomorrow", "yesterday", "thedayaftertomorrow", "in5days"
  if (t === "tomorrow" || t === "whatsthedate tomorrow" || t === "whatsthe datetomorrow") {
    return { kind: "relative_day", offset: 1 };
  }
  if (t === "yesterday" || t === "whatsthedate yesterday" || t === "whatsthe dateyesterday") {
    return { kind: "relative_day", offset: -1 };
  }
  if (t === "thedayaftertomorrow") {
    return { kind: "relative_day", offset: 2 };
  }
  const inDays = t.match(new RegExp(`^(?:in(\\d+)days?$|tomorrowin(\\d+)days?)$`));
  if (inDays) {
    const n = Number(inDays[1] ?? inDays[2] ?? "");
    if (n > 0) return { kind: "relative_day", offset: n };
  }

  // days_until: "howmanydaysuntilthe27th", "howmanydaysuntil27",
  // "howmanydaysisthat" (carried)
  const du = t.match(new RegExp(`^howmanydays(?:until|till|to|before)(.+)$`));
  if (du) {
    const referent = parseReferent(du[1] ?? "");
    if (referent) return { kind: "days_until", referent };
  }
  if (t === "howmanydaysisthat" || t === "howmanydaysareleft") {
    if (carried) {
      const referent = parseReferent(carried);
      if (referent) return { kind: "days_until", referent };
    }
  }

  // days_since: "howmanydayssince<referent>"
  const ds = t.match(new RegExp(`^howmanydayssince(.+)$`));
  if (ds) {
    const referent = parseReferent(ds[1] ?? "");
    if (referent) return { kind: "days_since", referent };
  }

  // weekday_of: "whatdayisthe27th", "whichdayisthe27th", "whatdayiswaswillbe...",
  // "whichdayisthat" (carried)
  const wo = t.match(new RegExp(`^(?:what|which)day(?:is|was|willbe)(.+)$`));
  if (wo) {
    const referent = parseReferent(wo[1] ?? "");
    if (referent) return { kind: "weekday_of", referent };
  }
  if (t === "whichdayisthat" || t === "whatdayisthat") {
    if (carried) {
      const referent = parseReferent(carried);
      if (referent) return { kind: "weekday_of", referent };
    }
  }

  // is_weekday: "isthe27thafriday", "is27thafraiday"
  const iw = t.match(new RegExp(`^(?:is)(.+?)(?:a)(${weekdayNames})$`));
  if (iw) {
    const referent = parseReferent(iw[1] ?? "");
    const weekday = WEEKDAYS.findIndex((d) => d.toLowerCase() === (iw[2] ?? ""));
    if (referent && weekday >= 0) {
      return { kind: "is_weekday", referent, weekday };
    }
  }

  // next_clock: "thenexttimeits1041", "whenthenexttimeits1041"
  const nc = t.match(new RegExp(`^(?:the|whens?)thenexttimeits?(.+)$`));
  if (nc) {
    const clock = parseClock(nc[1] ?? "");
    if (clock) {
      let hour = clock.hour;
      if (!clock.meridiem) hour = hour % 12;
      if (hour === 12) hour = 0;
      return { kind: "next_clock", hour, minute: clock.minute };
    }
  }

  // date_of_next_clock: "whatdatewillitbethen", "whatdatewillitbeat1041",
  // "whichdateisthat" (carried clock)
  const dnc = t.match(new RegExp(`^whatdatewillitbe(?:then|at)(.+)$`));
  if (dnc) {
    const clock = parseClock(dnc[1] ?? "");
    if (clock) {
      let hour = clock.hour;
      if (!clock.meridiem) hour = hour % 12;
      if (hour === 12) hour = 0;
      return { kind: "date_of_next_clock", hour, minute: clock.minute };
    }
  }
  if (t === "whichdateisthat" || t === "whatdateisthat") {
    if (carried) {
      const c = parseClock(carried);
      if (c) {
        let hour = c.hour;
        if (!c.meridiem) hour = hour % 12;
        if (hour === 12) hour = 0;
        return { kind: "date_of_next_clock", hour, minute: c.minute };
      }
    }
  }

  return null;
}

function pad(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

function clockText(hour: number, minute: number, ampm: "am" | "pm"): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${pad(minute)} ${ampm}`;
}

function dayPartOf(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function daysBetween(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

export function computeDateAnswer(
  q: DateQuestion,
  now: Date,
  term = ""
): DateAnswer {
  const clock = now.toISOString();

  switch (q.kind) {
    case "relative_day": {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + q.offset);
      return {
        text: `${WEEKDAYS[d.getDay()]}, ${dayPartOf(d)}.`,
        inputs: { clock, term },
      };
    }

    case "relative_weekday": {
      const delta = (q.weekday - now.getDay() + 7) % 7;
      if (q.which === "next" && delta <= 2) {
        // Ambiguous: today's weekday is within two days before the named
        // weekday. Both readings in one sentence, no question mark.
        const d1 = resolveRelativeWeekday("this", q.weekday, now);
        const d2 = new Date(d1.getFullYear(), d1.getMonth(), d1.getDate() + 7);
        const w = WEEKDAYS[q.weekday];
        return {
          text: `This ${w} is the ${d1.getDate()}th; the one after is the ${d2.getDate()}th.`,
          inputs: { clock, term },
          readings: [dayPartOf(d1), dayPartOf(d2)],
        };
      }
      const d = resolveRelativeWeekday(q.which, q.weekday, now);
      return {
        text: `${WEEKDAYS[d.getDay()]}, ${dayPartOf(d)}.`,
        inputs: { clock, term },
      };
    }

    case "days_until": {
      const d = resolveReferentDate(q.referent, now);
      const n = daysBetween(now, d);
      return {
        text: `The ${q.referent.day}th is a ${WEEKDAYS[d.getDay()]}, ${n} days from today.`,
        inputs: { clock, referent: `${q.referent.day}`, term },
      };
    }

    case "days_since": {
      const d = resolveReferentDate(q.referent, now);
      const n = daysBetween(d, now);
      return {
        text: `The ${q.referent.day}th is a ${WEEKDAYS[d.getDay()]}, ${n} days ago.`,
        inputs: { clock, referent: `${q.referent.day}`, term },
      };
    }

    case "weekday_of": {
      const d = resolveReferentDate(q.referent, now);
      return {
        text: `The ${q.referent.day}th is a ${WEEKDAYS[d.getDay()]}.`,
        inputs: { clock, referent: `${q.referent.day}`, term },
      };
    }

    case "is_weekday": {
      const d = resolveReferentDate(q.referent, now);
      const actual = d.getDay();
      const yesNo = actual === q.weekday ? "Yes" : "No";
      return {
        text: `${yesNo}, the ${q.referent.day}th is a ${WEEKDAYS[actual]}.`,
        inputs: { clock, referent: `${q.referent.day}`, term },
      };
    }

    case "next_clock": {
      const instant = nextClockInstant(q.hour, q.minute, now);
      const ampm = instant.getHours() < 12 ? "am" : "pm";
      const rel = dateRelation(instant, now);
      const text = `The next time it's ${clockText(q.hour, q.minute, ampm)} is ${rel} ${WEEKDAYS[instant.getDay()]}, ${dayPartOf(instant)}, at ${clockText(instant.getHours(), instant.getMinutes(), ampm)}.`;
      return {
        text,
        inputs: { clock, term },
      };
    }

    case "date_of_next_clock": {
      const instant = nextClockInstant(q.hour, q.minute, now);
      return {
        text: `The date will be ${WEEKDAYS[instant.getDay()]}, ${dayPartOf(instant)}.`,
        inputs: { clock, term },
      };
    }
  }
}

/** CHAT-16 rule 2: a date's relation to today, as a short plain phrase. */
export function dateRelation(date: Date, now: Date): string {
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const n = daysBetween(b, date);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  if (n > 1) return `in ${n} days`;
  return `${-n} days ago`;
}

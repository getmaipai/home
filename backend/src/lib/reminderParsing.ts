// Step 8's own natural-language parsing, split from packageHost.ts for
// the same reason spec/interpreters/ts/compute.ts is its own file: real,
// independently testable logic a package's own recipe hands free-typed
// text to, not something to bury inside the host's dispatch switch.
//
// Two different tools for two different reliability needs (a real
// design decision, not an oversight): `remind` needs genuine
// natural-language date resolution ("at 6", "tomorrow at noon", "tonight
// at 8") - a large, well-solved problem `chrono-node` (MIT, actively
// maintained) is the right prebuilt answer for, per the org's own
// "prebuilt over hand-built" rule. `timer` needs the opposite: "ten
// minutes" must mean exactly now+10min, and neither a general NL date
// grammar nor a language model (`llm_complete`) is trustworthy for that
// precision - this is exactly the "mechanical, not a judgment call" case
// the org's own model-role guidance says should never be left to a
// model. A ~15-line deterministic parser, reusing the plain arithmetic
// idea `lib/scheduler.ts`'s own recurrence UNIT_MS already uses (a
// separate, seconds-inclusive map here, not a shared import: that map's
// own keys are recurrence-grammar letters, not the full unit words a
// person actually says).
//
// Known, deliberately unfixed gap found by testing beyond this file's
// own unit tests (code review, 2026-09-06): chrono-node's own matched
// span doesn't always cover a whole compound relative duration - "in an
// hour and a half" resolves as if it were "in an hour" alone, silently
// short by 30 minutes. Rejecting every phrasing chrono can misjudge
// isn't tractable (that's the whole reason a maintained NL date library
// exists instead of a hand-rolled one), so this is documented rather
// than chased: `remind`'s own README says a single time unit ("in 90
// minutes") is the reliable phrasing, not a compound one.
import * as chrono from "chrono-node";
import { HostError } from "@maipai/spec/emulators/ts/host-emulator.js";

export interface ParsedReminder {
  task: string;
  when: string; // ISO datetime, ready for scheduleCoreJob/parseWhen
  when_text: string; // ready-to-speak confirmation
}

// A leading/trailing connector word (or preposition) left over once
// chrono's own matched time phrase is cut out of the middle of the
// sentence. Two real shapes found by testing, not assumed: "at 6 TO
// call Nadia" -> "TO call Nadia" once "at 6" is removed (a trailing
// connector before the match); and "AT noon AND don't forget the cake"
// -> "AT AND don't forget the cake" once chrono matches only "noon", not
// "at noon" (chrono's own match boundary doesn't always cover the whole
// prepositional phrase, leaving "at" dangling in front of a SECOND
// connector, "and"). One pass only handled the first shape - looped
// until nothing more strips, so a leading "at" exposing a leading "and"
// underneath it both come off, not just the outer one.
const LEADING_CONNECTOR = /^(to|that|and|at|on|in|by|for)\s+/i;
const TRAILING_CONNECTOR = /\s+(to|and|at|on|in|by|for)$/i;

// chrono's own matched span sometimes cuts a word in half rather than at
// a word boundary - "tomorrow's show" matches only "tomorrow", leaving a
// stray "'s" glued to the front of whatever comes after the removed
// span ("... 's show"). A code review (2026-09-06) found this by
// testing beyond this file's own cases; stripped from the tail segment
// itself, right where it's created, not from the final joined string -
// by the time before/after are joined there's no way to tell "'s" was
// ever glued to the match rather than typed by the household member.
const STRAY_POSSESSIVE = /^'s\s*/;

function cleanTask(raw: string): string {
  let text = raw.trim().replace(/\s{2,}/g, " ");
  for (;;) {
    const stripped = text.replace(LEADING_CONNECTOR, "").replace(TRAILING_CONNECTOR, "").trim();
    if (stripped === text) return text;
    text = stripped;
  }
}

function formatWhenText(date: Date): string {
  return date.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** `text` is already the routing pattern's own wildcard capture (the
 * literal "remind me " prefix is never part of it) - e.g. "at 6 to call
 * Nadia". Throws `invalid_input` when no time phrase is found, or when
 * nothing is left to remind about once the time phrase is removed - both
 * real, expected, recoverable cases a household member's own free
 * typing can produce, the same "a clean 400, not a crash" standard
 * `compute`'s own ComputeError already set. */
export function parseReminder(text: string, now: Date = new Date()): ParsedReminder {
  const results = chrono.parse(text, now, { forwardDate: true });
  const match = results[0];
  if (!match) {
    throw new HostError("invalid_input", `I couldn't figure out when to remind you - try saying a time, like "at 6" or "tomorrow at noon".`);
  }
  const before = text.slice(0, match.index);
  // chrono has no concept of recurrence - "every morning at 8" resolves
  // to one specific next occurrence, silently dropping the "every" a
  // household member actually meant. Found by testing beyond this
  // file's own cases (code review, 2026-09-06): rather than confirm a
  // one-shot reminder nobody asked for, reject honestly. Checked only
  // as the word immediately before the matched time phrase - the exact
  // shape "every <time phrase>" takes - so it doesn't false-positive on
  // "every" used as an ordinary word elsewhere in the sentence ("check
  // every window is locked").
  if (/\bevery\s*$/i.test(before)) {
    throw new HostError("invalid_input", `Recurring reminders aren't supported yet - try a one-time reminder, like "remind me at 6 to call Nadia".`);
  }
  const afterRaw = text.slice(match.index + match.text.length);
  const after = afterRaw.replace(STRAY_POSSESSIVE, "");
  const task = cleanTask(`${before} ${after}`);
  if (!task) {
    throw new HostError("invalid_input", "What should I remind you about?");
  }
  const date = match.start.date();
  return { task, when: date.toISOString(), when_text: formatWhenText(date) };
}

export interface ParsedTimer {
  label: string;
  when: string; // ISO datetime
  when_text: string;
}

const WORD_NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
};
const TIMER_UNIT_MS: Record<string, number> = { second: 1_000, minute: 60_000, hour: 3_600_000 };
const DURATION_RE = /^(\d+|[a-z]+)\s+(second|minute|hour)s?$/i;

/** `text` is already the routing pattern's own wildcard capture - e.g.
 * "ten minutes" from "set a timer for ten minutes". Deterministic only:
 * no chrono-node, no llm_complete - see this file's own header for why a
 * timer's precision needs exact arithmetic, not natural-language
 * inference. Throws `invalid_input` for anything this narrow grammar
 * doesn't cover, the same "ask again" fallback almanac-holiday's own
 * not-found case takes rather than guessing. */
export function parseTimerDuration(text: string, now: Date = new Date()): ParsedTimer {
  const match = text.trim().toLowerCase().match(DURATION_RE);
  const rawN = match?.[1];
  const unitWord = match?.[2];
  const n = rawN && /^\d+$/.test(rawN) ? Number(rawN) : rawN ? WORD_NUMBERS[rawN] : undefined;
  if (!match || n === undefined || n <= 0 || !unitWord) {
    throw new HostError("invalid_input", `I couldn't understand "${text}" as a length of time - try something like "ten minutes" or "2 hours".`);
  }
  const durationMs = n * TIMER_UNIT_MS[unitWord]!;
  const date = new Date(now.getTime() + durationMs);
  const label = text.trim();
  return { label, when: date.toISOString(), when_text: formatWhenText(date) };
}

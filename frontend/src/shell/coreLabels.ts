import { i18n } from "@lingui/core";

/** The shell's own destinations (nav.ts, appCatalog.ts) keep their English text as data; this is the one place that turns a
 * route into its translated label and description, read at the moment of use so it follows the active language. */
export function coreLabel(to: string): string | undefined {
  switch (to) {
    case "/": return i18n._({ id: "Home", message: "Home" });
    case "/chat": return i18n._({ id: "Chat", message: "Chat" });
    case "/people": return i18n._({ id: "Family", message: "Family" });
    case "/house": return i18n._({ id: "House", message: "House" });
    case "/reference": return i18n._({ id: "Reference", message: "Reference" });
    case "/privacy": return i18n._({ id: "Privacy", message: "Privacy" });
    case "/settings": return i18n._({ id: "Settings", message: "Settings" });
    case "/memory": return i18n._({ id: "Memories", message: "Memories" });
    case "/companions": return i18n._({ id: "Synths", message: "Synths" });
    case "/reminders": return i18n._({ id: "Reminders", message: "Reminders" });
    case "/clock": return i18n._({ id: "Clock", message: "Clock" });
    case "/wikipedia": return i18n._({ id: "Wikipedia", message: "Wikipedia" });
    default: return undefined;
  }
}

export function coreDescription(to: string): string | undefined {
  switch (to) {
    case "/chat": return i18n._({ id: "Ask, think, and talk things through.", message: "Ask, think, and talk things through." });
    case "/memory": return i18n._({ id: "The details you want MaiPai to remember.", message: "The details you want MaiPai to remember." });
    case "/companions": return i18n._({ id: "Meet your household's synths and pick who is your companion.", message: "Meet your household's synths and pick who is your companion." });
    case "/people": return i18n._({ id: "Everyone who shares your home.", message: "Everyone who shares your home." });
    case "/reminders": return i18n._({ id: "Alarms, timers and things to remember.", message: "Alarms, timers and things to remember." });
    case "/clock": return i18n._({ id: "The time, alarms and timers.", message: "The time, alarms and timers." });
    case "/wikipedia": return i18n._({ id: "Read Wikipedia from your own library, no internet needed.", message: "Read Wikipedia from your own library, no internet needed." });
    case "/privacy": return i18n._({ id: "Understand and control what you share.", message: "Understand and control what you share." });
    case "/settings": return i18n._({ id: "Make MaiPai feel like yours.", message: "Make MaiPai feel like yours." });
    default: return undefined;
  }
}

/** A catalog or nav entry with its label (and description, when it has one) in the active language. Package apps pass through. */
export function localizeCore<T extends { to: string; label: string; description?: string }>(entry: T): T {
  const label = coreLabel(entry.to);
  if (!label) return entry;
  const description = coreDescription(entry.to);
  return { ...entry, label, ...(description && entry.description !== undefined ? { description } : {}) };
}

// I18N-B1 (design note i18n-2026-11-07, section 9 steps 2 and 4): the server renderer for typed notifications. The web bell renders a
// row's { typeId, values } through the extracted catalogs; the channels with no client (Telegram) render here, in the recipient's
// locale, from lib/notificationCopy.ts (English) and lib/notificationCopyEs.ts (hand-written Spanish). Anything this cannot render
// (no template for the type, a missing value, a minor recipient) returns null and the caller sends the stored English text.
import { setupI18n, type I18n } from "@lingui/core";
import { compileMessage } from "@lingui/message-utils/compileMessage";
import type { PersonRow } from "@/types";
import { speakerAgeBand } from "@/lib/ageBand";
import { resolveLocale } from "@/lib/locale";
import { NOTIFICATION_COPY } from "@/lib/notificationCopy";
import { NOTIFICATION_ES } from "@/lib/notificationCopyEs";
import { SPOKEN_LINES_ES } from "@/lib/spokenTextEs";
import { toSpokenText } from "@/lib/spokenText";

export type NotificationValues = Record<string, string>;

const instances = new Map<string, I18n>();
function instanceFor(lang: "en" | "es"): I18n {
  let instance = instances.get(lang);
  if (!instance) {
    instance = setupI18n({ locale: lang, messages: { [lang]: {} } });
    instance.setMessagesCompiler(compileMessage);
    const messages: Record<string, string> = {};
    for (const [typeId, line] of Object.entries(NOTIFICATION_COPY)) messages[line.id] = lang === "es" ? NOTIFICATION_ES[typeId] ?? line.message : line.message;
    instance.load(lang, messages);
    instance.activate(lang);
    instances.set(lang, instance);
  }
  return instance;
}

/** Integer-looking strings become numbers so an ICU plural can pick a form; everything else stays text. */
function coerce(values: NotificationValues): Record<string, string | number> {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, /^\d+$/.test(value) && String(Number(value)) === value ? Number(value) : value]));
}

/** The language a locale renders in: Spanish for any `es` locale, English for everything else. */
export function notificationLanguage(locale: string): "en" | "es" { return /^es(?:-|$)/i.test(locale) ? "es" : "en"; }

/** The placeholder names a template uses (plural arguments included), for the consistency test. */
export function placeholdersOf(template: string): string[] {
  const names = new Set<string>();
  for (const match of template.matchAll(/\{\s*(\w+)\s*[,}]/g)) names.add(match[1]!);
  return [...names].sort();
}

/** The typed line for a locale, or null when the type has no template or a value it needs is missing. */
export function renderNotification(typeId: string, values: NotificationValues | null | undefined, locale: string): string | null {
  const line = NOTIFICATION_COPY[typeId];
  if (!line || !values) return null;
  const lang = notificationLanguage(locale);
  const template = lang === "es" ? NOTIFICATION_ES[typeId] ?? line.message : line.message;
  if (placeholdersOf(template).some((name) => !(name in values))) return null;
  try { return instanceFor(lang)._(line.id, coerce(values)); } catch { return null; }
}

/** The line for one recipient: their locale, except that a child or teen always gets English (rule 0). Null means "use the stored text". */
export function renderNotificationFor(recipient: PersonRow, typeId: string, values: NotificationValues | null | undefined, now = new Date()): string | null {
  const locale = speakerAgeBand(recipient, now) === "adult" ? resolveLocale(recipient) : "en-US";
  return renderNotification(typeId, values, locale);
}

/** A hand-written fixed spoken line (alarm ringing, timer done, reminder due) for a Spanish-speaking adult, already run through the speech
 * normalizer. Null for everyone else (English speakers, children and teens by rule 0) and for every other type: those spoken and robot lines
 * stay English and are never machine-translated. */
export function spokenNotificationLine(recipient: PersonRow, typeId: string, values: Record<string, string>, now = new Date()): string | null {
  if (speakerAgeBand(recipient, now) !== "adult") return null;
  const locale = resolveLocale(recipient);
  if (notificationLanguage(locale) !== "es") return null;
  const make = (SPOKEN_LINES_ES as Record<string, (v: Record<string, string>) => string>)[typeId];
  return make ? toSpokenText(make(values), { locale }) : null;
}

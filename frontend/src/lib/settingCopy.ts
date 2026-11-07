// I18N-F3 (design note section 10): setting copy reaches the screen through the generated catalog ids. The server sends the spec
// English; this looks the same text up by id and uses the translation only while the English still matches the generated source.
import { i18n } from "@lingui/core";
import { AREA_COPY, SETTING_COPY, SETTING_REASONS } from "./settingCopy.generated";
import { languageName as formatLanguageName } from "@/lib/format";

type Def = { key: string; label: string; help?: string; copy?: Record<string, unknown> };

/** One registry field (`label`, `help`, `option_label.<value>`, ...) in the active language. */
export function settingText(key: string, field: string, english: string): string {
  const entry = SETTING_COPY[`setting.${key}.${field}`];
  return entry && entry.en === english ? entry.t() : english;
}
export const settingLabel = (def: Def): string => settingText(def.key, "label", def.label);
export const settingHelp = (def: Def): string | undefined => (def.help === undefined ? undefined : settingText(def.key, "help", def.help));
export const settingOptionLabel = (def: Def, value: string, english: string): string => settingText(def.key, `option_label.${value}`, english);
export const settingOptionNote = (def: Def, value: string, english: string): string => settingText(def.key, `option.${value}`, english);

const COPY_FIELDS = ["does_child", "does_teen", "does", "title", "what_is_stored", "consent_adult_self", "consent_teen_self", "consent_child_parent", "consent_guest"];
/** The `does` line the server picked for this reader: find which copy field it came from, then translate that field. */
export function settingDoes(def: Def, english: string | undefined): string | undefined {
  if (!english) return english;
  for (const field of COPY_FIELDS) if (def.copy?.[field] === english) return settingText(def.key, field, english);
  return english === def.label ? settingLabel(def) : english;
}

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const REASON_MATCHERS = SETTING_REASONS.map((reason) => ({ reason, re: new RegExp(`^${escapeRe(reason.en).replace("\\{admin\\}", "(?<admin>.+?)").replace("\\{person\\}", "(?<person>.+?)")}$`) }));
/** A reason line arrives with names already filled in ("Turned off by Dad."): match it to its template and translate that. */
export function settingReason(english: string | undefined): string | undefined {
  if (!english) return english;
  for (const { reason, re } of REASON_MATCHERS) {
    const found = re.exec(english);
    if (found) return reason.t({ admin: found.groups?.admin, person: found.groups?.person });
  }
  return english;
}

/** The "On" and "Off" state line; any other value (a number, a name) is shown as it is. */
export function settingState(english: string | undefined): string | undefined {
  if (english === "On") return i18n._({ id: "On", message: "On" });
  if (english === "Off") return i18n._({ id: "Off", message: "Off" });
  return english;
}

/** A settings area, group, section, tab or card name from the spec. */
export const areaText = (english: string): string => AREA_COPY[english]?.() ?? english;

/** A language named in its own language (Español, English (United Kingdom)), so a person finds theirs whatever language is on screen. */
export const languageName = (tag: string): string => formatLanguageName(tag);

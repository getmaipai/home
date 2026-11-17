import { i18n } from "@lingui/core";
import type { PersonAccess } from "@/lib/api";

/** The kinds of content a level is set for, in the order the Settings page lists them. */
export const ACCESS_KINDS = ["chat", "web", "news", "library", "made"] as const;
export const accessKindName = (kind: string): string => ({
  chat: i18n._({ id: "Chat", message: "Chat" }),
  web: i18n._({ id: "Web search", message: "Web search" }),
  news: i18n._({ id: "News", message: "News" }),
  library: i18n._({ id: "Library", message: "Library" }),
  made: i18n._({ id: "Things made", message: "Things made" }),
} as Record<string, string>)[kind] ?? kind;

/** UNSEEN-01 (C10): where a level came from. `ceiling` and `ceiling.web` are overrides on the person's own row or the household's; no entry is the role's default. */
export function accessSource(access: PersonAccess, kind: string): string {
  const own = access.overrides.find((entry) => entry.key === `ceiling.${kind}`) ?? access.overrides.find((entry) => entry.key === "ceiling");
  if (!own) return i18n._({ id: "Role default", message: "Role default" });
  return own.scope === "person" ? i18n._({ id: "Set for this person", message: "Set for this person" }) : i18n._({ id: "Set for the household", message: "Set for the household" });
}

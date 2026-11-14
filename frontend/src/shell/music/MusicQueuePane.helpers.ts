import { i18n } from "@lingui/core";
// SF-08c: the Queue pane's words and clock phrases, apart from the component so a test can run them without the kit.

export const say = (id: string, values?: Record<string, string | number>) => i18n._({ id, message: id, ...(values ? { values } : {}) });

/** The words after "played": minutes, hours or days ago, from the hub's timestamp. */
export function playedAgo(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (!Number.isFinite(minutes)) return "";
  if (minutes < 1) return say("Played just now");
  if (minutes < 60) return say("Played {count} min ago", { count: minutes });
  if (minutes < 1440) return say("Played {count} h ago", { count: Math.round(minutes / 60) });
  return say("Played {count} d ago", { count: Math.round(minutes / 1440) });
}

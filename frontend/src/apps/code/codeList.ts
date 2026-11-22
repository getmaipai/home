// CODE-UX-01: how the sessions column orders and marks its rows. Pure, so the order and the unread rule are tested without a page. Chat's day groups come
// from the kit (`dateGroupLabel`, the same buckets the chat column draws); pinned rows lead, archived ones stay behind a toggle.
import { i18n } from "@lingui/core";
import { dateGroupLabel, startOfLocalDay } from "@maipai/ui/src/elements/thread-list.aui";
import type { CodeSession } from "./codeApi";

export type RowMarker = "needs_you" | "working" | "failed" | "unread" | null;

/** What a row says beside its title. "Needs you" and a working or failed turn follow the session's state; "unread" is the hub's own flag (it settled after the
 *  owner last opened it) and never shows on the session that is open right now, because the owner is looking at it. */
export function rowMarker(session: Pick<CodeSession, "id" | "state" | "unread">, currentId: string | undefined): RowMarker {
  if (session.state === "needs_you") return "needs_you";
  if (session.state === "working" || session.state === "starting" || session.state === "queued") return "working";
  if (session.state === "failed") return "failed";
  return session.unread === true && session.id !== currentId ? "unread" : null;
}

/** The open session, when the hub says it is unread: the page tells the hub it was seen so the dot never lights for a session in view. */
export const needsSeenMark = (session: Pick<CodeSession, "id" | "unread"> | undefined, currentId: string | undefined): boolean => Boolean(session && session.id === currentId && session.unread === true);

export interface SessionGroup { id: string; label: string; rows: CodeSession[] }
export interface Arranged { groups: SessionGroup[]; archivedCount: number; shown: CodeSession[] }

/** Pinned first (newest pin first), then Today, Yesterday and Earlier by last activity; archived rows appear last, in their own group, only when `showArchived`.
 *  A search matches title and repository over whatever is visible. `shown` is every row in drawn order (Enter in the search opens the first). */
export function arrangeSessions(sessions: readonly CodeSession[], { query = "", showArchived = false, now = new Date() }: { query?: string; showArchived?: boolean; now?: Date } = {}): Arranged {
  const q = query.trim().toLowerCase();
  const matches = (s: CodeSession) => !q || `${s.title} ${s.repo.full_name ?? ""}`.toLowerCase().includes(q);
  const live = sessions.filter((s) => !s.archived_at);
  const archived = sessions.filter((s) => s.archived_at);
  const groups: SessionGroup[] = [];
  const byActivity = (a: CodeSession, b: CodeSession) => Date.parse(b.last_activity_at) - Date.parse(a.last_activity_at);
  const pinned = live.filter((s) => s.pinned_at && matches(s)).sort((a, b) => Date.parse(b.pinned_at!) - Date.parse(a.pinned_at!));
  if (pinned.length) groups.push({ id: "pinned", label: i18n._({ id: "Pinned", message: "Pinned" }), rows: pinned });
  const start = startOfLocalDay(now);
  for (const s of live.filter((s) => !s.pinned_at && matches(s)).sort(byActivity)) {
    const label = dateGroupLabel(new Date(s.last_activity_at), start);
    const last = groups[groups.length - 1];
    if (last && last.id !== "pinned" && last.label === label) last.rows.push(s); else groups.push({ id: label, label, rows: [s] });
  }
  const shownArchived = showArchived ? archived.filter(matches).sort(byActivity) : [];
  if (shownArchived.length) groups.push({ id: "archived", label: i18n._({ id: "Archived", message: "Archived" }), rows: shownArchived });
  return { groups, archivedCount: archived.length, shown: groups.flatMap((g) => g.rows) };
}

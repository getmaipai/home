// CODE-APP-01: the sessions list, newest activity first, with state, repository and +N -M (the kit section sidebar's rows).
import { i18n } from "@lingui/core";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { SectionSidebar, SectionSidebarDrawerSections, type SectionSidebarItem } from "@maipai/ui/src/primitives/SectionSidebar";
import { codeApi, type CodeSession } from "./codeApi";
import { groupSessions } from "./codeTranscript";
import { chatColumnShortcutLabel, type useChatColumn } from "@/shell/pages/ChatColumn";
import { CODE_SESSIONS_KEY } from "./NewSession";
import { pollDelay } from "./codeShared";
import { stateWord } from "./codeTranscript";

export const sessionMeta = (s: CodeSession): string => [stateWord(s.state), s.repo.full_name, s.changes.files > 0 ? i18n._({ id: "+{additions} -{deletions}", message: "+{additions} -{deletions}", values: { additions: s.changes.additions, deletions: s.changes.deletions } }) : null].filter(Boolean).join(" · ");

export function useCodeSessions() {
  // 5 s in view, a minute when the tab is hidden, doubling after each failure (CODE-UI-03).
  return useQuery({ queryKey: CODE_SESSIONS_KEY, queryFn: codeApi.list, refetchInterval: (q) => pollDelay({ hidden: typeof document !== "undefined" && document.hidden, failures: q.state.fetchFailureCount + q.state.errorUpdateCount }), refetchIntervalInBackground: true, retry: false });
}

/** A small status dot: moving work in the progress ink, a held turn in the attention ink, a failure in the problem ink; a quiet session has none. */
function dotFor(state: CodeSession["state"]) {
  const ink = state === "working" || state === "starting" || state === "queued" ? "var(--status-progress-ink)" : state === "needs_you" ? "var(--status-attention-ink)" : state === "failed" ? "var(--tint-problem-border)" : null;
  return ink ? <span aria-label={stateWord(state)} role="img" className={`size-2 rounded-full ${state === "working" || state === "starting" ? "animate-pulse motion-reduce:animate-none" : ""}`} style={{ background: ink }} /> : undefined;
}

/** The rows as kit sidebar items; also what a phone draws as its list page. */
export function sessionItems(sessions: readonly CodeSession[], currentId: string | undefined, navigate: (to: string) => void): SectionSidebarItem[] {
  return sessions.map((s) => ({
    id: s.id, label: s.title, icon: s.state === "needs_you" ? "circle-alert" : "terminal", href: `/apps/code/${s.id}`, active: s.id === currentId,
    trailing: dotFor(s.state),
    onClick: (event) => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey) { event.preventDefault(); navigate(`/apps/code/${s.id}`); } },
  }));
}

/** CODE-UI-01: the sessions column is Chat's column (same SectionSidebar props, same search, the same Cmd/Ctrl+B shortcut and the same remembered open or
 *  hidden choice through `useChatColumn`); only the rows differ, because they come from sessions, not chat threads. */
export function CodeSidebar({ sessions, currentId, column, mobile = false }: { sessions: readonly CodeSession[]; currentId: string | undefined; column: ReturnType<typeof useChatColumn>; mobile?: boolean }) {
  const navigate = useNavigate();
  const query = column.search.trim().toLowerCase();
  const shown = query ? sessions.filter((s) => `${s.title} ${s.repo.full_name}`.toLowerCase().includes(query)) : sessions;
  const { today, previous } = groupSessions(shown);
  const open = (id: string) => { navigate(`/apps/code/${id}`); column.setSearch(""); if (mobile) column.setSheetOpen(false); };
  const go = (to: string) => { navigate(to); if (mobile) column.setSheetOpen(false); };
  const groups = [
    ...(today.length ? [{ id: "today", label: i18n._({ id: "Today", message: "Today" }), items: sessionItems(today, currentId, go) }] : []),
    ...(previous.length ? [{ id: "previous", label: i18n._({ id: "Previous", message: "Previous" }), items: sessionItems(previous, currentId, go) }] : []),
  ];
  // A phone has no standalone column: the kit hides it below lg, so the sheet draws the kit's own drawer rows (the same groups, 48 px tall) with New session first.
  if (mobile) return <div data-slot="code-rail" data-chat-column-mobile="" role="region" aria-label={i18n._({ id: "Sessions", message: "Sessions" })} id="code-sessions-sheet" className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3 pt-12">
    <SectionSidebarDrawerSections groups={[{ id: "new", items: [{ id: "new-session", label: i18n._({ id: "New session", message: "New session" }), icon: "plus", href: "/apps/code", onClick: (event) => { event.preventDefault(); go("/apps/code"); } }] }, ...groups]} />
    {groups.length === 0 ? <p data-slot="code-column-empty" className="px-3 py-2 text-body text-muted-foreground">{i18n._({ id: "Your sessions will show up here. Start one with New session.", message: "Your sessions will show up here. Start one with New session." })}</p> : null}
  </div>;
  return <SectionSidebar standalone density="compact" title={i18n._({ id: "Code", message: "Code" })}
    collapsed={column.collapsed}
    onCollapsedChange={column.setCollapsedPreference}
    collapseLabels={{ hide: i18n._({ id: "Hide sessions", message: "Hide sessions" }), show: i18n._({ id: "Show sessions", message: "Show sessions" }), pin: i18n._({ id: "Keep sessions open", message: "Keep sessions open" }) }}
    collapsedStyle="hidden"
    search={sessions.length > 0 ? { value: column.search, onChange: column.setSearch, onSubmit: () => { if (query && shown[0]) open(shown[0].id); }, label: i18n._({ id: "Search sessions", message: "Search sessions" }) } : undefined}
    collapseShortcut={{ label: chatColumnShortcutLabel(), keys: "Meta+B Control+B" }}
    sidebarProps={{ "data-slot": "code-rail", "aria-label": i18n._({ id: "Sessions", message: "Sessions" }), role: "region", "data-touch-target-exempt": "" }}
    primaryAction={{ label: i18n._({ id: "New session", message: "New session" }), href: "/apps/code", onClick: (event) => { event.preventDefault(); go("/apps/code"); } }}
    afterSearch={groups.length === 0 ? <p data-slot="code-column-empty" className="px-2.5 py-2 text-body text-muted-foreground">{sessions.length === 0 ? i18n._({ id: "Your sessions will show up here. Start one with New session.", message: "Your sessions will show up here. Start one with New session." }) : i18n._({ id: "No session matches that. Clear the search to see them all.", message: "No session matches that. Clear the search to see them all." })}</p> : undefined}
    groups={groups} />;
}

// CODE-APP-01: the sessions list, newest activity first, with state, repository and +N -M (the kit section sidebar's rows).
import { i18n } from "@lingui/core";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { SectionSidebar, SectionSidebarDrawerSections } from "@maipai/ui/src/primitives/SectionSidebar";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { codeApi, type CodeSession } from "./codeApi";
import { arrangeSessions } from "./codeList";
import { SessionRow } from "./SessionRow";
import { useSessionActions } from "./sessionActions";
import { chatColumnShortcutLabel, type useChatColumn } from "@/shell/pages/ChatColumn";
import { CODE_SESSIONS_KEY } from "./NewSession";
import { pollDelay } from "./codeShared";
import { stateWord } from "./codeTranscript";

export const sessionMeta = (s: CodeSession): string => [stateWord(s.state), s.repo.full_name, s.changes.files > 0 ? i18n._({ id: "+{additions} -{deletions}", message: "+{additions} -{deletions}", values: { additions: s.changes.additions, deletions: s.changes.deletions } }) : null].filter(Boolean).join(" · ");

export function useCodeSessions() {
  // 5 s in view, a minute when the tab is hidden, doubling after each failure (CODE-UI-03).
  return useQuery({ queryKey: CODE_SESSIONS_KEY, queryFn: codeApi.list, refetchInterval: (q) => pollDelay({ hidden: typeof document !== "undefined" && document.hidden, failures: q.state.fetchFailureCount + q.state.errorUpdateCount }), refetchIntervalInBackground: true, retry: false });
}

/** CODE-UI-01: the sessions column is Chat's column (same SectionSidebar props, same search, the same Cmd/Ctrl+B shortcut and the same remembered open or
 *  hidden choice through `useChatColumn`); only the rows differ, because they come from sessions, not chat threads. */
export function CodeSidebar({ sessions, currentId, column, mobile = false }: { sessions: readonly CodeSession[]; currentId: string | undefined; column: ReturnType<typeof useChatColumn>; mobile?: boolean }) {
  const navigate = useNavigate();
  const actions = useSessionActions(currentId);
  const [showArchived, setShowArchived] = useState(false);
  const query = column.search.trim();
  const { groups, archivedCount, shown } = arrangeSessions(sessions, { query, showArchived });
  const open = (id: string) => { navigate(`/apps/code/${id}`); column.setSearch(""); if (mobile) column.setSheetOpen(false); };
  const go = (to: string) => { navigate(to); if (mobile) column.setSheetOpen(false); };
  const empty = sessions.length === 0
    ? i18n._({ id: "Your sessions will show up here. Start one with New session.", message: "Your sessions will show up here. Start one with New session." })
    : shown.length === 0 ? (query ? i18n._({ id: "No session matches that. Clear the search to see them all.", message: "No session matches that. Clear the search to see them all." }) : i18n._({ id: "Every session is archived. Show archived sessions to see them.", message: "Every session is archived. Show archived sessions to see them." })) : null;
  // One list for the wide column and the phone sheet: pinned first, then the day groups, archived behind a toggle. A phone row is 48 px tall and shows its menu button always.
  const list = <div data-slot="code-session-list" className="flex flex-col">
    {groups.map((group) => <div key={group.id} data-slot="code-session-group" data-group={group.id} role="group" aria-label={group.label} className="flex flex-col">
      <div data-slot="code-session-group-label" className={mobile ? "px-3 py-1 text-supporting text-settings-helper" : "px-2 pb-1 pt-4 text-supporting font-medium text-muted-foreground first:pt-2"}>{group.label}</div>
      {group.rows.map((row) => <SessionRow key={row.id} session={row} currentId={currentId} actions={actions} onOpen={open} mobile={mobile} />)}
    </div>)}
    {empty ? <p data-slot="code-column-empty" className={mobile ? "px-3 py-2 text-body text-muted-foreground" : "px-2.5 py-2 text-body text-muted-foreground"}>{empty}</p> : null}
    {archivedCount > 0 ? <Button type="button" variant="ghost" data-slot="code-archived-toggle" aria-pressed={showArchived} onClick={() => setShowArchived((on) => !on)}>
      {showArchived ? i18n._({ id: "Hide archived", message: "Hide archived" }) : i18n._({ id: "Show archived ({count})", message: "Show archived ({count})", values: { count: archivedCount } })}
    </Button> : null}
  </div>;
  // A phone has no standalone column: the kit hides it below lg, so the sheet draws New session as the kit's drawer row and the same list under it.
  if (mobile) return <div data-slot="code-rail" data-chat-column-mobile="" role="region" aria-label={i18n._({ id: "Sessions", message: "Sessions" })} id="code-sessions-sheet" className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3 pt-12">
    <SectionSidebarDrawerSections groups={[{ id: "new", items: [{ id: "new-session", label: i18n._({ id: "New session", message: "New session" }), icon: "plus", href: "/apps/code", onClick: (event) => { event.preventDefault(); go("/apps/code"); } }] }]} />
    {sessions.length > 0 ? <Input type="search" data-slot="code-sheet-search" value={column.search} onChange={(event) => column.setSearch(event.target.value)} aria-label={i18n._({ id: "Search sessions", message: "Search sessions" })} placeholder={i18n._({ id: "Search sessions", message: "Search sessions" })} /> : null}
    {list}
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
    body={list} />;
}

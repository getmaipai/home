// CODE-APP-01: the Code app at /apps/code. The shell's rail entry comes from the bundled `code` package (hidden by the hub when Coding is off, paused or
// not allowed for the person); the page is drawn here because a live transcript, a composer and a right pane are not schema nodes. A wide screen has the
// sessions column beside the page; a phone shows the list as its own page and the session as another, with a back arrow in the header.
import { i18n } from "@lingui/core";
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useBreakpoint } from "@maipai/ui/src/hooks/useBreakpoint";
import { List } from "@maipai/ui/src/primitives/List";
import { EmptyState } from "@maipai/ui/src/primitives/EmptyState";
import { ApiError, type Roster } from "@/lib/api";
import { errorLine } from "@/lib/hubReachability";
import { NewSession } from "./NewSession";
import { CodeSidebar, sessionMeta, useCodeSessions } from "./SessionList";
import { SessionView } from "./SessionView";
import { useChatColumn } from "@/shell/pages/ChatColumn";
import { registerSidebarToggleShortcut } from "@/shell/pages/chatShortcuts";

/** The session id in /apps/code/<id>, or undefined on the index. */
export const sessionIdOf = (pathname: string): string | undefined => /^\/apps\/code\/(csess-[a-z0-9]+)\/?$/.exec(pathname)?.[1];

export function CodePage({ person: _person }: { person: Roster }) {
  const location = useLocation();
  const navigate = useNavigate();
  const breakpoint = useBreakpoint();
  const phone = breakpoint.width < 1024;
  const column = useChatColumn({ isDesktop: !phone, railSlot: "code-rail" });
  // Cmd/Ctrl+B hides and shows the column, the one binding Chat and Settings use.
  useEffect(() => registerSidebarToggleShortcut(column.control.toggle), [column.control]);
  const id = sessionIdOf(location.pathname);
  const sessions = useCodeSessions();
  if (sessions.isError) {
    const refused = sessions.error instanceof ApiError && sessions.error.status === 403;
    return <EmptyState icon="terminal" text={refused ? (sessions.error as Error).message : errorLine(sessions.error, i18n._({ id: "Could not load your sessions. Try again.", message: "Could not load your sessions. Try again." }))} />;
  }
  const rows = sessions.data ?? [];
  if (phone) {
    if (id) return <div className="flex min-h-0 flex-1 flex-col" data-workspace-fill=""><SessionView id={id} /></div>;
    return <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-workspace-fill="" data-slot="code-sessions-page">
      <div className="flex min-h-[28rem] flex-1 flex-col" data-slot="code-new-session"><NewSession /></div>
      {rows.length > 0 ? <List label={i18n._({ id: "Sessions", message: "Sessions" })} items={rows} getKey={(s) => s.id} onSelect={(s) => navigate(`/apps/code/${s.id}`)} getLabel={(s) => s.title}
        renderItem={(s) => <span className="flex min-w-0 flex-col"><span className="truncate text-body font-medium">{s.title}</span><span className="truncate text-body text-muted-foreground">{sessionMeta(s)}</span></span>} /> : null}
    </div>;
  }
  return <div className="flex min-h-0 min-w-0 flex-1" data-workspace-fill="" data-slot="code-frame">
    <CodeSidebar sessions={rows} currentId={id} column={column} />
    {id ? <SessionView key={id} id={id} /> : <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-slot="code-new-session"><NewSession /></div>}
  </div>;
}


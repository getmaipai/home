// CODE-APP-01: the Code app at /apps/code. The shell's rail entry comes from the bundled `code` package (hidden by the hub when Coding is off, paused or
// not allowed for the person); the page is drawn here because a live transcript, a composer and a right pane are not schema nodes. A wide screen has the
// sessions column beside the page; a phone has the same column in Chat's left sheet (CODE-UI-03), opened from the header's menu button on the new session
// page and inside a session. Code draws no phone list of its own.
import { i18n } from "@lingui/core";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { useBreakpoint } from "@maipai/ui/src/hooks/useBreakpoint";
import { ChatHeader } from "@maipai/ui/src/elements/chat-header";
import { ErrorState } from "@maipai/ui/src/elements/error-state";
import { EmptyState } from "@maipai/ui/src/primitives/EmptyState";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@maipai/ui/src/ui/sheet";
import { getIcon } from "@maipai/ui/src/icons";
import { ApiError } from "@/lib/api";
import { codeApi, type CodeSession } from "./codeApi";
import { needsSeenMark } from "./codeList";
import { CODE_SESSIONS_KEY, NewSession } from "./NewSession";
import { CodeSidebar, useCodeSessions } from "./SessionList";
import { SessionView } from "./SessionView";
import { codeErrorLine } from "./codeShared";
import { chatColumnSheetContent, useChatColumn } from "@/shell/pages/ChatColumn";
import { registerSidebarToggleShortcut } from "@/shell/pages/chatShortcuts";

const TerminalIcon = getIcon("terminal");

/** The session id in /apps/code/<id>, or undefined on the index. */
export const sessionIdOf = (pathname: string): string | undefined => /^\/apps\/code\/(csess-[a-z0-9]+)\/?$/.exec(pathname)?.[1];

export function CodePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const breakpoint = useBreakpoint();
  const phone = breakpoint.width < 1024;
  const column = useChatColumn({ isDesktop: !phone, railSlot: "code-rail" });
  // Cmd/Ctrl+B hides and shows the column (or opens the phone sheet): the one binding Chat and Settings use. The composer's shortcut reference does not
  // register it again here, so it never toggles twice.
  useEffect(() => registerSidebarToggleShortcut(column.control.toggle), [column.control]);
  const id = sessionIdOf(location.pathname);
  const sessions = useCodeSessions();
  const rows = sessions.data ?? [];
  // CODE-UX-01: a session in view is seen. When the hub says the open session is unread (it settled while you looked), tell it so the dot never stays lit for it.
  const queryClient = useQueryClient();
  const current = rows.find((row) => row.id === id);
  const unseen = needsSeenMark(current, id);
  useEffect(() => {
    if (!unseen || !id) return;
    void codeApi.opened(id).then((next) => queryClient.setQueryData<CodeSession[]>(CODE_SESSIONS_KEY, (list) => list?.map((row) => (row.id === next.id ? { ...row, ...next } : row)))).catch(() => undefined);
  }, [unseen, id, current?.last_activity_at, queryClient]);
  const failed = sessions.isError;
  const refused = failed && sessions.error instanceof ApiError && sessions.error.status === 403;
  const line = failed ? codeErrorLine(sessions.error, i18n._({ id: "Could not load your sessions. Try again.", message: "Could not load your sessions. Try again." })) : "";
  const openSessions = () => column.setSheetOpen(true);
  const page = id
    ? <SessionView key={id} id={id} {...(phone ? { onOpenSessions: openSessions } : {})} />
    : <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-slot="code-new-session">
      {phone ? <ChatHeader name={i18n._({ id: "New session", message: "New session" })} media={<TerminalIcon aria-hidden className="size-6" />} onMenu={openSessions} menuExpanded={column.sheetOpen} menuControls="code-sessions-sheet" /> : null}
      <NewSession />
    </div>;
  const body = refused
    ? <EmptyState icon="terminal" text={line} actionLabel={i18n._({ id: "Open Chat", message: "Open Chat" })} onAction={() => navigate("/chat")} />
    : failed ? <ErrorState title={line} retrying={sessions.isFetching} onRetry={() => void sessions.refetch()} /> : page;
  return <>
    <div className="flex min-h-0 min-w-0 flex-1" data-workspace-fill="" data-slot="code-frame">
      {phone ? null : <CodeSidebar sessions={rows} currentId={id} column={column} />}
      {body}
    </div>
    {phone ? <Sheet open={column.sheetOpen} onOpenChange={column.setSheetOpen}>
      <SheetContent {...chatColumnSheetContent}>
        <SheetHeader className="sr-only">
          <SheetTitle>{i18n._({ id: "Sessions", message: "Sessions" })}</SheetTitle>
          <SheetDescription>{i18n._({ id: "Your coding sessions", message: "Your coding sessions" })}</SheetDescription>
        </SheetHeader>
        <CodeSidebar sessions={rows} currentId={id} column={column} mobile />
      </SheetContent>
    </Sheet> : null}
  </>;
}

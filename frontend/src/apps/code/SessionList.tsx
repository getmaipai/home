// CODE-APP-01: the sessions list, newest activity first, with state, repository and +N -M (the kit section sidebar's rows).
import { i18n } from "@lingui/core";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { SectionSidebar, type SectionSidebarItem } from "@maipai/ui/src/primitives/SectionSidebar";
import { codeApi, type CodeSession } from "./codeApi";
import { CODE_SESSIONS_KEY } from "./NewSession";
import { stateWord } from "./codeTranscript";

export const sessionMeta = (s: CodeSession): string => [stateWord(s.state), s.repo.full_name, s.changes.files > 0 ? `+${s.changes.additions} -${s.changes.deletions}` : null].filter(Boolean).join(" · ");

export function useCodeSessions() {
  return useQuery({ queryKey: CODE_SESSIONS_KEY, queryFn: codeApi.list, refetchInterval: 5000, retry: false });
}

/** The rows as kit sidebar items; also what a phone draws as its list page. */
export function sessionItems(sessions: readonly CodeSession[], currentId: string | undefined, navigate: (to: string) => void): SectionSidebarItem[] {
  return sessions.map((s) => ({
    id: s.id, label: s.title, icon: s.state === "needs_you" ? "circle-alert" : "terminal", href: `/apps/code/${s.id}`, active: s.id === currentId,
    trailing: s.state === "idle" || s.state === "done" || s.state === "archived" ? undefined : <span className="truncate text-body text-muted-foreground">{stateWord(s.state)}</span>,
    onClick: (event) => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey) { event.preventDefault(); navigate(`/apps/code/${s.id}`); } },
  }));
}

export function CodeSidebar({ sessions, currentId }: { sessions: readonly CodeSession[]; currentId: string | undefined }) {
  const navigate = useNavigate();
  return <SectionSidebar standalone density="compact" title={i18n._({ id: "Code", message: "Code" })}
    primaryAction={{ label: i18n._({ id: "New session", message: "New session" }), href: "/apps/code", onClick: (event) => { event.preventDefault(); navigate("/apps/code"); } }}
    groups={[{ id: "sessions", items: sessionItems(sessions, currentId, navigate) }]} />;
}

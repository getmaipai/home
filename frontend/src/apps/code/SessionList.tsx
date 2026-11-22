// CODE-APP-01: the sessions list, newest activity first, with state, repository and +N -M (the kit section sidebar's rows).
import { i18n } from "@lingui/core";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { SectionSidebar, type SectionSidebarItem } from "@maipai/ui/src/primitives/SectionSidebar";
import { codeApi, type CodeSession } from "./codeApi";
import { groupSessions } from "./codeTranscript";
import { CODE_SESSIONS_KEY } from "./NewSession";
import { stateWord } from "./codeTranscript";

export const sessionMeta = (s: CodeSession): string => [stateWord(s.state), s.repo.full_name, s.changes.files > 0 ? `+${s.changes.additions} -${s.changes.deletions}` : null].filter(Boolean).join(" · ");

export function useCodeSessions() {
  return useQuery({ queryKey: CODE_SESSIONS_KEY, queryFn: codeApi.list, refetchInterval: 5000, retry: false });
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

export function CodeSidebar({ sessions, currentId }: { sessions: readonly CodeSession[]; currentId: string | undefined }) {
  const navigate = useNavigate();
  const { today, previous } = groupSessions(sessions);
  return <SectionSidebar standalone density="compact" title={i18n._({ id: "Code", message: "Code" })}
    primaryAction={{ label: i18n._({ id: "New session", message: "New session" }), href: "/apps/code", onClick: (event) => { event.preventDefault(); navigate("/apps/code"); } }}
    groups={[
      ...(today.length ? [{ id: "today", label: i18n._({ id: "Today", message: "Today" }), items: sessionItems(today, currentId, navigate) }] : []),
      ...(previous.length ? [{ id: "previous", label: i18n._({ id: "Previous", message: "Previous" }), items: sessionItems(previous, currentId, navigate) }] : []),
    ]} />;
}

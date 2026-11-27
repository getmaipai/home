// STACK-MENU-SYNC-01: the one "Stack is down" card every tab of Settings, Stack shows instead of a stale page when the Stack does not answer.
// It reads the same `/api/ai/stack/general` answer as the General tab (one query key, so the tabs share one read and Home keeps no copy). The words
// say what is wrong (the Stack's own sentence when it gave one) and the one next step: start the Stack, then Check now.
import { i18n } from "@lingui/core";
import { type ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import { StatusCard } from "@maipai/ui/src/elements/status-card";
import { requestJson } from "@/lib/api";
import { errorLine } from "@/lib/hubReachability";
import type { SettingsViewProps } from "@/shell/pages/settings/settingsViews";

export interface StackGeneralView {
  where: "this_computer" | "another_computer";
  reachable: boolean;
  version: string | null;
  problems: number | null;
  reason: string | null;
}

export const STACK_GENERAL_KEY = ["ai-stack-general"] as const;
export const readStackGeneral = () => requestJson<StackGeneralView>("/api/ai/stack/general");

/** The words and the one step of the down card, as props for the kit StatusCard (rendered directly where used, rule 9): what is wrong, then Check now. */
export function stackDownProps({ reason, error, onCheck }: { reason: string | null; error?: unknown; onCheck: () => void }) {
  const fallback = i18n._({ id: "Start the Stack on its computer, then check again.", message: "Start the Stack on its computer, then check again." });
  return {
    kind: "problem" as const,
    textStyle: "status" as const,
    title: i18n._({ id: "The Stack is not answering", message: "The Stack is not answering" }),
    line: error ? errorLine(error, fallback) : (reason ?? fallback),
    action: { label: i18n._({ id: "Check now", message: "Check now" }), onSelect: onCheck },
  };
}

/** Wraps a Stack tab: while the Stack does not answer the tab shows the down card and nothing else; otherwise the tab as it is. Fails closed. */
export function withStackDown(View: ComponentType<SettingsViewProps>): ComponentType<SettingsViewProps> {
  function Guarded(props: SettingsViewProps) {
    const allowed = props.person.role === "owner" || props.person.role === "admin";
    const general = useQuery({ queryKey: STACK_GENERAL_KEY, queryFn: readStackGeneral, enabled: allowed, refetchInterval: 15_000 });
    if (!allowed) return <View {...props} />;
    if (general.isError || (general.data && !general.data.reachable)) {
      return <div className="flex min-w-0 flex-col gap-4" data-testid="stack-down"><StatusCard {...stackDownProps({ reason: general.data?.reason ?? null, error: general.error, onCheck: () => void general.refetch() })} /></div>;
    }
    if (!general.data) return null;
    return <View {...props} />;
  }
  Guarded.displayName = `StackDown(${View.displayName ?? View.name})`;
  return Guarded;
}

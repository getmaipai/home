import { useNavigate } from "react-router-dom";
import { i18n } from "@lingui/core";
import type { ActivityPopoverItem } from "@maipai/ui/src/elements/activity-popover";
import { useActivity, ACTIVITY_PATH } from "@/shell/activity";
import type { ActivityItemView } from "@/lib/api";

// The Activity bell in the header (STUDIO-LOOK-01, Artlist-style): the viewer's own making jobs with a thumbnail and live progress,
// drawn by the kit popover from the same list the Activity page reads. The rail's Activity entry stays.

const KIND = { picture: "picture", video: "video", song: "music", job: undefined } as const;

export function activityPopoverItems(rows: readonly ActivityItemView[]): ActivityPopoverItem[] {
  return rows.map((row): ActivityPopoverItem => ({
    id: row.id,
    state: row.state === "waiting" || row.state === "making" ? "running" : row.state === "failed" ? "failed" : "done",
    title: row.title,
    subtitle: row.line ?? undefined,
    step: row.line ?? undefined,
    kind: KIND[row.source],
    progress: row.percent ?? undefined,
    at: row.at,
    href: row.href ?? undefined,
  }));
}

/** The props for the kit ActivityPopover, rendered directly by the shell header (RULES.md rule 9: no wrapper component around a kit Element). */
export function useActivityPopoverProps(enabled: boolean) {
  const navigate = useNavigate();
  const activity = useActivity(enabled);
  const items = activityPopoverItems(activity.data?.items ?? []);
  return {
    items,
    onOpen: (id: string) => navigate(items.find((item) => item.id === id)?.href ?? ACTIVITY_PATH),
    emptyLabel: i18n._({ id: "Nothing is being made right now.", message: "Nothing is being made right now." }),
  };
}

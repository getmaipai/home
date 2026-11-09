import { i18n } from "@lingui/core";
import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ActivityDotState, type ActivityListView, type HomeJobView } from "@/lib/api";
import { useJobs } from "@/lib/useInstallStatus";

// ACTIVITY-PAGE-01 (PRO-LOOK-01 section 25; RULES.md S6, the Activity row): the Activity page's list and the dot on its entry. One read of
// `GET /api/activity` (the hub words every row and computes the dot), refreshed when the job list the progress strip already polls changes,
// so there is no second polling loop.

export const ACTIVITY_KEY = ["activity"] as const;
export const ACTIVITY_PATH = "/activity";

const MAKING_KINDS = new Set(["picture", "video", "song"]);

/** What changed in the viewer's own making rows: when this string changes, the Activity list is read again. */
export function makingSignature(rows: readonly HomeJobView[]): string {
  return rows.filter((row) => MAKING_KINDS.has(row.kind)).map((row) => `${row.id}:${row.state ?? ""}`).sort().join("|");
}
const signatureOf = (rows: HomeJobView[]): string => makingSignature(rows);

export function useActivity(enabled = true, readOwn?: () => Promise<ActivityListView>) {
  return useQuery<ActivityListView>({
    queryKey: readOwn ? [...ACTIVITY_KEY, "own-read"] : ACTIVITY_KEY,
    queryFn: async () => {
      const next = await (readOwn ?? api.activity)();
      // A reply that is not a list is a missed read, not an empty Activity.
      if (!next || !Array.isArray(next.items)) throw new Error("Activity was not a list.");
      return next;
    },
    enabled,
    retry: false,
    staleTime: 10_000,
    refetchInterval: 60_000,
  });
}

/** The dot state of the Activity entry. `enabled` is false for a guest, who has no entry. */
export function useActivityDot(enabled = true): ActivityDotState {
  const client = useQueryClient();
  const query = useActivity(enabled);
  const signature = useJobs({ enabled, fast: () => false, select: signatureOf }).data;
  const before = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (signature === undefined) return;
    if (before.current !== undefined && before.current !== signature) void client.invalidateQueries({ queryKey: ACTIVITY_KEY });
    before.current = signature;
  }, [signature, client]);
  return enabled ? query.data?.dot ?? "none" : "none";
}

/** The kit rail's status mark for the entry: needs a look is amber, finished and unopened is the done green, running is the brand color.
 * No number (section 25). Idle has no mark. */
export function activityItemStatus(dot: ActivityDotState): { title: string; ariaLabel: string; level: "online" | "maintenance" | "degraded" } | undefined {
  if (dot === "attention") return { level: "degraded", title: i18n._({ id: "Something needs a look.", message: "Something needs a look." }), ariaLabel: i18n._({ id: "needs a look", message: "needs a look" }) };
  if (dot === "finished") return { level: "online", title: i18n._({ id: "Something finished.", message: "Something finished." }), ariaLabel: i18n._({ id: "something finished", message: "something finished" }) };
  if (dot === "running") return { level: "maintenance", title: i18n._({ id: "Something is being made.", message: "Something is being made." }), ariaLabel: i18n._({ id: "something is being made", message: "something is being made" }) };
  return undefined;
}

import { useQuery } from "@tanstack/react-query";
import { api, isOwnerOrAdminRole, type HardwareInfo, type HealthStatus, type Issue, type Roster, type UpdateProjection } from "@/lib/api";

// The rail's hub card, the footer's status segment, and the dashboard's
// metric row all need the same four reads (spec "The shell, exactly"/
// "Fixed footer"/"The dashboard"): the machine's identity, its engine
// health, its open repairs, and the app's own update check. One hook,
// one cache entry each - RepairsSection.tsx's own ["repairs"] key,
// reused rather than a second fetch, so fixing or dismissing an issue
// there refreshes this too.
//
// GET /api/host/hardware and GET /api/repairs are both owner/admin only
// (backend/src/routes/host.ts, repairs.ts) - health and updates are open
// to every signed-in person. `enabled: canManage` keeps those two
// queries from ever firing (and 403ing, then never retrying -
// queryClient.ts's own `retry: false`) for anyone else; every consumer
// gets `canManage` back so it can render an honest "not available to
// you" state instead of treating `undefined` as "still loading" forever
// or, worse, as a real zero.
export function useHubStatus(role: Roster["role"]) {
  const canManage = isOwnerOrAdminRole(role);
  const hardware = useQuery<HardwareInfo>({ queryKey: ["hardware"], queryFn: () => api.hardware(), staleTime: 5 * 60 * 1000, enabled: canManage });
  const health = useQuery<HealthStatus>({ queryKey: ["health"], queryFn: () => api.health(), staleTime: 30 * 1000, refetchInterval: 30 * 1000 });
  const repairs = useQuery<Issue[]>({ queryKey: ["repairs"], queryFn: () => api.repairs(), enabled: canManage });
  const updates = useQuery<UpdateProjection>({ queryKey: ["updates"], queryFn: () => api.updates(), staleTime: 5 * 60 * 1000 });
  return { hardware: hardware.data, health: health.data, repairs: repairs.data, updates: updates.data, canManage };
}

export function updateAvailable(updates: Pick<UpdateProjection, "installed" | "latest"> | undefined): boolean {
  return !!updates?.latest && updates.latest !== updates.installed;
}

const PLATFORM_LABEL: Record<string, string> = { darwin: "macOS", linux: "Linux", win32: "Windows" };

export function platformLabel(platform: string): string {
  return PLATFORM_LABEL[platform] ?? platform;
}

export function engineCount(health: HealthStatus | undefined): { running: number; total: number } {
  if (!health) return { running: 0, total: 0 };
  const entries = Object.values(health.engines);
  return { running: entries.filter((entry) => entry.alive === true).length, total: entries.length };
}

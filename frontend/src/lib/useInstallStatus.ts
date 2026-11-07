// AUDIT-DUP-FE-01: the one adaptive poll behind the install strip and the install dock (and the model-download list): read again every 2 s while
// something is moving, every 15 s otherwise. It was `let disposed = false; poll(); setTimeout(poll, active ? 2000 : 15000)` written five times.
import { useQuery } from "@tanstack/react-query";
import { api, type HomeJobView, type InstallStatusView } from "@/lib/api";
import { INSTALL_STATUS_KEY, JOBS_KEY } from "@/lib/sharedReads";

export const FAST_POLL_MS = 2_000;
export const SLOW_POLL_MS = 15_000;

/** Something is installing or downloading now. `background` also counts a part installed later from Settings. */
export function installActive(status: InstallStatusView | null | undefined, background = false): boolean {
  if (!status) return false;
  return status.state === "downloading" || status.state === "starter_ready" || status.state === "installing_engine" || (background && status.background?.state === "running");
}

/** The install status. The default read shares the hub-wide key; a screen with its own read (setup before the owner exists) keeps its own cache entry. */
export function useInstallStatus(readOwn?: () => Promise<InstallStatusView>, background = false) {
  const read = readOwn ?? api.installStatus;
  return useQuery({
    queryKey: readOwn ? [...INSTALL_STATUS_KEY, "own-read"] : INSTALL_STATUS_KEY,
    queryFn: async () => {
      const next = await read();
      // A reply that is not a status object is a missed poll, not a status.
      if (!next || typeof next !== "object") throw new Error("Install status was not an object.");
      return next;
    },
    retry: false,
    refetchInterval: (query) => (installActive(query.state.data, background) ? FAST_POLL_MS : SLOW_POLL_MS),
  });
}

/** The job list as `select` shapes it, read fast while `fast` says a job is moving. `select` must be a stable function (module level or memoized). */
export function useJobs<T>({ read: readOwn, enabled = true, fast, select }: { read?: () => Promise<HomeJobView[]>; enabled?: boolean; fast: (rows: HomeJobView[] | undefined) => boolean; select: (rows: HomeJobView[]) => T }) {
  return useQuery({
    queryKey: readOwn ? [...JOBS_KEY, "own-read"] : JOBS_KEY,
    queryFn: async () => { const rows = await (readOwn ?? api.jobs)(); return Array.isArray(rows) ? rows : []; },
    enabled,
    retry: false,
    select,
    refetchInterval: (query) => (fast(query.state.data) ? FAST_POLL_MS : SLOW_POLL_MS),
  });
}

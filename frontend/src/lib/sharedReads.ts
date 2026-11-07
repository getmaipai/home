import { useContext, useMemo } from "react";
import { QueryClientContext } from "@tanstack/react-query";
import { api, type HomeJobView, type InstallStatusView, type InstalledPackage, type ResolvedSetting, type TourProgressRecord } from "@/lib/api";

// AUDIT-UI-01 (request storm): one query key and one freshness window per endpoint. A component that reads through a query shares the
// key; a hook that reads inside an effect (no query of its own) reads through `useSharedReads`, which calls the same query client, so
// both land on one request instead of each firing its own. The windows are set once, in `queryClient.ts` (`SHARED_STALE_MS`).

export const SETTINGS_VALUES_KEY = (scope: string) => ["settings-values", scope] as const;
export const INSTALL_STATUS_KEY = ["install-status"] as const;
export const JOBS_KEY = ["jobs"] as const;
export const PLUGINS_KEY = ["plugins"] as const;
export const TOURS_PROGRESS_KEY = ["tours-progress"] as const;

/** Freshness per endpoint family: a value read this recently is reused, not asked for again (ms). */
export const SHARED_STALE_MS = { settings: 5_000, health: 2_000, install: 2_000, jobs: 1_000, plugins: 5_000, tours: 5_000, companions: 5_000 } as const;

export interface SharedReads {
  settingsValues: (scope: string) => Promise<ResolvedSetting[]>;
  installStatus: () => Promise<InstallStatusView>;
  jobs: () => Promise<HomeJobView[]>;
  plugins: () => Promise<InstalledPackage[]>;
  toursProgress: () => Promise<TourProgressRecord[]>;
  /** A tour's progress was just saved: the next read asks the hub again. */
  toursProgressSaved: () => void;
}

/** The shared reads, through the app's query client; without one (a bare test render) each is the plain api call. */
export function useSharedReads(): SharedReads {
  const client = useContext(QueryClientContext);
  return useMemo((): SharedReads => client
    ? {
      settingsValues: (scope) => client.fetchQuery({ queryKey: SETTINGS_VALUES_KEY(scope), queryFn: () => api.settingsValues(scope), staleTime: SHARED_STALE_MS.settings }),
      installStatus: () => client.fetchQuery({ queryKey: INSTALL_STATUS_KEY, queryFn: () => api.installStatus(), staleTime: SHARED_STALE_MS.install }),
      jobs: () => client.fetchQuery({ queryKey: JOBS_KEY, queryFn: () => api.jobs(), staleTime: SHARED_STALE_MS.jobs }),
      plugins: () => client.fetchQuery({ queryKey: PLUGINS_KEY, queryFn: () => api.plugins(), staleTime: SHARED_STALE_MS.plugins }),
      toursProgress: () => client.fetchQuery({ queryKey: TOURS_PROGRESS_KEY, queryFn: () => api.tourProgress(), staleTime: SHARED_STALE_MS.tours }),
      toursProgressSaved: () => { void client.invalidateQueries({ queryKey: TOURS_PROGRESS_KEY }); },
    }
    : {
      settingsValues: (scope) => api.settingsValues(scope),
      installStatus: () => api.installStatus(),
      jobs: () => api.jobs(),
      plugins: () => api.plugins(),
      toursProgress: () => api.tourProgress(),
      toursProgressSaved: () => {},
    }, [client]);
}

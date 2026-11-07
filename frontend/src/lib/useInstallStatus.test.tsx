// AUDIT-DUP-FE-01: the shared adaptive poll. Fast (2 s) while something moves, slow (15 s) otherwise; a missed poll is not a status.
import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider, type Query } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { HomeJobView, InstallStatusView } from "@/lib/api";
import { FAST_POLL_MS, SLOW_POLL_MS, installActive, useInstallStatus, useJobs } from "@/lib/useInstallStatus";
import { useModelDownloadJobs } from "@/lib/modelDownloadProgress";

afterEach(cleanup);
const status = (over: Partial<InstallStatusView>): InstallStatusView => ({ state: "none", chatReady: false, complete: false, percent: 0, completedBytes: 0, totalBytes: 0, bytesPerSecond: 0, etaSeconds: null, problem: null, items: [], ...over });
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrap = (c: QueryClient) => ({ children }: { children: ReactNode }) => <QueryClientProvider client={c}>{children}</QueryClientProvider>;
/** The interval the observer on `key` asks for, given the data it holds now. */
const intervalOf = (c: QueryClient, key: readonly unknown[]) => {
  const query = c.getQueryCache().find({ queryKey: key })!;
  const option = query.observers[0]!.options.refetchInterval as (q: Query) => number | false;
  return option(query as unknown as Query);
};

describe("installActive", () => {
  test("downloading, a ready starter and an engine install are moving; a background part counts only when asked", () => {
    for (const state of ["downloading", "starter_ready", "installing_engine"] as const) expect(installActive(status({ state }))).toBe(true);
    expect(installActive(status({ state: "ready" }))).toBe(false);
    expect(installActive(status({ state: "none", background: { state: "running" } as never }))).toBe(false);
    expect(installActive(status({ state: "none", background: { state: "running" } as never }), true)).toBe(true);
    expect(installActive(null)).toBe(false);
  });
});

describe("useInstallStatus", () => {
  test("polls every 2 s while installing and every 15 s when idle", async () => {
    let now = status({ state: "downloading" });
    const c = client();
    const view = renderHook(() => useInstallStatus(async () => now), { wrapper: wrap(c) });
    await waitFor(() => expect(view.result.current.data?.state).toBe("downloading"));
    const key = c.getQueryCache().getAll()[0]!.queryKey;
    expect(intervalOf(c, key)).toBe(FAST_POLL_MS);
    now = status({ state: "ready" });
    await view.result.current.refetch();
    expect(intervalOf(c, key)).toBe(SLOW_POLL_MS);
  });

  test("a reply that is not an object is a missed poll, not a status", async () => {
    const view = renderHook(() => useInstallStatus((async () => "oops") as never), { wrapper: wrap(client()) });
    await waitFor(() => expect(view.result.current.isError).toBe(true));
    expect(view.result.current.data).toBeUndefined();
  });
});

describe("useJobs and useModelDownloadJobs", () => {
  const job = (id: string, kind: string, state: string): HomeJobView => ({ id, kind, state, title: id, createdAt: "", updatedAt: "", actions: [], progress: {} } as unknown as HomeJobView);
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  test("model downloads are the model_download jobs only, and they read fast while one is moving", async () => {
    globalThis.fetch = (async () => Response.json([job("a", "model_download", "running"), job("b", "image", "running")])) as unknown as typeof fetch;
    const c = client();
    const view = renderHook(() => useModelDownloadJobs(), { wrapper: wrap(c) });
    await waitFor(() => expect(view.result.current.map((row) => row.id)).toEqual(["a"]));
    expect(intervalOf(c, ["jobs"])).toBe(FAST_POLL_MS);
  });

  test("a disabled jobs read asks nobody and a non-list reply is an empty list", async () => {
    let calls = 0;
    const c = client();
    renderHook(() => useJobs({ read: async () => { calls += 1; return [] as HomeJobView[]; }, enabled: false, fast: () => false, select: (rows) => rows }), { wrapper: wrap(c) });
    expect(calls).toBe(0);
    const view = renderHook(() => useJobs({ read: async () => ({}) as unknown as HomeJobView[], fast: () => false, select: (rows) => rows }), { wrapper: wrap(client()) });
    await waitFor(() => expect(view.result.current.data).toEqual([]));
  });
});

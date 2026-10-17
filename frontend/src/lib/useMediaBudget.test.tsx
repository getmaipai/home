import { afterEach, expect, spyOn, test } from "bun:test";
import { createElement, type ReactNode } from "react";
import { cleanup, renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api, type MediaBudgetResponse } from "@/lib/api";
import { updateMediaBudget, useMediaBudget } from "./useMediaBudget";

const clients: QueryClient[] = [];
const restores: Array<() => void> = [];
afterEach(() => { cleanup(); clients.forEach((client) => client.clear()); clients.length = 0; restores.splice(0).forEach((restore) => restore()); });
const budget: MediaBudgetResponse = { limit_min: 10, used_min: 3, left_min: 7, exhausted: false };
function harness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  function wrapper({ children }: { children: ReactNode }) { return createElement(QueryClientProvider, { client }, children); }
  return { client, wrapper };
}

test("pauses while unknown, then reads the server budget and accepts progress updates", async () => {
  let resolve!: (value: MediaBudgetResponse) => void;
  const mock = spyOn(api, "mediaBudget").mockImplementation(() => new Promise((done) => { resolve = done; })); restores.push(() => mock.mockRestore());
  const { client, wrapper } = harness();
  const { result } = renderHook(() => useMediaBudget("sprout"), { wrapper });
  expect(result.current).toEqual({ exhausted: true, leftMinutes: 0 });
  await act(async () => { resolve(budget); });
  await waitFor(() => expect(result.current).toEqual({ exhausted: false, leftMinutes: 7 }));
  act(() => updateMediaBudget(client, "sprout", { ...budget, left_min: 0, exhausted: true }));
  await waitFor(() => expect(result.current.exhausted).toBe(true));
  act(() => updateMediaBudget(client, "sprout", { ...budget, left_min: 5 }));
  await waitFor(() => expect(result.current.leftMinutes).toBe(5));
});

test("a profile switch never uses the previous person's cached allowance", async () => {
  const mock = spyOn(api, "mediaBudget").mockResolvedValueOnce(budget).mockImplementation(() => new Promise(() => {})); restores.push(() => mock.mockRestore());
  const { wrapper } = harness();
  const { result, rerender } = renderHook(({ id }) => useMediaBudget(id), { wrapper, initialProps: { id: "atlas" } });
  await waitFor(() => expect(result.current.exhausted).toBe(false));
  rerender({ id: "sprout" });
  expect(result.current).toEqual({ exhausted: true, leftMinutes: 0 });
});

test("a failed budget read pauses; a zero limit stays unlimited", async () => {
  const mock = spyOn(api, "mediaBudget").mockRejectedValueOnce(new Error("Could not read media minutes. Try again.")).mockResolvedValueOnce({ limit_min: 0, used_min: 20, left_min: 0, exhausted: false }); restores.push(() => mock.mockRestore());
  const { wrapper } = harness();
  const first = renderHook(() => useMediaBudget("sprout"), { wrapper });
  await waitFor(() => expect(mock).toHaveBeenCalledTimes(1));
  expect(first.result.current).toEqual({ exhausted: true, leftMinutes: 0 });
  const second = renderHook(() => useMediaBudget("atlas"), { wrapper });
  await waitFor(() => expect(second.result.current).toEqual({ exhausted: false, leftMinutes: 0 }));
});

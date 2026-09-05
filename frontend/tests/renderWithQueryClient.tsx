import { render } from "@testing-library/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { createQueryClient } from "@/lib/queryClient";

/** A fresh `QueryClient` per render (docs/plans/session-b-ui.md step 3):
 * every test needs its own, so one test's cached data (or a `staleTime:
 * Infinity` query, like the settings registry) never bleeds into the
 * next. Six page test files each hand-rolled this exact wrapper before a
 * code review (2026-09-05) pointed out the duplication - one definition,
 * used from every one of them, so a future change to how tests provision
 * a client only has to happen once. Returns the `queryClient` alongside
 * the usual render queries for the rare test (NotificationBell's own)
 * that needs to poke the cache directly, e.g. to simulate a poll tick. */
export function renderWithQueryClient(
  ui: React.ReactElement,
): ReturnType<typeof render> & { queryClient: QueryClient } {
  const queryClient = createQueryClient();
  return { ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>), queryClient };
}

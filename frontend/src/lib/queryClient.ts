import { QueryClient } from "@tanstack/react-query";

/** One factory, not a bare `new QueryClient()` at every call site
 * (docs/plans/session-b-ui.md step 3): the hub is a local machine on the
 * household's own network, not a flaky public API, so TanStack Query's
 * default of three silent retries with exponential backoff before a
 * query ever reports `isError` just delays the retry UI `AsyncState`
 * already provides - a failure shows up once, immediately, with a real
 * "Try again" button, not several seconds of a silent spinner. Every
 * QueryClient in the app (the real one in App.tsx, a fresh one per test)
 * is built from this one function. */
export function createQueryClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  // NEWS-FAST-01: a News page the person has just seen (a front page, a category, a story) is drawn from memory on the way back and
  // refreshed behind it, so moving around the app never waits on the hub or shows a skeleton for what was on screen a moment ago.
  // A save or a follow still refreshes every page at once (the kit's action dispatch invalidates `schema-binding`).
  client.setQueryDefaults(["schema-binding", "package", "news"], { staleTime: 60_000, gcTime: 30 * 60_000 });
  // A story the hub could only summarise yet (its full text is still being fetched) is asked for again until the text lands, then kept.
  const summaryOnly = (data: unknown): boolean => (data as { blocks?: Array<{ props?: { content_source?: string } }> } | undefined)?.blocks?.[0]?.props?.content_source === "teaser";
  client.setQueryDefaults(["schema-binding", "package", "news", "story"], {
    staleTime: (query: { state: { data: unknown } }) => (summaryOnly(query.state.data) ? 0 : 60_000),
    refetchInterval: (query: { state: { data: unknown; dataUpdateCount: number } }) => (summaryOnly(query.state.data) && query.state.dataUpdateCount < 8 ? 1_500 : false),
  });
  return client;
}

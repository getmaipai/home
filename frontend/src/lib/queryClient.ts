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
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

/** GET /api/dashboard, through the same `@tanstack/react-query` layer
 * `/next`'s other hooks already use (`useNextAppearance.ts`) - the
 * vendored template's own view carries no SWR/global-fetcher of its own
 * to point anywhere (checked: nothing in `@maipai/ui/src/dashboard`
 * calls `useSWR`, and `swr`/`chance`/the mock API tree were stripped at
 * vendoring, so the modern-dashboard widgets never had a real data
 * layer even upstream). One query, the page's own widgets each read
 * `data`/`isLoading`/`isError` off this same hook rather than fetching
 * individually. */
export function useDashboard() {
  return useQuery({ queryKey: ["dashboard"], queryFn: api.dashboard });
}

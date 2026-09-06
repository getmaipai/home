import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { request } from "@/lib/api";
import type { Binding } from "@/kit/schema/types";

// `host` (a host.* RPC method, platform plan 4.9) has no page this
// session builds against it - People/Privacy/Settings stayed hand-
// written React (docs/dev.md's A2UI entry has the reasoning) and
// Memory's own real schema page only ever binds to `route`. Throwing
// here rather than silently no-oping: a page authored against `host`
// today would otherwise render an empty list with no signal that
// nothing was ever fetched.
export function useBinding<T>(binding: Binding): UseQueryResult<T> {
  if (binding.source === "host") {
    throw new Error(`kit/schema: binding.source "host" has no interpreter support yet (bound path: ${binding.path})`);
  }
  return useQuery<T>({
    queryKey: ["schema-binding", binding.path],
    queryFn: () => request<T>(binding.path),
  });
}

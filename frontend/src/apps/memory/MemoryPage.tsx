import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { SchemaPage } from "@/kit/schema/SchemaPage";
import { RowFilterContext } from "@/kit/schema/NodeRenderer";
import { api, type MemoryRecord } from "@/lib/api";
import memoryPage from "../../../../spec/ui/pages/memory.json";

// 4.4's real memory store (backend/src/lib/memory.ts: entity-first
// recall, decay, tiers) has had no way for a family to see what's
// actually remembered. Session B step 5 converts this to a real schema
// page (spec/ui/pages/memory.json, the interpreter in kit/schema/) - the
// first page this session's generic UiNode renderer actually executes
// at runtime, not just validates. docs/dev.md's A2UI entry records why
// People, Privacy and Settings stayed hand-written React instead.
//
// One real behavior change from the hand-rolled version this replaces:
// a memory's scope line no longer resolves a person id to their display
// name (that needed a second bound list - the people roster - joined
// against this one by id, which the interpreter has no join mechanism
// for; inventing one for a single page is exactly the kind of ahead-of-
// need primitive docs/plans/session-b-ui.md step 5 says not to build).
// The subtitle shows the raw scope value instead.
export function MemoryPage() {
  // Chat's "memory updated" chip (chatMemoryChip.tsx, step 4) deep-links
  // here with ?ids=<memory ids>: a client-side filter over the same list
  // the schema page's own binding already fetches (kit/schema/binding.ts's
  // shared `["schema-binding", path]` query key), not a second fetch.
  const [searchParams] = useSearchParams();
  const idsParam = searchParams.get("ids");
  const filterIds = idsParam ? new Set(idsParam.split(",")) : null;

  const memoriesQuery = useQuery<MemoryRecord[]>({
    queryKey: ["schema-binding", "/api/memory"],
    queryFn: () => api.memories(),
  });
  const visibleCount = filterIds
    ? (memoriesQuery.data?.filter((m) => filterIds.has(m.id)).length ?? 0)
    : undefined;

  return (
    <RowFilterContext.Provider value={filterIds ? (row) => filterIds.has(String(row.id)) : () => true}>
      <SchemaPage
        page={memoryPage}
        beforeBody={
          filterIds ? (
            <div className="flex items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
              <span>
                Showing {visibleCount ?? 0} memory update{visibleCount === 1 ? "" : "s"}
              </span>
              <Link to="/memory" className="text-primary underline">
                Show all
              </Link>
            </div>
          ) : null
        }
      />
    </RowFilterContext.Provider>
  );
}

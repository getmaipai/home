import { Skeleton } from "@/kit/ui/skeleton";

// Lane 10 item 2's real code-splitting: `App.tsx` wraps every lazy
// route in a `Suspense` boundary, and this is its fallback - the same
// `role="status"`/Skeleton-bars shape `AsyncState.tsx`'s own loading
// state already uses, so a chunk still downloading never shows a blank
// screen, just the kit's own familiar loading look.
export function RouteSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-4" role="status" aria-label="Loading">
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-3/4" />
    </div>
  );
}

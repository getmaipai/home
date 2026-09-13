import { Skeleton } from "@/kit/ui/skeleton";

// Lane 10 item 2's real code-splitting: `App.tsx` wraps every lazy
// route in a `Suspense` boundary, and this is its fallback, so a chunk
// still downloading never shows a blank screen. Also `AsyncState.tsx`'s
// own loading state (a data fetch, not a chunk load) - one definition
// of "three skeleton bars means loading" instead of two copies that can
// drift apart.
export function RouteSkeleton({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex flex-col gap-3 p-4" role="status" aria-label={label}>
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-3/4" />
    </div>
  );
}

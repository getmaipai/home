import type { ReactNode } from "react";
import { Skeleton } from "@/kit/ui/skeleton";
import { Button } from "@/kit/ui/button";
import { EmptyState } from "@/kit/primitives/EmptyState";

interface AsyncStateProps<T> {
  /** `undefined` means still loading, `null` means the fetch itself
   * failed (see `error`), any other value is the real data - the same
   * three-state shape the copy-pasted triads across Chat, Memory,
   * Privacy, People and the settings renderer each hand-rolled before
   * this existed (docs/BACKLOG.md > "Kit gaps found by the audit"). */
  data: T | null | undefined;
  error?: boolean;
  /** TanStack Query's own `isFetching`: true for the initial load AND
   * for a retry in flight. Without this, a query whose `isError` stays
   * true until a retry actually settles (TanStack Query's own behavior -
   * `refetch()` does not clear it early) left `onRetry` looking
   * unresponsive: the same stale error page stayed up, with no visual
   * change at all, for however long the retry took (a code review,
   * 2026-09-05). Optional so a caller with no query behind it (a plain
   * boolean `error`) isn't forced to invent one. */
  isFetching?: boolean;
  onRetry: () => void;
  /** The catalogue message (`spec/errors/errors.json`'s `ui_message`)
   * already arrives on the failed response as `ApiError.message` - the
   * backend resolves the code before the frontend ever sees it, so
   * there is nothing to look up here. This is only the fallback for a
   * failure that never reached the API layer at all. */
  errorMessage?: string;
  emptyIcon?: string;
  emptyText?: string;
  isEmpty?: (data: T) => boolean;
  loadingLabel?: string;
  children: (data: T) => ReactNode;
}

// The kit's one loading/error/empty triad (docs/BACKLOG.md's "AsyncState"
// gap): every page bound the same three states by hand, each with its own
// spinner, its own retry button and its own empty-state copy. This is the
// one implementation the org's "a second copy of anything is wrong even
// when it is faster" standard asks for, built on the generated Skeleton
// and Button rather than a hand-rolled spinner div.
export function AsyncState<T>({
  data,
  error,
  isFetching,
  onRetry,
  errorMessage = "Something went wrong.",
  emptyIcon = "inbox",
  emptyText = "Nothing here yet.",
  isEmpty,
  loadingLabel = "Loading",
  children,
}: AsyncStateProps<T>) {
  const loading = (
    <div className="flex flex-col gap-3 p-4" role="status" aria-label={loadingLabel}>
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-3/4" />
    </div>
  );

  // Checked before `error`: a query's `isError` stays true until a
  // retry actually settles, so without this a retry in flight looked
  // identical to not having retried at all.
  if (isFetching && data === undefined) return loading;

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-base text-destructive">{errorMessage}</p>
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }

  if (data === undefined) return loading;

  if (data === null || (isEmpty && isEmpty(data))) {
    return <EmptyState icon={emptyIcon} text={emptyText} />;
  }

  return <>{children(data)}</>;
}

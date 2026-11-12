import { familyLabel, greetingFor } from "@/apps/home/greeting";

/** Mirrors `@maipai/ui/src/dashboard/components/dashboards/modern/overview-tab.tsx`:
 * the greeting row's own shape (a time-of-day greeting and a name; the
 * sun/moon icon was decoration only and is dropped) - only that part. The vendored widget's period
 * dropdown, refresh and export buttons are UI affordances with no Home
 * counterpart at all (no "Monthly/Yearly" toggle, nothing to export),
 * so per the gap this page's own header comment names, they're left
 * out rather than kept as buttons that would do nothing.
 *
 * A review finding: this first reimplemented time-of-day bucketing by
 * hand (different hour boundaries, a stray "Good Night" bucket, its
 * own capitalization) instead of `@/apps/home/greeting.ts`'s existing
 * `greetingFor()`/`timeOfDay()` - already the shell header's own source
 * for the identical text (`routeHeader.ts`) - which would have shown a
 * DIFFERENT greeting for the same person at the same moment on the old
 * shell vs. `/`. Fixed to call the real function directly, un-
 * memoized, on every render (the shell header's own pattern) rather
 * than freezing a computed value in `useState` from a mount-only
 * effect - the second bug the review found, since a frozen value never
 * updates across an hour boundary while the page stays open. */
export function Greeting({ displayName, familyName }: { displayName: string; familyName?: unknown }) {
  const family = familyLabel(familyName);

  return (
    <div className="flex flex-col items-center gap-1 text-center">
      {family ? <p className="text-supporting text-muted-foreground">{family}</p> : null}
      <h2 className="text-title">
        {greetingFor(new Date(), displayName)}
      </h2>
    </div>
  );
}

// Timing check 2026-11-12: first measured edit-to-live run in direct mode.
// Timing check 2: second measured edit-to-live run.

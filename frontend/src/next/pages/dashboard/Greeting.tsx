import { getIcon } from "@maipai/ui/src/icons";
import { greetingFor, timeOfDay } from "@/apps/home/greeting";

const SunIcon = getIcon("sun");
const MoonIcon = getIcon("moon");

/** Mirrors `@maipai/ui/src/dashboard/components/dashboards/modern/overview-tab.tsx`:
 * the greeting row's own shape (a time-of-day greeting, a name, the
 * sun/moon icon) - only that part. The vendored widget's period
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
 * shell vs. `/next`. Fixed to call the real function directly, un-
 * memoized, on every render (the shell header's own pattern) rather
 * than freezing a computed value in `useState` from a mount-only
 * effect - the second bug the review found, since a frozen value never
 * updates across an hour boundary while the page stays open. */
export function Greeting({ displayName }: { displayName: string }) {
  const isDaytime = timeOfDay(new Date().getHours()) !== "evening";

  return (
    <div className="flex flex-col items-start">
      <h2 className="text-xl flex items-center gap-2 capitalize">
        {greetingFor(new Date(), displayName)} <span className="flex items-center">{isDaytime ? <SunIcon size={25} color="orange" /> : <MoonIcon size={25} />}</span>
      </h2>
      <p className="text-sm font-normal text-muted-foreground">Stay informed with today's activity</p>
    </div>
  );
}

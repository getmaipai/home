import { Link } from "react-router-dom";
import type { Icon } from "@maipai/ui/src/icons";

/** The shared shape the dashboard's People, Updates and
 * Repairs tiles all mirror - the vendored KPI-card
 * shape shared by `@maipai/ui/src/dashboard/components/dashboards/modern/
 * total-orders.tsx`, `total-profit.tsx` and `advertisement-cost.tsx`
 * (all three are the identical Card shell, header row and icon box,
 * differing only in label/value/icon). Factored out once here (a review
 * finding: four hand-copied files repeating the same JSX verbatim was
 * exactly the "smallest composition of shipped parts" rule's own
 * target, not a fourth parallel copy) rather than one file per
 * card mirroring the vendored file directly - each of the four callers
 * still has its own file, its own header comment naming what this
 * shares and why, and its own props; only the shared markup moved here.
 * Their own badge (a percent-change delta) and "See Statistics" button
 * are dropped everywhere - the wire carries plain counts, no delta and
 * no statistics page to link to.
 *
 * DASH-LOOK-01: the plain `Card` primitive, not the vendored shared
 * `DashboardCard` wrapper - `DashboardCard` (`components/shared/
 * dashboard-card.tsx`, part of the same vendored snapshot, used by the
 * template's own modern-dashboard widgets) explicitly overrides Card's
 * own `bg-card`/`ring-1` with `bg-background`/`ring-0`, the flat KPI-row
 * look those specific demo widgets wanted - not what Jesse asked for
 * (shaded like Settings and shadcn's own dashboard-01 block). `Card`
 * already carries the real surface; no vendored file edited, just a
 * different vendored primitive.
 *
 * `to` (owner ruling, ui-v0.5.23's own rail restructuring): Updates,
 * Repairs and Engines lost their permanent rail entry the same
 * release, so this card is now each one's real way back to its own
 * page, not just a status glance - the whole card is a plain
 * `react-router-dom` `Link` when a route is given, hover state and all,
 * matching the vendored widgets' own dropped "See Statistics" button in
 * spirit without inventing a second, separate link element. People has
 * no `to`: it never lost a rail entry to replace. */

/* RULE9-CLEANUP-01f: this file no longer returns a kit `Card`. `StatBody` is the inside of one tile (label, value, icon)
 * and `StatLink` is the plain `Link` the Updates and Repairs tiles sit in; `DashboardPage` renders the `Card` and
 * `CardContent` itself, as shipped, so there is no Home wrapper and no className on either. */
export function StatBody({ children, icon: IconComponent }: { children: React.ReactNode; icon: Icon }) {
  return (
    <div className="flex items-center justify-between w-full">
      <div className="flex flex-col gap-1">{children}</div>
      <div className="border border-border p-2.5 w-fit rounded-md">
        <IconComponent size={16} />
      </div>
    </div>
  );
}

/** The label and value of a tile whose value is words, not a count (a count uses the shipped `NumberTicker`). */
export function StatText({ label, value }: { label: string; value: string }) {
  return (
    <>
      <p className="text-sm font-normal text-foreground">{label}</p>
      <h3 className="text-2xl font-semibold">{value}</h3>
    </>
  );
}

export function StatLink({ to, children }: { to?: string; children: React.ReactNode }) {
  return to ? (
    <Link to={to} className="block rounded-xl transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {children}
    </Link>
  ) : (
    <>{children}</>
  );
}

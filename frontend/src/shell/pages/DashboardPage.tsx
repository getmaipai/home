import { Link } from "react-router-dom";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { isOwnerOrAdminRole, type Roster } from "@/lib/api";
import { Greeting } from "@/shell/pages/dashboard/Greeting";
import { AskBox } from "@/shell/pages/dashboard/AskBox";
import { TodaySection } from "@/shell/pages/dashboard/TodaySection";
import { HomePlaceAsk } from "@/shell/pages/dashboard/HomePlaceAsk";
import { GettingStarted } from "@/shell/pages/dashboard/GettingStarted";
import { useTabItem } from "@/shell/tabIdentity";

/** Home (docs/design/home-page-2026-10-17.md, option C): the greeting, then the ask box, then a short
 * glance at the day. Every block is left out when it has nothing to show. First slice: Ask (01h),
 * Today (01e), Getting started (01g) and the admin links (01b). The server filters Today by the viewer's
 * role and age; Home adds no gate and removes none. Nothing here shows another person's activity. */
export function DashboardPage({ person }: { person: Roster }) {
  useTabItem("Home");
  const admin = isOwnerOrAdminRole(person.role);

  return (
    <div className="flex flex-col gap-6 pb-4">
      <h1 className="sr-only">Home</h1>
      <Greeting displayName={person.display_name} />
      {admin ? (
        <nav aria-label="Looking after your hub" className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" nativeButton={false} render={<Link to="/updates" />}>Updates</Button>
          <Button variant="outline" size="sm" nativeButton={false} render={<Link to="/repairs" />}>Repairs</Button>
        </nav>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="lg:col-span-8"><AskBox /></div>
        {admin ? <div className="lg:col-span-4"><GettingStarted person={person} /></div> : null}
      </div>
      <HomePlaceAsk person={person} />
      <TodaySection />
    </div>
  );
}

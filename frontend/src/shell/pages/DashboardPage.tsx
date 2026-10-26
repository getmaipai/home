import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useIncognitoContext } from "@/shell/incognitoContext";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { RouteSkeleton } from "@maipai/ui/src/primitives/RouteSkeleton";
import { isOwnerOrAdminRole, type Roster } from "@/lib/api";
import { api } from "@/lib/api";
import { Greeting } from "@/shell/pages/dashboard/Greeting";
import { AskBox } from "@/shell/pages/dashboard/AskBox";
import { TodaySection } from "@/shell/pages/dashboard/TodaySection";
import { GettingStarted } from "@/shell/pages/dashboard/GettingStarted";
import { useTabItem } from "@/shell/tabIdentity";
import { ContinueShelf, FamilyShelf } from "@/shell/pages/dashboard/HomeShelves";
import { homeBlocks, type HomeBlockId } from "@/shell/pages/dashboard/homeBlocks";

/** Home (docs/design/home-page-2026-10-17.md, option C): the greeting, then the ask box, then a short
 * glance at the day. Every block is left out when it has nothing to show. First slice: Ask (01h),
 * Today (01e), Getting started (01g) and the admin links (01b). The server filters Today by the viewer's
 * role and age; Home adds no gate and removes none. Nothing here shows another person's activity. */
export function DashboardPage({ person }: { person: Roster }) {
  useTabItem("Home");
  const admin = isOwnerOrAdminRole(person.role);
  const { on: incognito } = useIncognitoContext();
  const widgets = useQuery({ queryKey: ["home-widgets"], queryFn: api.homeWidgets, retry: false });
  const people = useQuery({ queryKey: ["home-family"], queryFn: api.people, retry: false, enabled: !incognito && person.role !== "guest" });
  const blocks = homeBlocks();

  const renderBlock = (block: HomeBlockId) => {
    switch (block) {
      case "greeting": return <div key={block} className="lg:col-span-8"><Greeting displayName={person.display_name} /></div>;
      case "admin": return admin ? <nav key={block} aria-label="Looking after your hub" className="flex flex-wrap gap-x-2 gap-y-5 lg:col-span-4"><Button variant="outline" size="row" nativeButton={false} render={<Link to="/updates" />}>Updates</Button><Button variant="outline" size="row" nativeButton={false} render={<Link to="/repairs" />}>Repairs</Button></nav> : null;
      case "ask": return <div key={block} className="lg:col-span-8"><AskBox /></div>;
      case "hero": return widgets.data?.hero ? <TodaySection home={widgets.data} heroOnly key={block} /> : null;
      case "pick_up": return incognito || person.role === "guest" ? null : <div key={block} className="lg:col-span-6"><ContinueShelf /></div>;
      case "today": return widgets.data ? <TodaySection key={block} home={widgets.data} /> : null;
      case "family": return incognito || person.role === "guest" || !people.data?.length ? null : <div key={block} className="lg:col-span-6"><FamilyShelf viewer={person} incognito={incognito} /></div>;
      case "getting_started": return admin ? <div key={block} className="lg:col-span-4"><GettingStarted person={person} /></div> : null;
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 pb-4 md:grid-cols-2 lg:grid-cols-12">
      <h1 className="sr-only">Home</h1>
      {!widgets.data && !widgets.isError ? <div className="md:col-span-2 lg:col-span-12"><RouteSkeleton label="Loading Home" /></div> : null}
      {widgets.isError ? <p role="alert" className="md:col-span-2 lg:col-span-12 text-sm text-muted-foreground">Could not load Home cards. Refresh Home to try again.</p> : null}
      {blocks.map(renderBlock)}
    </div>
  );
}

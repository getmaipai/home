import { useQuery } from "@tanstack/react-query";

import { Link } from "react-router-dom";
import { useIncognitoContext } from "@/shell/incognitoContext";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { getIcon } from "@maipai/ui/src/icons";
import { RouteSkeleton } from "@maipai/ui/src/primitives/RouteSkeleton";
import { isOwnerOrAdminRole, type Roster } from "@/lib/api";
import { api } from "@/lib/api";
import { Greeting } from "@/shell/pages/dashboard/Greeting";
import { AskBox } from "@/shell/pages/dashboard/AskBox";
import { TodaySection } from "@/shell/pages/dashboard/TodaySection";
import { GettingStarted } from "@/shell/pages/dashboard/GettingStarted";
import { useTabItem } from "@/shell/tabIdentity";
import { ContinueShelf, FamilyShelf, HomeMedia } from "@/shell/pages/dashboard/HomeShelves";
import { homeBlocks, type HomeBlockId } from "@/shell/pages/dashboard/homeBlocks";
import { settingsPath } from "@/shell/pages/settings/settingsAreas";

const GearIcon = getIcon("settings");

/** Home (docs/design/home-page-2026-10-17.md, option C): the greeting, then the ask box, then a short
 * glance at the day. Every block is left out when it has nothing to show. First slice: Ask (01h),
 * Today (01e), Getting started (01g) and the admin links (01b). The server filters Today by the viewer's
 * role and age; Home adds no gate and removes none. Nothing here shows another person's activity. */
export function DashboardPage({ person }: { person: Roster }) {
  useTabItem("Home");
  const admin = isOwnerOrAdminRole(person.role);
  const { on: incognito } = useIncognitoContext();
  const widgets = useQuery({ queryKey: ["home-widgets"], queryFn: api.homeWidgets, retry: false });
  const settingKey = ["settings", "person", person.id, "ui.home_layout"] as const;
  const layoutSetting = useQuery({ queryKey: settingKey, queryFn: async () => (await api.settingsValues(`person:${person.id}`)).find((row) => row.key === "ui.home_layout"), retry: false,
    // Coming back from Settings must show the layout just chosen, not the copy cached up to a minute ago.
    staleTime: 0, refetchOnMount: "always" });
  const rawLayout = layoutSetting.data?.value;
  const layout = (layoutSetting.data?.layer === "band" && layoutSetting.data?.source === "default" ? "ask" : rawLayout === "ask" || rawLayout === "board" || rawLayout === "shelves" ? rawLayout : "shelves");
  const media = useQuery({ queryKey: ["home-media"], queryFn: api.mediaHome, retry: false, enabled: layout === "shelves" });
  const continueRows = useQuery({ queryKey: ["home-continue"], queryFn: api.continueRows, retry: false, enabled: layout === "shelves" });
  const people = useQuery({ queryKey: ["home-family"], queryFn: api.people, retry: false, enabled: !incognito && person.role !== "guest" });
  const hasShelfData = Boolean(media.data?.continue?.length || media.data?.new?.length || media.data?.made_at_home?.length || continueRows.data?.rows?.length);
  const blocks = homeBlocks(layout, media.isError || continueRows.isError ? false : (media.isPending || continueRows.isPending) ? true : hasShelfData);

  const renderBlock = (block: HomeBlockId) => {
    switch (block) {
      case "greeting": return <div key={block} className="lg:col-span-8"><Greeting displayName={person.display_name} /></div>;
      case "admin": return admin ? <nav key={block} aria-label="Looking after your hub" className="flex flex-wrap gap-x-2 gap-y-5 lg:col-span-4"><Button variant="outline" size="row" nativeButton={false} render={<Link to="/updates" />}>Updates</Button><Button variant="outline" size="row" nativeButton={false} render={<Link to="/repairs" />}>Repairs</Button></nav> : null;
      case "ask": return <div key={block} className="lg:col-span-8"><AskBox /></div>;
      case "media_continue": return (media.data?.continue.length || continueRows.data?.rows?.length) ? <div key={block} className="lg:col-span-12"><HomeMedia kind="continue" /></div> : null;
      case "media_new": return media.data?.new.length ? <div key={block} className="lg:col-span-12"><HomeMedia kind="new" /></div> : null;
      case "media_made": return media.data?.made_at_home.length ? <div key={block} className="lg:col-span-12"><HomeMedia kind="made_at_home" /></div> : null;
      case "hero": return widgets.data?.hero ? <TodaySection home={widgets.data} heroOnly key={block} /> : null;
      case "pick_up": return incognito || person.role === "guest" ? null : <div key={block} className="lg:col-span-6"><ContinueShelf /></div>;
      case "today_chips": return widgets.data ? <TodaySection key={block} home={widgets.data} chips /> : null;
      case "today": return widgets.data ? <TodaySection key={block} home={widgets.data} /> : null;
      case "family": return incognito || person.role === "guest" || !people.data?.length ? null : <div key={block} className="lg:col-span-6"><FamilyShelf viewer={person} incognito={incognito} /></div>;
      case "getting_started": return admin ? <div key={block} className="lg:col-span-12"><GettingStarted person={person} /></div> : null;
    }
  };

  return (
    <div className="flex flex-col gap-4 pb-4">
      <header className="flex items-center justify-end"><h1 className="sr-only">Home</h1>{person.role !== "guest" ? <Button variant="ghost" size="icon-lg" render={<Link to={settingsPath("appearance", "appearance", "ui.home_layout")} aria-label="Home layout" />}><GearIcon aria-hidden="true" /></Button> : null}</header>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-12">
      {!widgets.data && !widgets.isError ? <div className="md:col-span-2 lg:col-span-12"><RouteSkeleton label="Loading Home" /></div> : null}
      {widgets.isError ? <p role="alert" className="md:col-span-2 lg:col-span-12 text-sm text-muted-foreground">Could not load Home cards. Refresh Home to try again.</p> : null}
      {blocks.map(renderBlock)}
      </div>
    </div>
  );
}

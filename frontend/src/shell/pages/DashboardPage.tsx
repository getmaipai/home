import { i18n } from "@lingui/core";
import { useSharedReads } from "@/lib/sharedReads";
import { useQuery } from "@tanstack/react-query";

import { useIncognitoContext } from "@/shell/incognitoContext";
import { RouteSkeleton } from "@maipai/ui/src/primitives/RouteSkeleton";
import { isOwnerOrAdminRole, type Roster } from "@/lib/api";
import { api } from "@/lib/api";
import { Greeting } from "@/shell/pages/dashboard/Greeting";
import { AskBox } from "@/shell/pages/dashboard/AskBox";
import { TodaySection } from "@/shell/pages/dashboard/TodaySection";
import { Attention } from "@/shell/pages/dashboard/Attention";
import { GettingStarted } from "@/shell/pages/dashboard/GettingStarted";
import { useTabItem } from "@/shell/tabIdentity";
import { ContinueShelf, FamilyShelf, HomeMedia } from "@/shell/pages/dashboard/HomeShelves";
import { homeBlocks, type HomeBlockId } from "@/shell/pages/dashboard/homeBlocks";
import { Link } from "react-router-dom";
import { getIcon } from "@maipai/ui/src/icons";

const MessageIcon = getIcon("message-circle");
const MediaIcon = getIcon("headphones");
const AppsIcon = getIcon("layout-grid");


/** Home (docs/design/home-page-2026-10-17.md, option C): the greeting, then the ask box, then a short
 * glance at the day. Every block is left out when it has nothing to show. First slice: Ask (01h),
 * Today (01e), Getting started (01g) and the admin links (01b). The server filters Today by the viewer's
 * role and age; Home adds no gate and removes none. Nothing here shows another person's activity. */
export function DashboardPage({ person }: { person: Roster }) {
  useTabItem(i18n._({ id: "Home", message: "Home" }));
  const admin = isOwnerOrAdminRole(person.role);
  const { on: incognito } = useIncognitoContext();
  const widgets = useQuery({ queryKey: ["home-widgets"], queryFn: api.homeWidgets, retry: false });
  const reads = useSharedReads();
  const settingKey = ["settings", "person", person.id, "ui.home_layout"] as const;
  const layoutSetting = useQuery({ queryKey: settingKey, queryFn: async () => (await reads.settingsValues(`person:${person.id}`)).find((row) => row.key === "ui.home_layout"), retry: false,
    // Coming back from Settings must show the layout just chosen, not the copy cached up to a minute ago.
    staleTime: 0, refetchOnMount: "always" });
  const rawLayout = layoutSetting.data?.value;
  const layout = (layoutSetting.data?.layer === "band" && layoutSetting.data?.source === "default" ? "ask" : rawLayout === "ask" || rawLayout === "board" || rawLayout === "shelves" ? rawLayout : "shelves");
  const familyName = useQuery({ queryKey: ["settings", "household", "household.family_name"], queryFn: async () => (await reads.settingsValues("household")).find((row) => row.key === "household.family_name"), retry: false });
  const media = useQuery({ queryKey: ["home-media"], queryFn: api.mediaHome, retry: false, enabled: layout === "shelves" });
  const continueRows = useQuery({ queryKey: ["home-continue"], queryFn: api.continueRows, retry: false, enabled: layout === "shelves" });
  const people = useQuery({ queryKey: ["home-family"], queryFn: api.people, retry: false, enabled: !incognito && person.role !== "guest" });
  const hasShelfData = Boolean(media.data?.continue?.length || media.data?.new?.length || media.data?.made_at_home?.length || continueRows.data?.rows?.length);
  const blocks = homeBlocks(layout, media.isError || continueRows.isError ? false : (media.isPending || continueRows.isPending) ? true : hasShelfData);

  const renderBlock = (block: HomeBlockId) => {
    switch (block) {
      case "greeting": return <div key={block} className="md:col-span-2 lg:col-span-12 grid items-stretch gap-6 lg:grid-cols-12">
        <div className="relative isolate flex min-h-72 flex-col justify-between overflow-hidden rounded-3xl bg-primary p-7 text-primary-foreground shadow-lg sm:p-9 lg:col-span-8 lg:p-11">
          <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-32 -z-10 size-96 rounded-full border-12 border-primary-foreground/10" />
          <div aria-hidden="true" className="pointer-events-none absolute -bottom-52 right-24 -z-10 size-96 rounded-full border border-primary-foreground/15" />
          <div className="flex flex-col gap-8">
            <Greeting displayName={person.display_name} familyName={familyName.data?.value} />
            <div className="max-w-3xl"><AskBox /></div>
          </div>
          <p className="mt-8 text-supporting text-primary-foreground/75">{i18n._({ id: "Your home, all in one place", message: "Your home, all in one place" })}</p>
        </div>
        <div className="flex flex-col justify-between gap-4 rounded-3xl border border-border bg-card p-5 sm:p-6 lg:col-span-4">
          <div className="flex flex-col gap-1"><p className="text-supporting font-semibold uppercase tracking-wide text-primary">{i18n._({ id: "Your space", message: "Your space" })}</p><h2 className="text-heading font-semibold">{i18n._({ id: "Where to?", message: "Where to?" })}</h2></div>
          <HomeShortcuts />
        </div>
      </div>;
      case "admin": return admin ? <div key={block} className="md:col-span-2 lg:col-span-12"><Attention /></div> : null;
      case "ask": return null;
      case "media_continue": return (media.data?.continue.length || continueRows.data?.rows?.length) ? <div key={block} className="md:col-span-2 lg:col-span-12"><HomeMedia kind="continue" /></div> : null;
      case "media_new": return media.data?.new.length ? <div key={block} className="md:col-span-2 lg:col-span-12"><HomeMedia kind="new" /></div> : null;
      case "media_made": return media.data?.made_at_home.length ? <div key={block} className="md:col-span-2 lg:col-span-12"><HomeMedia kind="made_at_home" /></div> : null;
      case "hero": return widgets.data?.hero ? <TodaySection home={widgets.data} heroOnly role={person.role} key={block} /> : null;
      case "pick_up": return incognito || person.role === "guest" ? null : <div key={block} className="lg:col-span-6"><ContinueShelf /></div>;
      case "today_chips": return widgets.data ? <TodaySection key={block} home={widgets.data} chips role={person.role} /> : null;
      case "today": return widgets.data ? <TodaySection key={block} home={widgets.data} role={person.role} /> : null;
      case "family": return incognito || person.role === "guest" || !people.data?.length ? null : <div key={block} className="lg:col-span-6"><FamilyShelf viewer={person} incognito={incognito} /></div>;
      case "getting_started": return admin ? <div key={block} className="md:col-span-2 lg:col-span-12"><GettingStarted person={person} /></div> : null;
    }
  };

  return (
    <div className="flex flex-col pb-4">
      <div className="grid grid-cols-1 gap-x-6 gap-y-8 md:grid-cols-2 lg:grid-cols-12 lg:gap-y-8">
      {!widgets.data && !widgets.isError ? <div className="md:col-span-2 lg:col-span-12"><RouteSkeleton label={i18n._({ id: "Loading Home", message: "Loading Home" })} /></div> : null}
      {widgets.isError ? <p role="alert" className="md:col-span-2 lg:col-span-12 text-supporting text-muted-foreground">{i18n._({ id: "Could not load Home cards. Refresh Home to try again.", message: "Could not load Home cards. Refresh Home to try again." })}</p> : null}
      {blocks.map(renderBlock)}
      </div>
    </div>
  );
}

function HomeShortcuts() {
  const items = [
    { href: "/chat", title: i18n._({ id: "Ask MaiPai", message: "Ask MaiPai" }), line: i18n._({ id: "Think something through", message: "Think something through" }), Icon: MessageIcon },
    { href: "/media", title: i18n._({ id: "Explore media", message: "Explore media" }), line: i18n._({ id: "Music, videos and more", message: "Music, videos and more" }), Icon: MediaIcon },
    { href: "/all-apps", title: i18n._({ id: "Browse apps", message: "Browse apps" }), line: i18n._({ id: "Find more for your home", message: "Find more for your home" }), Icon: AppsIcon },
  ];
  return (
    <nav aria-label={i18n._({ id: "Jump back in", message: "Jump back in" })} className="grid grid-cols-1 gap-2 lg:content-start">
      {items.map(({ href, title, line, Icon }) => (
        <Link key={href} to={href} className="group flex min-h-16 items-center gap-3 rounded-2xl px-3 py-3 text-foreground no-underline transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon aria-hidden className="size-5" /></span>
          <span className="flex min-w-0 flex-col gap-1"><span className="text-row font-semibold">{title}</span><span className="text-supporting text-muted-foreground">{line}</span></span>
          <span aria-hidden="true" className="ms-auto text-muted-foreground transition-transform group-hover:translate-x-1">→</span>
        </Link>
      ))}
    </nav>
  );
}

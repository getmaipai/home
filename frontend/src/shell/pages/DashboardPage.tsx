import { i18n } from "@lingui/core";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";

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
import { ActionCards } from "@/shell/pages/dashboard/ActionCards";


/** Home (docs/design/home-page-2026-10-17.md, option C): the greeting, then the ask box, then a short
 * glance at the day. Every block is left out when it has nothing to show. First slice: Ask (01h),
 * Today (01e), Getting started (01g) and the admin links (01b). The server filters Today by the viewer's
 * role and age; Home adds no gate and removes none. Nothing here shows another person's activity. */
export function DashboardPage({ person }: { person: Roster }) {
  const [focusAsk, setFocusAsk] = useState(0);
  const askRef = useRef<HTMLDivElement>(null);
  useTabItem(i18n._({ id: "Home", message: "Home" }));
  const admin = isOwnerOrAdminRole(person.role);
  const { on: incognito } = useIncognitoContext();
  const widgets = useQuery({ queryKey: ["home-widgets"], queryFn: api.homeWidgets, retry: false });
  const familyName = useQuery({ queryKey: ["settings", "household", "household.family_name"], queryFn: async () => (await api.settingsValues("household")).find((row) => row.key === "household.family_name"), retry: false });
  const media = useQuery({ queryKey: ["home-media"], queryFn: api.mediaHome, retry: false });
  const continueRows = useQuery({ queryKey: ["home-continue"], queryFn: api.continueRows, retry: false });
  const people = useQuery({ queryKey: ["home-family"], queryFn: api.people, retry: false, enabled: !incognito && person.role !== "guest" });
  const blocks = homeBlocks("ask");

  const renderBlock = (block: HomeBlockId) => {
    switch (block) {
      case "greeting": return <div key={block} className="flex justify-center text-center"><Greeting displayName={person.display_name} familyName={familyName.data?.value} /></div>;
      case "admin": return admin ? <div key={block}><Attention /></div> : null;
      case "ask": return <div key={block} ref={askRef} className="mx-auto w-full max-w-screen-sm"><AskBox focusOnRequest={focusAsk} /></div>;
      case "actions": return <div key={block} className="mx-auto w-full max-w-5xl"><ActionCards onFocusAsk={() => { setFocusAsk((value) => value + 1); askRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }} /></div>;
      case "media_continue": return (media.data?.continue.length || continueRows.data?.rows?.length) ? <div key={block} className="w-full"><HomeMedia kind="continue" /></div> : null;
      case "media_new": return media.data?.new.length ? <div key={block}><HomeMedia kind="new" /></div> : null;
      case "media_made": return media.data?.made_at_home.length ? <div key={block}><HomeMedia kind="made_at_home" /></div> : null;
      case "hero": return widgets.data?.hero ? <TodaySection home={widgets.data} heroOnly role={person.role} key={block} /> : null;
      case "pick_up": return incognito || person.role === "guest" ? null : <div key={block} className="lg:col-span-6"><ContinueShelf /></div>;
      case "today_chips": return widgets.data ? <TodaySection key={block} home={widgets.data} chips role={person.role} /> : null;
      case "today": return widgets.data ? <TodaySection key={block} home={widgets.data} role={person.role} /> : null;
      case "family": return incognito || person.role === "guest" || !people.data?.length ? null : <div key={block}><FamilyShelf viewer={person} incognito={incognito} /></div>;
      case "getting_started": return admin ? <div key={block}><GettingStarted person={person} /></div> : null;
    }
  };

  return (
    <div className="flex flex-col pb-4">
      <div className="flex w-full flex-col items-stretch gap-y-8">
      {!widgets.data && !widgets.isError ? <div className="w-full"><RouteSkeleton label={i18n._({ id: "Loading Home", message: "Loading Home" })} /></div> : null}
      {widgets.isError ? <p role="alert" className="text-supporting text-muted-foreground">{i18n._({ id: "Could not load Home cards. Refresh Home to try again.", message: "Could not load Home cards. Refresh Home to try again." })}</p> : null}
      {blocks.map(renderBlock)}
      </div>
    </div>
  );
}

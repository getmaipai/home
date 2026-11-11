import { i18n } from "@lingui/core";
import { useRef } from "react";
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
import { ARRANGE_KEY, defaultSectionLayout, HOME_SECTIONS, type HomeSection } from "@/shell/pages/dashboard/ArrangeHome";
import { HomeHero, chooseHomeHero } from "@/shell/pages/dashboard/HomeHero";
import { MakeShelf } from "@/shell/pages/dashboard/MakeShelf";
import { useAmbientCompanion } from "@/shell/useAmbientCompanion";


/** Home (docs/design/home-page-2026-10-17.md, option C): the greeting, then the ask box, then a short
 * glance at the day. Every block is left out when it has nothing to show. First slice: Ask (01h),
 * Today (01e), Getting started (01g) and the admin links (01b). The server filters Today by the viewer's
 * role and age; Home adds no gate and removes none. Nothing here shows another person's activity. */
export function DashboardPage({ person }: { person: Roster }) {
  const askRef = useRef<HTMLDivElement>(null);
  useTabItem(i18n._({ id: "Home", message: "Home" }));
  const admin = isOwnerOrAdminRole(person.role);
  const { on: incognito } = useIncognitoContext();
  const widgets = useQuery({ queryKey: ["home-widgets"], queryFn: api.homeWidgets, retry: false });
  const reads = useSharedReads();
  const layoutSetting = useQuery({ queryKey: ["settings-values", `person:${person.id}`], queryFn: () => reads.settingsValues(`person:${person.id}`), retry: false, staleTime: 0, refetchOnMount: "always" });
  const layoutValue = layoutSetting.data?.find((row) => row.key === "ui.home_layout");
  const rawLayout = layoutValue?.value;
  const layout = (layoutValue?.layer === "band" && layoutValue?.source === "default" ? "ask" : rawLayout === "ask" || rawLayout === "board" || rawLayout === "shelves" ? rawLayout : "shelves");
  const familyName = useQuery({ queryKey: ["settings", "household", "household.family_name"], queryFn: async () => (await reads.settingsValues("household")).find((row) => row.key === "household.family_name") ?? null, retry: false });
  const media = useQuery({ queryKey: ["home-media"], queryFn: api.mediaHome, retry: false });
  const companion = useAmbientCompanion(person);
  const continueRows = useQuery({ queryKey: ["home-continue"], queryFn: api.continueRows, retry: false, enabled: layout === "shelves" });
  const people = useQuery({ queryKey: ["home-family"], queryFn: api.people, retry: false, enabled: !incognito && person.role !== "guest" });
  const arrange = useQuery({ queryKey: ARRANGE_KEY, queryFn: api.homeArrange, retry: false });
  const defaults = defaultSectionLayout(person.role, layout);
  const sectionLayout = arrange.data?.sections ?? defaults;
  const hidden = sectionLayout.hidden ?? defaults.hidden;
  const sectionBlockMap: Record<HomeSection, HomeBlockId[]> = { hero: ["hero"], composer: ["ask"], make: ["make"], continue: [layout === "shelves" ? "media_continue" : "pick_up"], today: [layout === "ask" ? "today_chips" : "today"], new: ["media_new"], made: ["media_made"], family: ["family"], admin: ["getting_started", "admin"] };
  const sectionBlocks = [...(sectionLayout.order ?? defaults.order), ...HOME_SECTIONS.filter((id) => !(sectionLayout.order ?? defaults.order).includes(id))]
    .filter((id) => !hidden.includes(id as HomeSection))
    .flatMap((id) => sectionBlockMap[id as HomeSection] ?? [])
    .filter((block) => block !== "media_continue" || !media.isPending && !continueRows.isPending)
    .filter((block) => block !== "media_new" && block !== "media_made" || !media.isPending);
  const legacyBlocks = homeBlocks(layout, media.isError || continueRows.isError ? false : (media.isPending || continueRows.isPending) ? true : Boolean(media.data?.continue?.length || media.data?.new?.length || media.data?.made_at_home?.length || continueRows.data?.rows?.length));

  const renderBlock = (block: HomeBlockId) => {
    switch (block) {
      case "greeting": return <div key={block} className="md:col-span-2 lg:col-span-12"><Greeting displayName={person.display_name} familyName={familyName.data?.value} /></div>;
      case "admin": return admin ? <div key={block} className="md:col-span-2 lg:col-span-12"><Attention /></div> : null;
      case "ask": return <div key={block} ref={askRef} className="mx-auto w-full max-w-2xl md:col-span-2 lg:col-span-12"><AskBox role={person.role} /></div>;
      case "make": return <div key={block} className="md:col-span-2 lg:col-span-12"><MakeShelf role={person.role} /></div>;
      case "actions": return null;
      case "media_continue": return (media.data?.continue?.length || continueRows.data?.rows?.length) ? <div key={block} className="md:col-span-2 lg:col-span-12"><HomeMedia kind="continue" /></div> : null;
      case "media_new": return media.data?.new?.length ? <div key={block} className="md:col-span-2 lg:col-span-12"><HomeMedia kind="new" /></div> : null;
      case "media_made": return media.data?.made_at_home?.length ? <div key={block} className="md:col-span-2 lg:col-span-12"><HomeMedia kind="made_at_home" /></div> : null;
      case "hero": {
        const bot = companion?.kind === "companion" ? companion.companion : undefined;
        const source = sectionLayout.heroSource ?? defaults.heroSource;
        const choice = source === "off" || source === "weather" ? null : source === "companion" ? chooseHomeHero([], bot ? { id: bot.id, name: bot.name, portrait: bot.portrait } : null, true) : chooseHomeHero(media.data?.made_at_home, bot ? { id: bot.id, name: bot.name, portrait: bot.portrait } : null, person.role === "child" || person.role === "teen");
        return choice ? <div key={block} className="md:col-span-2 lg:col-span-12"><HomeHero choice={choice} /></div> : null;
      }
      case "pick_up": return incognito || person.role === "guest" ? null : <div key={block} className="lg:col-span-6"><ContinueShelf /></div>;
      case "today_chips": return null;
      case "today": return widgets.data ? <TodaySection key={block} home={widgets.data} role={person.role} /> : null;
      case "family": return incognito || person.role === "guest" || !people.data?.length ? null : <div key={block} className="lg:col-span-6"><FamilyShelf viewer={person} incognito={incognito} /></div>;
      case "getting_started": return admin ? <div key={block} className="md:col-span-2 lg:col-span-12"><GettingStarted person={person} /></div> : null;
    }
  };

  return (
    <div className="flex flex-col pb-4">
      <div className="grid grid-cols-1 gap-x-6 gap-y-8 md:grid-cols-2 lg:grid-cols-12 lg:gap-y-10">
      {!widgets.data && !widgets.isError ? <div className="md:col-span-2 lg:col-span-12"><RouteSkeleton label={i18n._({ id: "Loading Home", message: "Loading Home" })} /></div> : null}
      {widgets.isError ? <p role="alert" className="md:col-span-2 lg:col-span-12 text-supporting text-muted-foreground">{i18n._({ id: "Could not load Home cards. Refresh Home to try again.", message: "Could not load Home cards. Refresh Home to try again." })}</p> : null}
      {legacyBlocks.filter((block) => block === "greeting").map(renderBlock)}
      {sectionBlocks.map(renderBlock)}
      </div>
    </div>
  );
}

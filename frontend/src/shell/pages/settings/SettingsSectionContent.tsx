import { useState, type ComponentProps, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { easeRowExtras, type EaseValue } from "@/shell/easeRows";
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { getIcon } from "@maipai/ui/src/icons";
import { SettingsRenderer } from "@maipai/ui/src/settings/SettingsRenderer";
import type { BeforeChange } from "@maipai/ui/src/settings/SettingRow";
import { Card as KitCard } from "@maipai/ui/src/dashboard/components/ui/card";
import { cardsInTab, resolveHref, visibleCards, type Card, type Section, type SettingsViewer } from "@maipai/ui/src/settings/settingsAudience";
import { minorVisibleSettingKeys } from "@maipai/home-backend/src/wire";
import { SettingsLinks } from "@/shell/pages/settings/SettingsLinks";
import { SettingsView, type SettingsViewProps } from "@/shell/pages/settings/settingsViews";
import { FaceEnrollmentBody, canViewFaceEnrollment } from "@/apps/people/FaceEnrollmentBody";
import { scopeValueFor, type KitSettingsKey } from "@/shell/pages/settings/settingsViewer";
import { requestBrowserAlertPermission } from "@/shell/BrowserAlerts";
import { Button } from "@maipai/ui/src/ui/button";
import { WebSearchSettings } from "@/shell/pages/settings/WebSearchSettings";
import { usePlaceAdapter } from "@/shell/pages/settings/placeAdapter";
import { useIncognitoContext } from "@/shell/incognitoContext";
import { ClockCardRenderer } from "@/shell/pages/settings/ClockCardRenderer";
import type { PlaceAdapter } from "@maipai/ui/src/settings/LocationField";

/** SEARXNG-SET-05: the keys the Web search block above the Search cards draws itself, so the cards never repeat them. */
const WEB_SEARCH_BLOCK_KEYS = ["search.searxng_url", "search.web_sources", "search.ddgs_for_minors"];
const MINOR_DDGS_ONLY = ["search.ddgs_for_minors"];
const MINOR_DDGS_TITLE = { "household.search": "Teens and children" };

const ChevronDown = getIcon("chevron-down");

/** The per-key hook the renderer runs before a write: turning browser alerts
 * on first asks the browser for permission (the one thing the old settings
 * field did that was not a plain write). Module level, so its identity is
 * stable. */
export const beforeSettingChange: BeforeChange = async (key, value) => {
  if (key === "notifications.browser.enabled" && value) {
    if (typeof Notification === "undefined" || !("serviceWorker" in navigator)) return "This browser cannot show system alerts.";
    if (!(await requestBrowserAlertPermission(() => Notification.requestPermission(), true))) return "Browser permission was not granted, so alerts are off.";
  }
  if (key === "network.hub_port") {
    const port = Number(value);
    return window.confirm(`Home will restart after this is saved. Devices will use maipai.local:${port}. Continue?`)
      ? true
      : "No change was made.";
  }
  if (key === "network.lan_exposure") {
    const reach = value === "loopback" ? "Only this computer will be able to reach Home." : "Devices on your home network will be able to reach Home.";
    return window.confirm(`Home will restart after this is saved. ${reach} Continue?`)
      ? true
      : "No change was made.";
  }
  return true;
};

/** A card that starts folded (`collapsed` in the area): one row to open it. */
function SettingsFold({ label, startOpen, children }: { label: string; startOpen: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(startOpen);
  if (open) return <>{children}</>;
  return (
    <section aria-label={label}>
      <ItemGroup variant="card">
        <Item size="setting" render={<button type="button" aria-expanded={false} onClick={() => setOpen(true)} />}>
          <ItemContent>
            <ItemTitle>{label}</ItemTitle>
          </ItemContent>
          <ItemActions>
            <ChevronDown aria-hidden />
          </ItemActions>
        </Item>
      </ItemGroup>
    </section>
  );
}

/** The Ease of use card: the kit renderer plus summary, lock and way-back data computed from the same values it reads. */
function EaseCardRenderer({ viewingSelf, ...rest }: { viewingSelf: boolean } & Omit<ComponentProps<typeof SettingsRenderer>, "rowExtras">) {
  const queryClient = useQueryClient();
  const values = useQuery({ queryKey: ["settings-values", rest.scopeValue], queryFn: () => api.settingsValues(rest.scopeValue) });
  const resetKeys = (keys: string[]) =>
    // A failed reset leaves the summary line on screen (the refetch shows the truth); it never throws unhandled.
    void Promise.allSettled(keys.map((key) => api.resetSetting(rest.scopeValue, key))).then(() => queryClient.invalidateQueries({ queryKey: ["settings-values", rest.scopeValue] }));
  return <SettingsRenderer {...rest} rowExtras={easeRowExtras((values.data ?? []) as EaseValue[], viewingSelf, resetKeys)} />;
}

function keysCard(card: Card, viewer: SettingsViewer, props: SectionContentProps, returnPath: string, places: Record<"household" | "person", PlaceAdapter>) {
  const group = card.group!;
  const scope = card.scope!;
  const title = card.label;
  const allowed = minorVisibleSettingKeys(viewer.band);
  const ownsWebSearch = props.section.id === "search" && group === "household.search";
  const rendererProps = {
    scope,
    scopeValue: scopeValueFor(scope, props.person.id),
    honouredBy: "home",
    only: [group],
    includeKeys: ownsWebSearch ? props.registry.filter((k) => k.lives_in === group && !WEB_SEARCH_BLOCK_KEYS.includes(k.key)).map((k) => k.key) : allowed ? [...allowed, ...(props.packageKeys ?? [])] : undefined,
    places: scope === "device" ? undefined : places[scope],
    titleOverrides: { [group]: ownsWebSearch ? "Web search rules" : title },
    beforeChange: beforeSettingChange,
    focusKey: props.focusKey,
    matrix: card.matrix,
    includeExpert: props.section.id === "advanced" && props.tab === "network",
  };
  const renderer = group === "profile.ease" ? <EaseCardRenderer viewingSelf={viewer.selfId === props.person.id} {...rendererProps} /> : props.section.id === "clock" ? <ClockCardRenderer {...rendererProps} /> : <SettingsRenderer {...rendererProps} />;
  if (props.section.id === "advanced" && props.tab === "network") return <>{renderer}{group === "household.network" && (viewer.role === "owner" || viewer.role === "admin") ? <Button asChild variant="outline"><Link to="/setup/away" state={{ from: returnPath }}>Set up away access</Link></Button> : null}</>;
  if (!card.collapsed) return renderer;
  const focused = props.focusKey !== undefined && props.registry.some((k) => k.key === props.focusKey && k.lives_in === group && k.scope === scope);
  return (
    <SettingsFold label={card.label} startOpen={focused}>
      {renderer}
    </SettingsFold>
  );
}

export interface SectionContentProps extends SettingsViewProps {
  section: Section;
  viewer: SettingsViewer;
  /** The registry as this viewer's pages may draw it (see visibleRegistry). */
  registry: readonly KitSettingsKey[];
  /** The keys a package settings area draws (see packageAreaKeySet): the person's own, so a minor sees them too. */
  packageKeys?: ReadonlySet<string>;
  focusKey?: string;
  tab?: string;
}

/** One open section: its lead view, its cards in the area's order (a card
 * is a registry group at a scope, or a set of link rows), its trail view.
 * A view section is the view alone. */
export function SettingsSectionContent(props: SectionContentProps) {
  const { section, viewer, registry, person, onPersonChange } = props;
  const location = useLocation();
  const returnPath = `${location.pathname}${location.search}${location.hash}`;
  const viewProps = { person, onPersonChange, tab: props.tab };
  // The place calls (search, save, rename) are made only on a page that draws a location row, and not at all in Incognito.
  const { on: incognito } = useIncognitoContext();
  const drawsPlaces = section.kind === "keys" && (section.cards ?? []).some((card) => registry.some((k) => k.selector === ("location" as string) && k.lives_in === card.group && k.scope === card.scope));
  const places = { household: usePlaceAdapter("household", { enabled: drawsPlaces, incognito }), person: usePlaceAdapter("person", { enabled: drawsPlaces, incognito }) };
  const tabView = section.tabs?.find((item) => item.id === props.tab)?.view;
  if (section.kind === "view") return <>{tabView ? <SettingsView view={tabView} {...viewProps} /> : section.view ? <SettingsView view={section.view} {...viewProps} /> : null}</>;
  // Web search belongs to the Search tab only; the Reference library tab shows its own page and nothing of web search.
  const webSearchBlock = section.id === "search" && !tabView && (viewer.role === "owner" || viewer.role === "admin");
  return (
    <div className="flex min-w-0 flex-col gap-14">
      {webSearchBlock ? <WebSearchSettings minorsControl={<SettingsRenderer scope="household" scopeValue={scopeValueFor("household", props.person.id)} honouredBy="home" only={["household.search"]} includeKeys={MINOR_DDGS_ONLY} titleOverrides={MINOR_DDGS_TITLE} beforeChange={beforeSettingChange} focusKey={props.focusKey} />} /> : null}
      {tabView ? <SettingsView view={tabView} {...viewProps} /> : null}
      {section.lead_view ? <SettingsView view={section.lead_view} {...viewProps} /> : null}
      {cardsInTab(visibleCards(section, viewer, registry, "home"), props.tab).map((card) => {
        // The face card inside `account.data` already draws this group's one
        // key (the enrollment sounds switch); a second card would repeat it.
        if (section.id === "profile" && card.group === "person.profile") return null;
        // Same for the voice page: its lead view (account.voice) is the one dropdown bound to tts.voice_id, so the
        // registry row for that key is not drawn here (the key stays in the registry for other surfaces).
        if (section.id === "voice" && card.group === "person.voice") return null;
        if (card.view) return <SettingsView key={`${card.scope}:${card.group ?? card.label}`} view={card.view} card={card} {...viewProps} />;
        if (card.links) return <SettingsLinks key={card.label} label={card.label} links={card.links.map((link) => ({ label: link.label, href: resolveHref(link.href, viewer) }))} />;
        return <div key={`${card.scope}:${card.group}`}>
          {incognito && drawsPlaces ? <p className="text-sm text-muted-foreground">Incognito is on, so places cannot be added or renamed until you turn it off.</p> : null}
{keysCard(card, viewer, props, returnPath, places)}</div>;
      })}
      {section.trail_view && (section.view_tab === undefined || section.view_tab === props.tab) ? <SettingsView view={section.trail_view} {...viewProps} /> : null}
      {section.id === "data" && canViewFaceEnrollment(person, person) ? <KitCard><FaceEnrollmentBody profile={person} viewer={person} /></KitCard> : null}
    </div>
  );
}

import { useState, type ComponentProps, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { easeRowExtras, type EaseValue } from "@/shell/easeRows";
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { getIcon } from "@maipai/ui/src/icons";
import { SettingsRenderer } from "@maipai/ui/src/settings/SettingsRenderer";
import type { BeforeChange } from "@maipai/ui/src/settings/SettingRow";
import { resolveHref, visibleCards, type Card, type Section, type SettingsViewer } from "@maipai/ui/src/settings/settingsAudience";
import { minorVisibleSettingKeys } from "@maipai/home-backend/src/wire";
import { SettingsLinks } from "@/shell/pages/settings/SettingsLinks";
import { SettingsView, type SettingsViewProps } from "@/shell/pages/settings/settingsViews";
import { scopeValueFor, type KitSettingsKey } from "@/shell/pages/settings/settingsViewer";
import { requestBrowserAlertPermission } from "@/shell/BrowserAlerts";
import { Button } from "@maipai/ui/src/ui/button";

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

function keysCard(card: Card, viewer: SettingsViewer, props: SectionContentProps, returnPath: string) {
  const group = card.group!;
  const scope = card.scope!;
  const title = props.section.id === "voice" && group === "person.voice" ? "Speaking voice" : card.label;
  const allowed = minorVisibleSettingKeys(viewer.band);
  const rendererProps = {
    scope,
    scopeValue: scopeValueFor(scope, props.person.id),
    honouredBy: "home",
    only: [group],
    includeKeys: allowed ? [...allowed] : undefined,
    titleOverrides: { [group]: title },
    beforeChange: beforeSettingChange,
    focusKey: props.focusKey,
    matrix: card.matrix,
    includeExpert: props.section.id === "network",
  };
  const renderer = group === "profile.ease" ? <EaseCardRenderer viewingSelf={viewer.selfId === props.person.id} {...rendererProps} /> : <SettingsRenderer {...rendererProps} />;
  if (props.section.id === "network") return <>{renderer}{viewer.role === "owner" || viewer.role === "admin" ? <Button asChild variant="outline"><Link to="/setup/away" state={{ from: returnPath }}>Set up away access</Link></Button> : null}</>;
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
  focusKey?: string;
}

/** One open section: its lead view, its cards in the area's order (a card
 * is a registry group at a scope, or a set of link rows), its trail view.
 * A view section is the view alone. */
export function SettingsSectionContent(props: SectionContentProps) {
  const { section, viewer, registry, person, onPersonChange } = props;
  const location = useLocation();
  const returnPath = `${location.pathname}${location.search}${location.hash}`;
  const viewProps = { person, onPersonChange };
  if (section.kind === "view") return <>{section.view ? <SettingsView view={section.view} {...viewProps} /> : null}</>;
  return (
    <div className="flex min-w-0 flex-col gap-14">
      {section.lead_view ? <SettingsView view={section.lead_view} {...viewProps} /> : null}
      {visibleCards(section, viewer, registry, "home").map((card) => {
        // Until APP-SET-05 re-points the face card onto the kit renderer, the
        // face card inside `account.profile` already draws this group's one
        // key (the enrollment sounds switch); a second card would repeat it.
        if (section.id === "profile" && card.group === "person.profile") return null;
        if (card.links) return <SettingsLinks key={card.label} label={card.label} links={card.links.map((link) => ({ label: link.label, href: resolveHref(link.href, viewer) }))} />;
        return <div key={`${card.scope}:${card.group}`}>{keysCard(card, viewer, props, returnPath)}</div>;
      })}
      {section.trail_view ? <SettingsView view={section.trail_view} {...viewProps} /> : null}
    </div>
  );
}

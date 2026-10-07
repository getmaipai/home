import { useState, type ReactNode } from "react";
import type { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { getIcon } from "@maipai/ui/src/icons";
import { SettingsRenderer } from "@maipai/ui/src/settings/SettingsRenderer";
import type { BeforeChange } from "@maipai/ui/src/settings/SettingRow";
import { resolveHref, visibleCards, type Card, type Section, type SettingsViewer } from "@maipai/ui/src/settings/settingsAudience";
import { minorVisibleSettingKeys } from "@maipai/home-backend/src/wire";
import { SettingsLinks } from "@/shell/pages/settings/SettingsLinks";
import { SettingsView, type SettingsViewProps } from "@/shell/pages/settings/settingsViews";
import { scopeValueFor } from "@/shell/pages/settings/settingsViewer";
import { requestBrowserAlertPermission } from "@/shell/BrowserAlerts";

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

function keysCard(card: Card, viewer: SettingsViewer, props: SectionContentProps) {
  const group = card.group!;
  const scope = card.scope!;
  const title = props.section.id === "voice" && group === "person.voice" ? "Speaking voice" : card.label;
  const allowed = minorVisibleSettingKeys(viewer.band);
  const renderer = (
    <SettingsRenderer
      scope={scope}
      scopeValue={scopeValueFor(scope, props.person.id)}
      honouredBy="home"
      only={[group]}
      includeKeys={allowed ? [...allowed] : undefined}
      titleOverrides={{ [group]: title }}
      beforeChange={beforeSettingChange}
      focusKey={props.focusKey}
    />
  );
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
  registry: readonly SettingsKey[];
  focusKey?: string;
}

/** One open section: its lead view, its cards in the area's order (a card
 * is a registry group at a scope, or a set of link rows), its trail view.
 * A view section is the view alone. */
export function SettingsSectionContent(props: SectionContentProps) {
  const { section, viewer, registry, person, onPersonChange } = props;
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
        return <div key={`${card.scope}:${card.group}`}>{keysCard(card, viewer, props)}</div>;
      })}
      {section.trail_view ? <SettingsView view={section.trail_view} {...viewProps} /> : null}
    </div>
  );
}

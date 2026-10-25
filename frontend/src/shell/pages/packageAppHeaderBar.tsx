import { useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { getIcon, iconNames } from "@maipai/ui/src/icons";

// On a phone the shell already draws a bar across the top (the menu button's band). A package app puts its name and its settings
// button in that bar instead of in a row of its own, so the stories start a whole row higher. The bar's
// content is a stable component (useHeaderExtra's rule), so the page publishes what it shows through this small store.
export interface PackageAppHeaderState {
  to: string;
  label: string;
  settingsArea?: string;
}

let current: PackageAppHeaderState | null = null;
const listeners = new Set<() => void>();

export function publishPackageAppHeader(next: PackageAppHeaderState | null): void {
  const same = current === next || (current !== null && next !== null && current.to === next.to && current.label === next.label && current.settingsArea === next.settingsArea);
  if (same) return;
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function snapshot(): PackageAppHeaderState | null {
  return current;
}

const GearIcon = getIcon("settings");

export function PackageAppHeaderBar() {
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  if (!state) return null;
  return <Bar state={state} />;
}

function Bar({ state }: { state: PackageAppHeaderState }) {
  return (
    <div data-slot="app-header-bar" className="flex min-w-0 flex-1 items-center gap-1">
      <span className="min-w-0 flex-1 truncate text-base font-semibold">{state.label}</span>
      {state.settingsArea ? (
        <Button variant="ghost" size="icon-lg" render={<Link to={`/settings/${state.settingsArea}`} aria-label={`${state.label} settings`} />}>
          <GearIcon aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
}

// The sections of an app as the kit's phone bar entries (phone-minimal-2026-10-25 P2): the app's own index first (active only on its
// own address), then each section, and a trailing Search item when the app has a search page. An icon the hub did not name falls back
// to one of the kit's own.
const SECTION_ICONS: Record<string, string> = { mix: "sparkles", following: "heart", saved: "bookmark", library: "folder", history: "history", "watch-later": "clock", search: "search", channel: "layout-grid" };
const iconOrNull = (name: string | null | undefined): string | null => (name && (iconNames as string[]).includes(name) ? name : null);
export interface SectionsBarEntries {
  entries: Array<{ to: string; icon: string; label: string; exact?: boolean }>;
  trailing?: { to: string; icon: string; label: string };
}
export function sectionsBarEntries(app: { to: string; icon?: string | null; sections: ReadonlyArray<{ page: string; label: string; icon?: string | null }> }, homeLabel: string, hasSearchPage: boolean): SectionsBarEntries {
  const entries = [
    { to: app.to, icon: iconOrNull(app.icon) ?? "layout-grid", label: homeLabel, exact: true },
    ...app.sections.filter((section) => section.page !== "search").map((section) => ({ to: `${app.to}/${section.page}`, icon: SECTION_ICONS[section.page] ?? iconOrNull(section.icon) ?? "layout-grid", label: section.label })),
  ];
  return hasSearchPage ? { entries, trailing: { to: `${app.to}/search`, icon: "search", label: "Search" } } : { entries };
}

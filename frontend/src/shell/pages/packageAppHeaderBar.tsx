import { useSyncExternalStore } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { getIcon } from "@maipai/ui/src/icons";
import { iconNames } from "@maipai/ui/src/icons";

// Package app pages publish their title and header action data here for the stable components
// registered with useHeaderExtra. The shell header renders them beside the companion avatar.
export interface PackageAppHeaderState {
  to: string;
  label: string;
  title?: string;
  settingsArea?: string;
}

let current: PackageAppHeaderState | null = null;
const listeners = new Set<() => void>();

export function publishPackageAppHeader(next: PackageAppHeaderState | null): void {
  const same = current === next || (current !== null && next !== null && current.to === next.to && current.label === next.label && current.title === next.title && current.settingsArea === next.settingsArea);
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

export function PackageAppHeaderActions() {
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  const navigate = useNavigate();
  if (!state?.settingsArea) return null;
  return <><Button type="button" variant="ghost" size="icon-lg" aria-label={`${state.label} settings`} onClick={() => navigate(`/settings/${state.settingsArea}`)}><GearIcon aria-hidden="true" /></Button></>;
}

// The sections of an app as the kit's phone bar entries (phone-minimal-2026-10-25 P2): the app's own index first (active only on its
// own address), then each section, and a trailing Search item when the app has a search page. An icon the hub did not name falls back
// to one of the kit's own.
const SECTION_ICONS: Record<string, string> = { mix: "sparkles", following: "heart", saved: "bookmark", library: "folder", history: "history", "watch-later": "clock", search: "search", channel: "layout-grid", albums: "disc-3", artists: "mic-vocal", songs: "music", playlists: "list-music" };
// An app whose own icon is also a section's icon (Music: the note is Songs) names its index tab differently.
const HOME_ICONS: Record<string, string> = { "/apps/music": "headphones" };
const iconOrNull = (name: string | null | undefined): string | null => (name && (iconNames as string[]).includes(name) ? name : null);
export interface SectionsBarEntries {
  entries: Array<{ to: string; icon: string; label: string; exact?: boolean }>;
  trailing?: { to: string; icon: string; label: string };
  more: Array<{ to: string; icon: string; label: string }>;
}
export function sectionsBarEntries(app: { to: string; label?: string; icon?: string | null; settings_area?: { id: string } | null; sections: ReadonlyArray<{ page: string; label: string; icon?: string | null }> }, homeLabel: string, hasSearchPage: boolean): SectionsBarEntries {
  const entries = [
    { to: app.to, icon: HOME_ICONS[app.to] ?? iconOrNull(app.icon) ?? "layout-grid", label: homeLabel, exact: true },
    ...app.sections.filter((section) => section.page !== "search").map((section) => ({ to: `${app.to}/${section.page}`, icon: SECTION_ICONS[section.page] ?? iconOrNull(section.icon) ?? "layout-grid", label: section.label })),
  ];
  // The last item is always the three-dot More button: the app's settings live under it, with anything that did not fit.
  const more = app.settings_area?.id ? [{ to: `/settings/${app.settings_area.id}`, icon: "settings", label: `${app.label ?? "App"} settings` }] : [];
  return hasSearchPage ? { entries, trailing: { to: `${app.to}/search`, icon: "search", label: "Search" }, more } : { entries, more };
}

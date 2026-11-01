import { useMemo, useSyncExternalStore } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@maipai/ui/src/dashboard/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@maipai/ui/src/dashboard/components/ui/tabs";
import HeaderSearch, { type SearchGroup } from "@maipai/ui/src/dashboard/layouts/full/vertical/header/HeaderSearch";
import type { AppRow } from "@/lib/api";
import { navigateOf } from "@/shell/useAppSidebar";
import { PageHeaderTitle } from "@/shell/pageHeaderTitle";
import { getIcon } from "@maipai/ui/src/icons";
import { iconNames } from "@maipai/ui/src/icons";

// Package app pages publish their title and header action data here for the stable components
// registered with useHeaderExtra. The shell header renders them beside the companion avatar.
export interface PackageAppHeaderState {
  to: string;
  label: string;
  title?: string;
  settingsArea?: string;
  /** MEDIA-HEADER-01: the app's own header buttons, the mode in force and where a search goes. */
  header?: AppRow["header"];
  mode?: string;
  onMode?: (id: string) => void;
  searchTo?: string;
}

let current: PackageAppHeaderState | null = null;
const listeners = new Set<() => void>();

export function publishPackageAppHeader(next: PackageAppHeaderState | null): void {
  const same = current === next || (current !== null && next !== null && current.to === next.to && current.label === next.label && current.title === next.title && current.settingsArea === next.settingsArea && current.header === next.header && current.mode === next.mode && current.onMode === next.onMode && current.searchTo === next.searchTo);
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
const MoreIcon = getIcon("more-horizontal");

/** The app's own search: one row that opens the app's search page for the typed words. The palette lists nothing of the shell. */
function AppSearch({ label, searchTo }: { label: string; searchTo: string }) {
  const remote = useMemo(() => async (query: string): Promise<SearchGroup[]> => [{
    kind: "app",
    heading: label,
    results: [{ kind: "app", id: "search", title: `Search ${label} for "${query.trim()}"`, href: `${searchTo}?q=${encodeURIComponent(query.trim())}` }],
  }], [label, searchTo]);
  return <HeaderSearch scope={{ label }} remote={remote} />;
}

/** The app's search and mode switch, centred in the free space between the title and the buttons. Registered in the header's left slot
 * (after the title) because that group is the one that grows; the right group only holds what sits beside the avatar. */
function PackageAppHeaderCenter() {
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  if (!state) return null;
  const { header } = state;
  const modes = header?.modes ?? [];
  return (
    <div className="flex min-w-0 flex-1 items-center justify-center gap-3" data-testid="app-header-center">
      {header?.search && state.searchTo ? <AppSearch label={state.label} searchTo={state.searchTo} /> : null}
      {modes.length > 1 && state.mode ? (
        <Tabs value={state.mode} onValueChange={(value) => state.onMode?.(String(value))}>
          <TabsList variant="pill" aria-label={`${state.label} mode`}>
            {modes.map((mode) => <TabsTrigger key={mode.id} value={mode.id}>{mode.label}</TabsTrigger>)}
          </TabsList>
        </Tabs>
      ) : null}
    </div>
  );
}

/** The header's left slot for a package app: the page title, then the centred search and modes. */
export function PackageAppHeaderLeft() {
  return <><PageHeaderTitle /><PackageAppHeaderCenter /></>;
}

export function PackageAppHeaderActions() {
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  const navigate = useNavigate();
  if (!state) return null;
  const { header } = state;
  const open = (action: unknown) => { const target = navigateOf(action); if (target) navigate(target.to, { state: { pageState: target.state } }); };
  const primary = header?.actions?.primary;
  const more = header?.actions?.more ?? [];
  return <>
    {primary ? <Button type="button" onClick={() => open(primary.open)}>{primary.label}</Button> : null}
    {more.length > 0 ? (
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-lg" aria-label={`More ${state.label} actions`} />}><MoreIcon aria-hidden="true" /></DropdownMenuTrigger>
        <DropdownMenuContent align="end">{more.map((item) => <DropdownMenuItem key={item.label} onSelect={() => open(item.open)}>{item.label}</DropdownMenuItem>)}</DropdownMenuContent>
      </DropdownMenu>
    ) : null}
    {state.settingsArea ? <Button type="button" variant="ghost" size="icon-lg" aria-label={`${state.label} settings`} onClick={() => navigate(`/settings/${state.settingsArea}`)}><GearIcon aria-hidden="true" /></Button> : null}
  </>;
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

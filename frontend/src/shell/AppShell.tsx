import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Shell } from "@maipai/ui/src/Shell";
import type { NavGroup } from "@maipai/ui/src/blocks/dashboard/components/nav-main";
import { ungroupedNav } from "@maipai/ui/src/blocks/dashboard/components/app-sidebar";
import { SidebarMenu, SidebarMenuItem, SidebarMenuButton } from "@maipai/ui/src/ui/sidebar";
import { isActiveNavPath } from "@maipai/ui/src/nav";
import { getIcon } from "@maipai/ui/src/icons";
import { Button } from "@maipai/ui/src/ui/button";
import { NAV_ENTRIES } from "@/shell/nav";
import { APP_CATALOG, favoriteApps } from "@/shell/appCatalog";
import { usePinnedApps } from "@/shell/usePinnedApps";
import { useAppearance } from "@/shell/useAppearance";
import { NotificationBell } from "@/shell/NotificationBell";
import { ProfileSwitcher } from "@/shell/ProfileSwitcher";
import { useSearchCommand } from "@/shell/search/useSearchCommand";
import type { SearchResultItem } from "@/shell/search/providers";
import type { Roster } from "@/lib/api";
import type { ReactNode } from "react";

interface AppShellProps {
  person: Roster;
  onSignOut: () => void;
  onPersonChange: () => Promise<void>;
  children: ReactNode;
}

/** The pin/unpin control for "each app's header" (docs/BACKLOG.md's
 * home-screen item, step 6) - the current page's own entry in the app
 * catalog, or nothing on Home itself (`/`), which has nothing to pin. */
function PinToggle({ person }: { person: Roster }) {
  const location = useLocation();
  const { isPinned, togglePin, isLoading, isSaving } = usePinnedApps(person.id);
  const entry = APP_CATALOG.find((e) => e.to !== "/" && isActiveNavPath(location.pathname, e.to));
  if (!entry || isLoading) return null;
  const pinned = isPinned(entry.to);
  const Icon = getIcon(pinned ? "pin-off" : "pin");
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      disabled={isSaving}
      aria-pressed={pinned}
      aria-label={pinned ? `Unpin ${entry.label}` : `Pin ${entry.label}`}
      onClick={() => togglePin(entry.to)}
    >
      <Icon aria-hidden />
    </Button>
  );
}

function Brand() {
  return (
    // min-h-12/min-w-12 (48px): docs/UI.md's touch-target floor - this is
    // a real link home, whose row is otherwise only as tall as its
    // content (~32px), and whose parent SidebarMenuButton goes
    // `flex-none` (shrinks to just the icon's own width) once the rail
    // collapses to icons - min-w-12 keeps the link itself a real 48px
    // square there instead of a 32px-wide sliver (found by the tablet
    // a11y sweep, whose rail collapses to icons by default).
    <Link to="/" aria-label="MaiPai Home" className="flex min-h-12 min-w-12 flex-1 items-center gap-2.5">
      <span className="flex size-8 shrink-0 items-center justify-center">
        <img src="/brand/maipai-home-icon-light.png" alt="" className="size-8 object-contain brand-logo-light" />
        <img src="/brand/maipai-home-icon-dark.png" alt="" className="size-8 object-contain brand-logo-dark" />
      </span>
      <span className="text-base font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
        MaiPai <span className="text-primary">Home</span>
      </span>
    </Link>
  );
}

/** A footer nav row, matching NAV_ENTRIES' own active-highlight rule
 * (isActiveNavPath) - AppSidebar computes this automatically for the
 * `nav` prop's own groups, but the footer slot is arbitrary ReactNode,
 * so it has to be done here too. */
function FooterNavItem({ to, icon, label }: { to: string; icon: string; label: string }) {
  const location = useLocation();
  const Icon = getIcon(icon);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActiveNavPath(location.pathname, to)} tooltip={label}>
        <Link to={to} aria-label={label}>
          <Icon aria-hidden />
          <span>{label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/** Home's own wiring around the kit's Shell contract (docs/UI.md): the
 * kit owns the rail/phone-bar/header layout and the search dialog, Home
 * supplies its brand, nav data, Favorites, and the header's own actions
 * (PinToggle, NotificationBell, ProfileSwitcher) - "the kit gets a slot,
 * Home keeps the feature." The kit's own header search button (ui-v0.1.2)
 * covers touch/phone reachability; Cmd/Ctrl+K and HomePage's own inline
 * prompt box remain as additional entry points, and the sidebar's old
 * dedicated "Search" row (a fourth) is the only one actually gone.
 *
 * Known gap, tracked not dropped (docs/BACKLOG.md): the kit's Shell has
 * no TV-focusable rail yet (the arrow-key/remote nav the old hand-built
 * Shell.tsx had via `@noriginmedia/norigin-spatial-navigation`) - a
 * shared/ui follow-up, not one of the five features the owner's ruling
 * protected.
 */
export function AppShell({ person, onSignOut, onPersonChange, children }: AppShellProps) {
  useAppearance(person.id);
  const navigate = useNavigate();
  const { pinned } = usePinnedApps(person.id);
  const favorites = favoriteApps(pinned).filter((app) => app.to !== "/chat" && app.to !== "/settings" && app.to !== "/privacy").slice(0, 6);

  const [query, setQuery] = useState("");
  const { visibleGroups } = useSearchCommand(person.id, query, true);

  function selectSearchResult(item: SearchResultItem) {
    navigate(item.to, item.state ? { state: item.state } : undefined);
  }
  function askMaiPai(q: string) {
    navigate("/chat", { state: { initialText: q } });
  }

  const mainEntries = NAV_ENTRIES.filter((entry) => ["/", "/apps", "/chat"].includes(entry.to));
  const groups: NavGroup[] = [
    ...ungroupedNav(mainEntries, "Navigation"),
    ...(favorites.length > 0 ? ungroupedNav(favorites, "Favorites") : []),
  ];
  const footerEntries = NAV_ENTRIES.filter((entry) => entry.to === "/privacy" || entry.to === "/settings");

  return (
    <Shell
      nav={groups}
      brand={<Brand />}
      railStorageKey="maipai-home:shell-rail"
      sidebarFooter={
        <SidebarMenu>
          {footerEntries.map((entry) => (
            <FooterNavItem key={entry.to} to={entry.to} icon={entry.icon} label={entry.label} />
          ))}
        </SidebarMenu>
      }
      headerActions={
        <>
          <PinToggle person={person} />
          <NotificationBell />
          <ProfileSwitcher person={person} onSwitched={onPersonChange} onSignOut={onSignOut} />
        </>
      }
      search={{
        groups: visibleGroups,
        query,
        onQueryChange: setQuery,
        onSelect: selectSearchResult,
        onAsk: askMaiPai,
        askLabel: "Ask MaiPai",
        placeholder: "Search, or ask MaiPai...",
      }}
    >
      {children}
    </Shell>
  );
}

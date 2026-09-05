import type { ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useFocusable } from "@noriginmedia/norigin-spatial-navigation";
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarRail,
  SidebarTrigger,
} from "@/kit/ui/sidebar";
import { NotificationBell } from "@/shell/NotificationBell";
import { ProfileSwitcher } from "@/shell/ProfileSwitcher";
import { PhoneNav } from "@/shell/PhoneNav";
import { NAV_ENTRIES, type NavEntry } from "@/shell/nav";
import { useSurface } from "@/kit/useSurface";
import { useAppearance } from "@/shell/useAppearance";
import { ensureTvNavInit } from "@/shell/tvNav";
import { getIcon } from "@/kit/icons";
import { cn } from "@/kit/utils";
import type { Roster } from "@/lib/api";

interface ShellProps {
  person: Roster;
  onSignOut: () => void;
  onPersonChange: () => Promise<void>;
  children: ReactNode;
}

function isActivePath(pathname: string, to: string): boolean {
  return to === "/" ? pathname === "/" : pathname.startsWith(to);
}

function navItemContent(entry: NavEntry, active: boolean) {
  const Icon = getIcon(entry.icon);
  return (
    <SidebarMenuButton asChild isActive={active} tooltip={entry.label}>
      {/* aria-label, not just the visible span: icon-collapsed hides the
          label with CSS (the fix for the earlier clipped-sliver bug
          above), and a display:none element contributes nothing to the
          accessible name, silently unnaming every link the moment
          someone collapses the sidebar - the exact class of bug the
          accessibility pass (2026-09-05) already fixed once on the
          pre-shadcn nav rail, caught here by a code review rather than a
          live pass this time. */}
      <NavLink to={entry.to} end={entry.to === "/"} aria-label={entry.label}>
        <Icon aria-hidden />
        <span>{entry.label}</span>
      </NavLink>
    </SidebarMenuButton>
  );
}

/** The plain nav row: no `@noriginmedia/norigin-spatial-navigation`
 * involvement at all. Kept as a separate component from `TvNavItem`
 * (not one component calling `useFocusable` conditionally) because the
 * library's service has to be `init()`-ed before any `useFocusable()`
 * call is safe, and `init()` is only ever called on the TV surface
 * (below) - it globally hijacks arrow keys, which would break arrow-key
 * text editing in every input/textarea on every other surface. React's
 * rules of hooks forbid calling a hook conditionally within one
 * component, so the split happens one level up instead (`far` picks
 * which component renders, via a `key` that forces a clean remount if it
 * ever changes mid-session). */
function NavItem({ entry }: { entry: NavEntry }) {
  const location = useLocation();
  const active = isActivePath(location.pathname, entry.to);
  return <SidebarMenuItem>{navItemContent(entry, active)}</SidebarMenuItem>;
}

/** The TV nav row: real arrow-key/remote focus via `useFocusable`, only
 * ever mounted once `ensureTvNavInit()` has run (below), so its internal
 * `layoutAdapter` already exists - calling `useFocusable()` before
 * `init()` throws (found live: "Cannot read properties of undefined
 * (reading 'measureLayout')").
 *
 * `forceFocus` on the first item only: the library's own docs are
 * explicit that a real app has to "set the initial focus" itself -
 * nothing is focused by default, so arrow keys had nowhere to move from
 * without this (found live: `init()` alone was not enough). */
function TvNavItem({ entry, isFirst }: { entry: NavEntry; isFirst: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { ref, focused } = useFocusable<HTMLDivElement>({
    onEnterPress: () => navigate(entry.to),
    forceFocus: isFirst,
  });
  const active = isActivePath(location.pathname, entry.to);

  return (
    <SidebarMenuItem>
      <div ref={ref} className={cn(focused && "rounded-md ring-2 ring-ring")}>
        {navItemContent(entry, active)}
      </div>
    </SidebarMenuItem>
  );
}

// docs/UI.md's shell contract: "the platform owns all chrome... a
// package never writes its own chrome." A header (wordmark, notification
// bell, profile switcher) plus a nav that renders three different ways
// per surface (docs/plans/session-b-ui.md step 2): shadcn's Sidebar on
// tablet/desktop (collapsible to icons, the person's own choice - never
// the default, since `SidebarProvider`'s own `defaultOpen` already
// defaults to expanded), a five-entry bottom bar on phone (`PhoneNav`),
// and the same Sidebar again on TV, driven by real arrow-key/remote
// focus (`useFocusable`) instead of hover or a pointer.
//
// Still deferred, one-line each (full list in docs/dev.md): the right
// pane, the command palette, a settings/admin modal (Settings is a full
// page tonight), breadcrumbs, and the player bar - none of chapter 6's
// content exists yet for any of them to attach to.
export function Shell({ person, onSignOut, onPersonChange, children }: ShellProps) {
  const surface = useSurface();
  useAppearance(person.id);

  // Called during render, not inside a `useEffect`: React runs a child's
  // effects before its parent's, and `TvNavItem` below calls
  // `useFocusable()` the moment it mounts - if `ensureTvNavInit()` ran in
  // an effect here, it could still lose that race the first time `far`
  // becomes true. The function is idempotent (a module-level guard), so
  // calling it unconditionally on every render of every surface is cheap.
  if (surface.far) ensureTvNavInit();

  return (
    <SidebarProvider>
      {/* Sidebar and SidebarInset are meant to be direct siblings of
          SidebarProvider (its own generated CSS positions Sidebar with
          `fixed inset-y-0`, viewport-relative): a header rendered outside
          this pair, as this file's first draft had it, sat behind the
          sidebar's fixed layer and was unclickable near the edge - found
          live, not by any test, since jsdom never lays anything out. */}
      <Sidebar collapsible="icon" className="hidden sm:flex">
        <SidebarHeader />
        <SidebarContent>
          {/* Keyed by `far`: if the surface flips mid-session (a gamepad
              connects), the whole list remounts as the other component
              rather than any single item conditionally changing which
              hooks it calls. */}
          <SidebarMenu key={surface.far ? "tv" : "standard"}>
            {surface.far
              ? NAV_ENTRIES.map((entry, i) => <TvNavItem key={entry.to} entry={entry} isFirst={i === 0} />)
              : NAV_ENTRIES.map((entry) => <NavItem key={entry.to} entry={entry} />)}
          </SidebarMenu>
        </SidebarContent>
        <SidebarRail />
      </Sidebar>
      <SidebarInset className={cn(surface.far && "surface-far")}>
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-4">
          <div className="flex items-center gap-3">
            {/* Collapsing to icons is the person's own choice, never the
                default (docs/plans/session-b-ui.md step 2) - this is that
                choice's one control. Phone has no sidebar to collapse. */}
            <SidebarTrigger className="hidden sm:inline-flex" />
            <img src="/brand/maipai-home-logo-light.png" alt="MaiPai Home" className="h-7 w-auto brand-logo-light" />
            <img src="/brand/maipai-home-logo-dark.png" alt="MaiPai Home" className="h-7 w-auto brand-logo-dark" />
          </div>
          <div className="flex items-center gap-1">
            <NotificationBell />
            <ProfileSwitcher person={person} onSwitched={onPersonChange} onSignOut={onSignOut} />
          </div>
        </header>
        {/* `min-w-0` is load-bearing, not tidiness: a flex item defaults to
            min-width:auto, so without it this column cannot shrink below
            its widest child and one wide settings row pushed the whole
            page to 510px inside a 390px phone viewport. Found by the
            accessibility pass, 2026-09-05; docs/UI.md counts anything
            wider than the viewport as a failure. The bottom padding on
            phone clears PhoneNav's fixed bar. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col pb-16 sm:pb-0">{children}</div>
        <PhoneNav />
      </SidebarInset>
    </SidebarProvider>
  );
}

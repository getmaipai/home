import { useEffect, type ReactNode } from "react";
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

/** One nav row. Always calls `useFocusable` (React's rules of hooks -
 * conditionally calling it only when `far` would break on every other
 * surface); its `focused` state only ever drives styling when the TV
 * surface actually initialized the spatial-navigation service, so a
 * mouse/touch/keyboard surface never notices it exists.
 *
 * `forceFocus` on the first item only: the library's own docs are
 * explicit that a real app has to "set the initial focus" itself -
 * nothing is focused by default, so arrow keys had nowhere to move from
 * without this (found live: `init()` alone was not enough). */
function NavItem({ entry, far, isFirst }: { entry: NavEntry; far: boolean; isFirst: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { ref, focused } = useFocusable<HTMLDivElement>({
    onEnterPress: () => navigate(entry.to),
    forceFocus: far && isFirst,
  });
  const Icon = getIcon(entry.icon);
  const active = isActivePath(location.pathname, entry.to);

  return (
    <SidebarMenuItem>
      <div ref={ref}>
        <SidebarMenuButton
          asChild
          isActive={active}
          tooltip={entry.label}
          className={cn(far && focused && "ring-2 ring-ring")}
        >
          {/* aria-label, not just the visible span: icon-collapsed hides
              the label with CSS (the fix for the earlier clipped-sliver
              bug above), and a display:none element contributes nothing
              to the accessible name, silently unnaming every link the
              moment someone collapses the sidebar - the exact class of
              bug the accessibility pass (2026-09-05) already fixed once
              on the pre-shadcn nav rail, caught here by a code review
              rather than a live pass this time. */}
          <NavLink to={entry.to} end={entry.to === "/"} aria-label={entry.label}>
            <Icon aria-hidden />
            <span>{entry.label}</span>
          </NavLink>
        </SidebarMenuButton>
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

  useEffect(() => {
    if (surface.far) ensureTvNavInit();
  }, [surface.far]);

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
          <SidebarMenu>
            {NAV_ENTRIES.map((entry, i) => (
              <NavItem key={entry.to} entry={entry} far={surface.far} isFirst={i === 0} />
            ))}
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

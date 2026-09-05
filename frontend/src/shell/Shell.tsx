import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { Avatar } from "@/kit/components/Avatar";
import { Button } from "@/kit/components/Button";
import { getIcon } from "@/kit/icons";
import { cn } from "@/kit/utils";
import type { Roster } from "@/lib/api";

interface ShellProps {
  person: Roster;
  onSignOut: () => void;
  children: ReactNode;
}

// docs/UI.md's real nav blueprint (a package declares {to, icon, label},
// the shell owns rendering it) doesn't exist yet - no manifest field for
// it, no package-loading system to read one from. This is that shape by
// hand, for the pages that exist; becomes data-driven the moment a
// fifth package needs to add an entry without editing this file.
const NAV_ENTRIES = [
  { to: "/", icon: "message-circle", label: "Chat" },
  { to: "/people", icon: "users", label: "People" },
  { to: "/memory", icon: "brain", label: "Memory" },
  { to: "/privacy", icon: "shield-check", label: "Privacy" },
  { to: "/settings", icon: "settings", label: "Settings" },
] as const;

// docs/UI.md > the shell contract: "the platform owns all chrome... a
// package never writes its own chrome." Tonight's real minimum: a top
// bar (wordmark, signed-in person, sign out) and a nav rail with real
// routing between the two pages that exist. Deferred, one-line each
// (full list in docs/dev.md): the right pane, command palette, a
// settings/admin modal (Settings is a full page tonight, not the
// gear-in-header sheet docs/SETTINGS.md describes), breadcrumbs, toasts,
// the player bar, and the phone/TV per-surface chrome adaptation (bottom
// bar, focusable rail) - nothing has been tested at those surfaces yet.
export function Shell({ person, onSignOut, children }: ShellProps) {
  const LogOutIcon = getIcon("log-out");

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-[hsl(var(--border))] px-4">
        <img src="/brand/maipai-home-logo-light.png" alt="MaiPai Home" className="h-7 w-auto brand-logo-light" />
        <img src="/brand/maipai-home-logo-dark.png" alt="MaiPai Home" className="h-7 w-auto brand-logo-dark" />
        <div className="flex items-center gap-3">
          <Avatar name={person.display_name} className="h-9 w-9 text-sm" />
          <span className="hidden text-sm sm:inline">{person.display_name}</span>
          <Button variant="ghost" size="icon" onClick={onSignOut} aria-label="Sign out">
            <LogOutIcon className="h-5 w-5" aria-hidden />
          </Button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-[hsl(var(--border))] py-3 sm:w-48 sm:items-stretch sm:px-2">
          {NAV_ENTRIES.map((entry) => {
            const Icon = getIcon(entry.icon);
            return (
              <NavLink
                key={entry.to}
                to={entry.to}
                end={entry.to === "/"}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-[var(--radius)] px-3 py-2 sm:justify-start",
                    isActive ? "bg-[hsl(var(--muted))]" : "hover:bg-[hsl(var(--muted))]",
                  )
                }
              >
                <Icon className="h-5 w-5 shrink-0" aria-hidden />
                <span className="hidden sm:inline">{entry.label}</span>
              </NavLink>
            );
          })}
        </nav>
        <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}

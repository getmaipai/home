import type { ReactNode } from "react";
import { Avatar } from "@/kit/components/Avatar";
import { Button } from "@/kit/components/Button";
import { getIcon } from "@/kit/icons";
import type { Roster } from "@/lib/api";

interface ShellProps {
  person: Roster;
  onSignOut: () => void;
  children: ReactNode;
}

// docs/UI.md > the shell contract: "the platform owns all chrome... a
// package never writes its own chrome." Tonight's real minimum: a top
// bar (wordmark, signed-in person, sign out) and a nav rail with the one
// entry that exists. Deferred, one-line each (full list in docs/dev.md):
// the right pane, command palette, settings/admin modals, breadcrumbs,
// toasts, player bar, and the phone/TV per-surface chrome adaptation
// (bottom bar, focusable rail). There is exactly one app and one
// surface tonight, so none of that has anything to adapt yet.
export function Shell({ person, onSignOut, children }: ShellProps) {
  const LogOutIcon = getIcon("log-out");
  const ChatIcon = getIcon("message-circle");

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
          <div className="flex items-center gap-3 rounded-[var(--radius)] bg-[hsl(var(--muted))] px-3 py-2 sm:justify-start">
            <ChatIcon className="h-5 w-5 shrink-0" aria-hidden />
            <span className="hidden sm:inline">Chat</span>
          </div>
        </nav>
        <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}

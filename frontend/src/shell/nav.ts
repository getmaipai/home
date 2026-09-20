import type { NavEntry } from "@maipai/ui/src/nav";

export type { NavEntry };

// The shell's nav registry (docs/plans/session-b-ui.md step 2;
// spec/ui/schema.json's `nav_entry` def is this same shape). Core's own
// pages register theirs here, by hand, until a package's manifest
// `contributes.pages` field exists to feed a fifth entry in without
// editing this file (docs/BACKLOG.md's own "still open" note on
// `Shell.tsx`'s old hardcoded list). `to`/`icon`/`label` match
// `spec/ui/schema.json`'s `nav_entry` def field-for-field so a page
// authored there and a page registered here describe the same thing.
// `NavEntry` itself now lives in `@maipai/ui`, the kit's own Shell
// contract - one definition, not a second copy shaped the same.

// Step 6 moves Chat off `/` to make room for Home there (docs/BACKLOG.md's
// home-screen item; `home-screen-dashboard-preference` memory): nothing in
// this codebase hardcoded a link to bare "/" expecting Chat (checked
// before moving it), so there is no broken old link to redirect - `/`
// simply shows different, better content now.
// Owner ruling, "Navigation, corrected," 2026-09-20: Conversations is
// Chat's own thread list, not a destination of its own; Memories moved
// onto a person's own profile (People > a person > Memories). Order
// matters here beyond readability - AppShell.tsx's own `groups` puts
// Home/Chat/Apps first for exactly this list, and the phone tab bar
// (`Shell`'s `phoneNavMax`) shows the first three before folding the
// rest under More, so those three have to be first in the flattened
// entry list this feeds.
export const NAV_ENTRIES: readonly NavEntry[] = [
  { to: "/", icon: "home", label: "Home" },
  { to: "/chat", icon: "message-circle", label: "Chat" },
  { to: "/apps", icon: "layout-grid", label: "Apps" },
  { to: "/people", icon: "users", label: "People" },
  { to: "/privacy", icon: "shield-check", label: "Privacy" },
  { to: "/settings", icon: "settings", label: "Settings" },
] as const;

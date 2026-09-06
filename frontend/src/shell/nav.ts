// The shell's nav registry (docs/plans/session-b-ui.md step 2;
// spec/ui/schema.json's `nav_entry` def is this same shape). Core's own
// pages register theirs here, by hand, until a package's manifest
// `contributes.pages` field exists to feed a fifth entry in without
// editing this file (docs/BACKLOG.md's own "still open" note on
// `Shell.tsx`'s old hardcoded list). `to`/`icon`/`label` match
// `spec/ui/schema.json`'s `nav_entry` def field-for-field so a page
// authored there and a page registered here describe the same thing.
export interface NavEntry {
  to: string;
  icon: string;
  label: string;
}

// Step 6 moves Chat off `/` to make room for Home there (docs/BACKLOG.md's
// home-screen item; `home-screen-dashboard-preference` memory): nothing in
// this codebase hardcoded a link to bare "/" expecting Chat (checked
// before moving it), so there is no broken old link to redirect - `/`
// simply shows different, better content now.
export const NAV_ENTRIES: readonly NavEntry[] = [
  { to: "/", icon: "home", label: "Home" },
  { to: "/chat", icon: "message-circle", label: "Chat" },
  { to: "/conversations", icon: "history", label: "Conversations" },
  { to: "/people", icon: "users", label: "People" },
  { to: "/memory", icon: "brain", label: "Memory" },
  { to: "/privacy", icon: "shield-check", label: "Privacy" },
  { to: "/settings", icon: "settings", label: "Settings" },
] as const;

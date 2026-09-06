import { CommandsSection } from "@/apps/settings/CommandsSection";
import type { Roster } from "@/lib/api";

interface CommandsPageProps {
  person: Roster;
}

// Session B step 7 (see ModelsPage.tsx's own comment for the full
// reasoning, including the 2026-09-06 nesting fix). No owner/admin
// gate: the list is household-wide and visible to anyone signed in
// (the same GET /api/plugins visibility); create/delete carry their
// own, narrower role checks (backend/src/lib/commands.ts), enforced
// inside the section itself. Not a schema page - the create form
// branches its own fields by action kind (reply vs. a Home Assistant
// service call), and `kit/schema`'s FormNode is a flat field list with
// no conditional visibility between fields. Renders straight into
// SettingsPage's own content pane (App.tsx's nested route through its
// <Outlet/>), not its own `<Page>` - the section card already carries
// its own heading.
export function CommandsPage({ person }: CommandsPageProps) {
  return <CommandsSection person={person} />;
}

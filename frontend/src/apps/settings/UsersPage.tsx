import { AdminGatedContent } from "@/apps/settings/AdminGatedContent";
import { UsersSection } from "@/apps/settings/UsersSection";
import type { Roster } from "@/lib/api";

interface UsersPageProps {
  person: Roster;
}

// Session B step 7's pattern (see ModelsPage.tsx's own comment), applied
// to the roster-management half of the old PeoplePage.tsx (Jesse,
// 2026-09-06: "the edit part is for USERS, not people" - adding,
// editing, and removing accounts is an admin/household concern, not the
// social directory PeoplePage.tsx is becoming). Not a schema page - the
// add-person form and inline edit/delete rows need the same kind of
// hand-built, per-row conditional UI ModelsSection/BackupsSection do.
export function UsersPage({ person }: UsersPageProps) {
  return (
    <AdminGatedContent title="Users" person={person} deniedText="Only an owner or admin can manage users.">
      <UsersSection person={person} />
    </AdminGatedContent>
  );
}

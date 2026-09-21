import { AdminGatedContent } from "@/apps/settings/AdminGatedContent";
import { UpdatesSection } from "@/apps/settings/UpdatesSection";
import type { Roster } from "@/lib/api";

interface UpdatesPageProps {
  person: Roster;
}

// HOME-STACK-05: nested under SettingsPage's own route, same as
// ModelsPage/RepairsPage/BackupsPage - a real management surface with
// actions, not a settings form, gated at the page level
// (AdminGatedContent) the same way every comparable page here already
// is.
export function UpdatesPage({ person }: UpdatesPageProps) {
  return (
    <AdminGatedContent title="Updates" person={person} deniedText="Only an owner or admin can manage updates.">
      <UpdatesSection />
    </AdminGatedContent>
  );
}

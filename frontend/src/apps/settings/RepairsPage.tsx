import { AdminGatedContent } from "@/apps/settings/AdminGatedContent";
import { RepairsSection } from "@/apps/settings/RepairsSection";
import type { Roster } from "@/lib/api";

interface RepairsPageProps {
  person: Roster;
}

// Session E step 3: "Repairs (severity, fix action, dismiss, learn
// more)." Owner/admin only (backend/src/routes/repairs.ts's own
// `requireRole`) - Repairs spans the whole household's hub, not any one
// person's own data, the same gate Backups and AI models already use,
// so it's linked from HOUSEHOLD_TREE the same way those are (a link a
// non-admin never sees, not just a page that would deny them). Nested
// under SettingsPage's own route (App.tsx, main's 2026-09-06 routing
// change, picked up into this branch by the merge that landed
// AdminGatedContent) rather than a standalone page - renders straight
// into SettingsPage's own already-scrolling content pane, the same as
// Models/Backups/Voices/Commands/Users now do.
export function RepairsPage({ person }: RepairsPageProps) {
  return (
    <AdminGatedContent title="Repairs" person={person} deniedText="Only an owner or admin can see repairs.">
      <RepairsSection />
    </AdminGatedContent>
  );
}

import { AdminGatedPage } from "@/apps/settings/AdminGatedPage";
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
// non-admin never sees, not just a page that would deny them).
export function RepairsPage({ person }: RepairsPageProps) {
  return (
    <AdminGatedPage title="Repairs" person={person} deniedText="Only an owner or admin can see repairs.">
      <RepairsSection />
    </AdminGatedPage>
  );
}

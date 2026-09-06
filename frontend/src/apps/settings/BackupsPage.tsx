import { AdminGatedContent } from "@/apps/settings/AdminGatedContent";
import { BackupsSection } from "@/apps/settings/BackupsSection";
import type { Roster } from "@/lib/api";

interface BackupsPageProps {
  person: Roster;
}

// Session B step 7 (see ModelsPage.tsx's own comment for the full
// reasoning, including the 2026-09-06 nesting fix): a dedicated,
// self-gating route instead of an inline section a caller had to
// remember to gate. Not a schema page - backup create/restore needs a
// file/upload selector `kit/schema`'s FormNode doesn't have (its
// selector enum mirrors the settings registry's own:
// number/select/text/boolean/duration/time/entity/area/person/media,
// nothing for a local file).
export function BackupsPage({ person }: BackupsPageProps) {
  return (
    <AdminGatedContent title="Backups" person={person} deniedText="Only an owner or admin can manage backups.">
      <BackupsSection person={person} />
    </AdminGatedContent>
  );
}

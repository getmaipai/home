import { AdminGatedPage } from "@/apps/settings/AdminGatedPage";
import { ModelsSection } from "@/apps/settings/ModelsSection";
import type { Roster } from "@/lib/api";

interface ModelsPageProps {
  person: Roster;
}

// Session B step 7: "sections that are real management surfaces rather
// than settings (models, backups, voices, commands) become their own
// [pages] linked from the tree" - `ModelsSection` (download progress,
// per-model "Use this") was crammed inline into the single long
// Settings scroll, gated behind a `canManageBackups` check the caller
// had to remember to apply. A dedicated route gates itself
// (AdminGatedPage.tsx), the same way every other page-level access
// check in this app works, rather than trusting every future caller to
// repeat the inline `? : null`.
//
// Not a schema page: `kit/schema`'s interpreter has no selector for a
// live per-item download-progress binding tied to an in-flight action
// the way this section needs (a model download is a long-running job
// with its own polling, not a bound list field) - the same "stays
// hand-written" call docs/dev.md's A2UI entry already made for People,
// Privacy and Settings itself.
export function ModelsPage({ person }: ModelsPageProps) {
  return (
    <AdminGatedPage title="AI models" person={person} deniedText="Only an owner or admin can manage AI models.">
      <ModelsSection />
    </AdminGatedPage>
  );
}

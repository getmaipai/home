import { Page } from "@/kit/primitives/Page";
import { SettingsRenderer } from "@/kit/settings/SettingsRenderer";
import { BackupsSection } from "@/apps/settings/BackupsSection";
import { ModelsSection } from "@/apps/settings/ModelsSection";
import { ChangeSecretSection } from "@/apps/settings/ChangeSecretSection";
import { isOwnerOrAdminRole, type Roster } from "@/lib/api";

interface SettingsPageProps {
  person: Roster;
  /** Re-fetches the signed-in person from App.tsx's own state. Threaded
   * down for ChangeSecretSection: a code review-adjacent gap this session
   * flagged and deferred earlier tonight (docs/dev.md's PIN-change slice)
   * - setting a first PIN left this page showing "doesn't have one yet"
   * until the next full reload, since `person` was only ever loaded once
   * at the top of the app with no way for a page to ask for a fresh copy. */
  onPersonChange: () => void;
}

// Household settings only tonight (Rule 2's Profile-scope settings -
// identity, appearance, notifications - need a profile picker/editor
// that doesn't exist yet). Person- and device-scope rendering work the
// same way through SettingsRenderer; only the scope prop changes once
// there's a UI surface to open them from.
export function SettingsPage({ person, onPersonChange }: SettingsPageProps) {
  // Shares the real definition (backend/src/wire.ts's isOwnerOrAdminRole,
  // the same one backend/src/lib/access.ts's isOwnerOrAdmin and
  // apps/people/roles.ts's requiresSecret use) instead of a third
  // hand-copy of "owner or admin" (a code review, 2026-09-04, found
  // exactly that here).
  const canManageBackups = isOwnerOrAdminRole(person.role);
  return (
    <Page title="Settings">
      <div className="flex flex-1 flex-col gap-6 overflow-y-auto">
        <SettingsRenderer scope="household" scopeValue="household" />
        <div className="flex flex-col gap-6 px-4 pb-4">
          <ChangeSecretSection person={person} onChanged={onPersonChange} />
          {canManageBackups ? <ModelsSection /> : null}
          {canManageBackups ? <BackupsSection /> : null}
        </div>
      </div>
    </Page>
  );
}

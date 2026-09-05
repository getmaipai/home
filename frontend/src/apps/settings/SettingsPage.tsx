import { Page } from "@/kit/primitives/Page";
import { SettingsRenderer } from "@/kit/settings/SettingsRenderer";
import { BackupsSection } from "@/apps/settings/BackupsSection";
import { ModelsSection } from "@/apps/settings/ModelsSection";
import { ChangeSecretSection } from "@/apps/settings/ChangeSecretSection";
import { VoiceCatalogSection } from "@/apps/settings/VoiceCatalogSection";
import { ClonedVoicesSection } from "@/apps/settings/ClonedVoicesSection";
import { HuggingFaceTokenSection } from "@/apps/settings/HuggingFaceTokenSection";
import { RoutingStatsSection } from "@/apps/settings/RoutingStatsSection";
import { CommandsSection } from "@/apps/settings/CommandsSection";
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

// Household settings, plus the signed-in person's OWN person-scope
// settings (2026-09-04, tts.voice_id - "per user selection of voice"):
// the first real UI surface SettingsRenderer's person-scope rendering
// ever had (its own header comment named this exact gap - "Person- and
// device-scope rendering work the same way through SettingsRenderer;
// only the scope prop changes once there's a UI surface to open them
// from"). Still no Household/Profile picker (Rule 2's identity/
// appearance/notifications settings need one that doesn't exist yet) -
// this renders only the CURRENT person's own scope, not any other
// household member's, which is exactly the settings.ts authorization
// model already allows without a picker (canAccessPerson: always your
// own id, an owner/admin's children besides).
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
        <SettingsRenderer scope="person" scopeValue={`person:${person.id}`} />
        <div className="flex flex-col gap-6 px-4 pb-4">
          <VoiceCatalogSection personId={person.id} />
          {/* Not gated to owner/admin: selecting a voice (cloned or
              catalog) is a person-scope choice any signed-in person
              already makes for themselves via tts.voice_id. Upload and
              delete carry their own, narrower checks (routes/voice.ts). */}
          <ClonedVoicesSection person={person} />
          <ChangeSecretSection person={person} onChanged={onPersonChange} />
          {/* Household-wide list, visible to anyone signed in (the same
              GET /api/plugins visibility); create/delete carry their own,
              narrower checks (lib/commands.ts), rendered inside the
              section itself rather than gating the whole thing here. */}
          <CommandsSection person={person} />
          {/* voice.hf_token is a household-scope key: writing it already
              requires owner/admin (lib/settings.ts's assertCanAccessScope),
              same gate as backups/models below. */}
          {canManageBackups ? <HuggingFaceTokenSection /> : null}
          {canManageBackups ? <ModelsSection /> : null}
          {canManageBackups ? <BackupsSection person={person} /> : null}
          {canManageBackups ? <RoutingStatsSection /> : null}
        </div>
      </div>
    </Page>
  );
}

import type { ComponentType } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { FaceEnrollmentBody, canViewFaceEnrollment } from "@/apps/people/FaceEnrollmentBody";
import { ProfileForm } from "@/apps/people/ProfileForm";
import { ChatSkillsSection } from "@/shell/pages/settings/ChatSkillsSection";
import { ChatShortcutsView } from "@/shell/pages/settings/ChatShortcutsView";
import { DeviceAppearanceControl } from "@/shell/pages/settings/DeviceAppearanceControl";
import { VoiceCatalogSection } from "@/apps/settings/VoiceCatalogSection";
import { ClonedVoicesSection } from "@/apps/settings/ClonedVoicesSection";
import { EngineLinkCredentialSection } from "@/apps/settings/EngineLinkCredentialSection";
import { ModelsSection } from "@/apps/settings/ModelsSection";
import { UsersSection } from "@/apps/settings/UsersSection";
import { EnginesConsole } from "@/shell/pages/EnginesPage";
import { HuggingFaceTokenSection } from "@/apps/settings/HuggingFaceTokenSection";
import { AddRobotSection } from "@/apps/settings/AddRobotSection";
import { RobotPasswordSection } from "@/apps/settings/RobotPasswordSection";
import { RoutingStatsSection } from "@/apps/settings/RoutingStatsSection";
import { CommandsSection } from "@/apps/settings/CommandsSection";
import { useTabItem } from "@/shell/tabIdentity";
import type { PersonRosterEntry, Roster } from "@/lib/api";

export interface SettingsViewProps {
  person: Roster;
  onPersonChange: () => void | Promise<void>;
}

function AccountProfile({ person, onPersonChange }: SettingsViewProps) {
  const queryClient = useQueryClient();
  return (
    <>
      <Card>
        <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
        <CardContent>
          <ProfileForm person={person} canEdit layout="page" onSaved={async (_saved: PersonRosterEntry) => { await Promise.all([queryClient.invalidateQueries({ queryKey: ["people"] }), onPersonChange()]); }} />
        </CardContent>
      </Card>
      {canViewFaceEnrollment(person, person) ? <Card><FaceEnrollmentBody profile={person} viewer={person} /></Card> : null}
    </>
  );
}

/** The view table: spec/settings/areas.json names each view, and this is
 * the one map from those ids to the components that draw them. */
function DeviceAppearanceSettings() { return <DeviceAppearanceControl />; }
function ChatSkillsSettings({ person }: SettingsViewProps) { return <ChatSkillsSection person={person} />; }
function ChatShortcutsSettings() { return <ChatShortcutsView />; }
function HomeCommandsSettings({ person }: SettingsViewProps) { return <CommandsSection person={person} management />; }
function HomeVoiceCatalogSettings({ person }: SettingsViewProps) { useTabItem("Voices"); return <VoiceCatalogSection personId={person.id} householdManagement />; }

// ADMIN-HOME-SETTINGS-01: the household admin sections that had no entry.
// Each is a trail view of its Home settings section (spec/settings/areas.json),
// so the area's min_role gate (admin) is the only one this layer needs; the
// hub still gates every call these make.
// ENGINES-AI-01: the one Engines and AI page. After the section's own settings card (where the engine runs, the engine
// computer's name and ports) come the pairing wizard, the engines console (roles, installed engines, health, the
// connection check, formerly /engines), the AI model list (formerly /models) and the Hugging Face token.
function HomeEngineAdminSettings({ person }: SettingsViewProps) {
  return <><EngineLinkCredentialSection /><EnginesConsole person={person} /><ModelsSection /><HuggingFaceTokenSection /></>;
}
// The user list, ready for the People section once the spec names this trail view (the report's commons order).
function HomeUsersAdminSettings({ person }: SettingsViewProps) { return <UsersSection person={person} />; }
function HomeDevicesAdminSettings() { return <><AddRobotSection /><RobotPasswordSection /></>; }
function HomeRoutingStatsSettings() { return <RoutingStatsSection />; }

export const SETTINGS_VIEWS: Record<string, ComponentType<SettingsViewProps>> = {
  "account.profile": AccountProfile,
  "account.voice": AccountVoiceControls,
  "home.commands": HomeCommandsSettings,
  "home.voice_catalog": HomeVoiceCatalogSettings,
  "home.engine_admin": HomeEngineAdminSettings,
  "home.users_admin": HomeUsersAdminSettings,
  "home.devices_admin": HomeDevicesAdminSettings,
  "home.routing_stats": HomeRoutingStatsSettings,
  "account.device_appearance": DeviceAppearanceSettings,
  "chat.skills": ChatSkillsSettings,
  "chat.shortcuts": ChatShortcutsSettings,
};

export function SettingsView({ view, person, onPersonChange }: SettingsViewProps & { view: string }) {
  const View = SETTINGS_VIEWS[view];
  return View ? <View person={person} onPersonChange={onPersonChange} /> : null;
}

function AccountVoiceControls({ person }: SettingsViewProps) {
  useTabItem("Voice");
  return <ClonedVoicesSection person={person} />;
}

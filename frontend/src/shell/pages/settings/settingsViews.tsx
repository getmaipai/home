import type { ComponentType } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FaceEnrollmentCard } from "@/apps/people/FaceEnrollmentCard";
import { ProfileForm } from "@/apps/people/ProfileForm";
import { ChatSkillsSection } from "@/shell/pages/settings/ChatSkillsSection";
import { ChatShortcutsView } from "@/shell/pages/settings/ChatShortcutsView";
import { DeviceAppearanceControl } from "@/shell/pages/settings/DeviceAppearanceControl";
import { VoiceCatalogSection } from "@/apps/settings/VoiceCatalogSection";
import { ClonedVoicesSection } from "@/apps/settings/ClonedVoicesSection";
import { EngineLinkCredentialSection } from "@/apps/settings/EngineLinkCredentialSection";
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
      <ProfileForm person={person} canEdit layout="page" onSaved={async (_saved: PersonRosterEntry) => { await Promise.all([queryClient.invalidateQueries({ queryKey: ["people"] }), onPersonChange()]); }} />
      <FaceEnrollmentCard profile={person} viewer={person} />
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
function HomeEngineAdminSettings() { return <><EngineLinkCredentialSection /><HuggingFaceTokenSection /></>; }
function HomeDevicesAdminSettings() { return <><AddRobotSection /><RobotPasswordSection /></>; }
function HomeRoutingStatsSettings() { return <RoutingStatsSection />; }

export const SETTINGS_VIEWS: Record<string, ComponentType<SettingsViewProps>> = {
  "account.profile": AccountProfile,
  "account.voice": AccountVoiceControls,
  "home.commands": HomeCommandsSettings,
  "home.voice_catalog": HomeVoiceCatalogSettings,
  "home.engine_admin": HomeEngineAdminSettings,
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

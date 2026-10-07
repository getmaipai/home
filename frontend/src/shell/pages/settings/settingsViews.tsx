import type { ComponentType } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FaceEnrollmentCard } from "@/apps/people/FaceEnrollmentCard";
import { ProfileForm } from "@/apps/people/ProfileForm";
import { ChatSkillsSection } from "@/shell/pages/settings/ChatSkillsSection";
import { ChatShortcutsView } from "@/shell/pages/settings/ChatShortcutsView";
import { DeviceAppearanceControl } from "@/shell/pages/settings/DeviceAppearanceControl";
import { VoiceCatalogSection } from "@/apps/settings/VoiceCatalogSection";
import { ClonedVoicesSection } from "@/apps/settings/ClonedVoicesSection";
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

export const SETTINGS_VIEWS: Record<string, ComponentType<SettingsViewProps>> = {
  "account.profile": AccountProfile,
  "account.voice": AccountVoiceControls,
  "home.commands": HomeCommandsSettings,
  "home.voice_catalog": HomeVoiceCatalogSettings,
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

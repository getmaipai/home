import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FaceEnrollmentCard } from "@/apps/people/FaceEnrollmentCard";
import { ProfileForm } from "@/apps/people/ProfileForm";
import { ChatSkillsSection } from "@/shell/pages/settings/ChatSkillsSection";
import { ChatShortcutsView } from "@/shell/pages/settings/ChatShortcutsView";
import { DeviceAppearanceControl } from "@/shell/pages/settings/DeviceAppearanceControl";
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

/** The view table (design 2.5): the spec lists the view ids an area may name
 * (`account.profile`, `account.device_appearance`, `chat.skills`,
 * `chat.shortcuts`); this is the one map from each to the component that
 * draws it. The components are not Home's to restyle here: Skills belongs to
 * the Projects and Skills work and is only registered by id. */
export const SETTINGS_VIEWS: Record<string, (props: SettingsViewProps) => ReactNode> = {
  "account.profile": (props) => <AccountProfile {...props} />,
  "account.device_appearance": () => <DeviceAppearanceControl />,
  "chat.skills": ({ person }) => <ChatSkillsSection person={person} />,
  "chat.shortcuts": () => <ChatShortcutsView />,
};

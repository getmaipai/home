import { Switch } from "@maipai/ui/src/dashboard/components/ui/switch";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { usePinnedApps } from "@/shell/usePinnedApps";
import { type ComponentType } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { canViewFaceEnrollment } from "@/apps/people/FaceEnrollmentBody";
import { VoiceEnrollmentBody } from "@/apps/people/VoiceEnrollmentBody";
import { ProfileForm } from "@/apps/people/ProfileForm";
import { DevicesSection } from "@/apps/settings/DevicesSection";
import { AwaySessionsSection } from "@/apps/settings/AwaySessionsSection";
import { SignInSecretSection } from "@/apps/settings/SignInSecretSection";
import { ChatSkillsSection } from "@/shell/pages/settings/ChatSkillsSection";
import { ChatShortcutsView } from "@/shell/pages/settings/ChatShortcutsView";
import { DeviceAppearanceControl } from "@/shell/pages/settings/DeviceAppearanceControl";
import { VoiceBrowserSection } from "@/apps/settings/VoiceBrowserSection";
import { VoiceManagerSection } from "@/apps/settings/VoiceManagerSection";
import { EngineLinkCredentialSection } from "@/apps/settings/EngineLinkCredentialSection";
import { ModelsSection } from "@/apps/settings/ModelsSection";
import { AiGlance } from "@/apps/settings/AiGlance";
import { AiAlwaysOnView } from "@/apps/settings/AiJobCardView";
import { PerformanceSettings } from "@/apps/settings/PerformanceSettings";
import type { Card as SpecCard } from "@maipai/ui/src/settings/settingsAudience";
import { ModelsAndStorageSection } from "@/apps/settings/ModelsAndStorageSection";
import { HuggingFaceTokenSection } from "@/apps/settings/HuggingFaceTokenSection";
import { UsersSection } from "@/apps/settings/UsersSection";
import { OwnMemories } from "@/apps/memory/PersonMemories";
import { EnginesConsole } from "@/shell/pages/EnginesPage";
import { HouseholdRobotsSection } from "@/apps/settings/HouseholdRobotsSection";
import { AddRobotSection } from "@/apps/settings/AddRobotSection";
import { StackChanInstallDialog } from "@/apps/settings/StackChanInstallDialog";
import { RobotPasswordSection } from "@/apps/settings/RobotPasswordSection";
import { RoutingStatsSection } from "@/apps/settings/RoutingStatsSection";
import { ReferenceLibrarySettings } from "@/apps/settings/ReferenceLibrarySettings";
import { PicturesLibrary } from "@/apps/settings/PicturesLibrary";
import { VideoLibrary } from "@/apps/settings/VideoLibrary";
import { CommandsSection } from "@/apps/settings/CommandsSection";
import { CodingKeysSettings } from "@/apps/settings/CodingSettings";
import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { useTabItem } from "@/shell/tabIdentity";
import { useSearchParams, useLocation } from "react-router-dom";
import { useSettingsCapabilities } from "@/shell/pages/settings/useSettingsCapabilities";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@maipai/ui/src/ui/dialog";
import type { PersonRosterEntry, Roster } from "@/lib/api";

export interface SettingsViewProps {
  person: Roster;
  onPersonChange: () => void | Promise<void>;
  tab?: string;
  detailId?: string;
  /** The spec card that named this view (views that draw one card of a section read their group and words from it). */
  card?: SpecCard;
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
      <Card>
        <CardHeader><CardTitle>PIN or password</CardTitle></CardHeader>
        <CardContent><SignInSecretSection person={person} onPersonChange={onPersonChange} /></CardContent>
      </Card>
      <AwaySessionsSection />
      <DevicesSection />
      {canViewFaceEnrollment(person, person) ? <Card><VoiceEnrollmentBody profile={person} viewer={person} /></Card> : null}
    </>
  );
}
function AccountMemories({ person }: SettingsViewProps) {
  const location = useLocation();
  const ids = new URLSearchParams(location.search).get("ids");
  return <>
    <OwnMemories filterIds={ids ? new Set(ids.split(",")) : null} actorIsAdult={person.role === "adult"} />
  </>;
}

/** The view table: spec/settings/areas.json names each view, and this is
 * the one map from those ids to the components that draw them. */
function DeviceAppearanceSettings() { return <DeviceAppearanceControl />; }
function ChatSkillsSettings({ person }: SettingsViewProps) { return <ChatSkillsSection person={person} />; }
function ChatShortcutsSettings() { return <ChatShortcutsView />; }
function HomeCommandsSettings({ person }: SettingsViewProps) { return <CommandsSection person={person} management />; }
function HomeVoiceCatalogSettings() { useTabItem("Voices"); return <VoiceManagerSection />; }

// ADMIN-HOME-SETTINGS-01: the household admin sections that had no entry.
// Each is a trail view of its Home settings section (spec/settings/areas.json),
// so the area's min_role gate (admin) is the only one this layer needs; the
// hub still gates every call these make.
// SETTINGS-UX-05: the existing Engines and AI pieces are placed in four short tabs.
function HomeEngineAdminSettings({ person, tab }: SettingsViewProps) {
  const show = (id: string) => tab === undefined || tab === id;
  return <>
    {show("engines") ? <><EngineLinkCredentialSection /><EnginesConsole person={person} /></> : null}
    {show("advanced") ? <><HuggingFaceTokenSection /><ModelsAndStorageSection /><ModelsSection /></> : null}
  </>;
}
// The user list, ready for the People section once the spec names this trail view (the report's commons order).
function HomeUsersAdminSettings({ person }: SettingsViewProps) { return <UsersSection person={person} />; }
function HomeDevicesAdminSettings({ person, detailId, tab }: SettingsViewProps) {
  const { capabilities } = useSettingsCapabilities(person);
  const [params, setParams] = useSearchParams();
  const addOpen = params.get("addRobot") === "1";
  const setAddOpen = (open: boolean) => setParams((previous) => { const next = new URLSearchParams(previous); if (open) next.set("addRobot", "1"); else next.delete("addRobot"); return next; });
  return tab === "integrations" ? null : capabilities.includes("robots.enabled") ? <>{detailId ? <HouseholdRobotsSection detailId={detailId} tab={tab} /> : <><HouseholdRobotsSection /><Dialog open={addOpen} onOpenChange={setAddOpen}><DialogContent scroll="viewport"><DialogHeader><DialogTitle>Add a robot</DialogTitle><DialogDescription>Pair a robot with this home.</DialogDescription></DialogHeader><AddRobotSection onClose={() => setAddOpen(false)} /><StackChanInstallDialog /></DialogContent></Dialog><RobotPasswordSection /></>}</> : null;
}
function PicturesLibraryView() { useTabItem("Pictures and videos"); return <><PicturesLibrary /><VideoLibrary /></>; }
function HomeRoutingStatsSettings() { return <RoutingStatsSection />; }

export const SETTINGS_VIEWS: Record<string, ComponentType<SettingsViewProps>> = {
  "account.profile": AccountProfile,
  "account.memories": AccountMemories,
  "account.coding_keys": CodingKeysSettings,
  "account.voice": AccountVoiceControls,
  "home.commands": HomeCommandsSettings,
  "home.voice_catalog": HomeVoiceCatalogSettings,
  "home.engine_admin": HomeEngineAdminSettings,
  "ai.glance": AiGlance,
  "ai.always_on": AiAlwaysOnView,
  "ai.performance": PerformanceSettings,
  "home.users_admin": HomeUsersAdminSettings,
  "home.devices_admin": HomeDevicesAdminSettings,
  "home.routing_stats": HomeRoutingStatsSettings,
  "home.reference_library": ReferenceLibrarySettings,
  "home.pictures_library": PicturesLibraryView,
  "home.media_library": PicturesLibraryView,
  "account.device_appearance": DeviceAppearanceSettings,
  "chat.skills": ChatSkillsSettings,
  "chat.shortcuts": ChatShortcutsSettings,
};

/** Settings > an app > Sidebar, view `app.pin:<route>`: the one switch that shows the app in the rail. */
function AppPinSettings({ person, to }: { person: SettingsViewProps["person"]; to: string }) {
  const { isPinned, togglePin, isLoading, isSaving } = usePinnedApps(person.id);
  return (
    <section aria-label="Sidebar" className="flex flex-col gap-3">
      <ItemGroup variant="card">
      <Item size="setting">
        <ItemContent>
          <ItemTitle>Show in the sidebar</ItemTitle>
          <ItemDescription>Keep this app in the sidebar so it is one tap away.</ItemDescription>
        </ItemContent>
        <ItemActions><Switch size="md" aria-label="Show in the sidebar" checked={isPinned(to)} disabled={isLoading || isSaving} onCheckedChange={() => togglePin(to)} /></ItemActions>
      </Item>
      </ItemGroup>
    </section>
  );
}

export function SettingsView({ view, person, onPersonChange, tab, detailId, card }: SettingsViewProps & { view: string }) {
  if (view.startsWith("app.pin:")) return <AppPinSettings person={person} to={view.slice("app.pin:".length)} />;
  const View = SETTINGS_VIEWS[view];
  return View ? <View person={person} onPersonChange={onPersonChange} tab={tab} detailId={detailId} card={card} /> : null;
}

function AccountVoiceControls({ person }: SettingsViewProps) {
  useTabItem("Voice");
  return <VoiceBrowserSection person={person} />;
}

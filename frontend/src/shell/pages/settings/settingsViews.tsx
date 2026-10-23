import type { ComponentType } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FaceEnrollmentBody, canViewFaceEnrollment } from "@/apps/people/FaceEnrollmentBody";
import { VoiceEnrollmentBody } from "@/apps/people/VoiceEnrollmentBody";
import { ProfileForm } from "@/apps/people/ProfileForm";
import { DevicesSection } from "@/apps/settings/DevicesSection";
import { AwaySessionsSection } from "@/apps/settings/AwaySessionsSection";
import { ChatSkillsSection } from "@/shell/pages/settings/ChatSkillsSection";
import { ChatShortcutsView } from "@/shell/pages/settings/ChatShortcutsView";
import { DeviceAppearanceControl } from "@/shell/pages/settings/DeviceAppearanceControl";
import { VoiceBrowserSection } from "@/apps/settings/VoiceBrowserSection";
import { VoiceManagerSection } from "@/apps/settings/VoiceManagerSection";
import { EngineLinkCredentialSection } from "@/apps/settings/EngineLinkCredentialSection";
import { ModelsSection } from "@/apps/settings/ModelsSection";
import { InstallPlanSection } from "@/apps/settings/InstallPlanSection";
import { ModelsAndStorageSection } from "@/apps/settings/ModelsAndStorageSection";
import { UsersSection } from "@/apps/settings/UsersSection";
import { EnginesConsole } from "@/shell/pages/EnginesPage";
import { HuggingFaceTokenSection } from "@/apps/settings/HuggingFaceTokenSection";
import { HouseholdRobotsSection } from "@/apps/settings/HouseholdRobotsSection";
import { AddRobotSection } from "@/apps/settings/AddRobotSection";
import { StackChanInstallDialog } from "@/apps/settings/StackChanInstallDialog";
import { RobotPasswordSection } from "@/apps/settings/RobotPasswordSection";
import { RoutingStatsSection } from "@/apps/settings/RoutingStatsSection";
import { ReferenceLibrarySettings } from "@/apps/settings/ReferenceLibrarySettings";
import { PicturesLibrary } from "@/apps/settings/PicturesLibrary";
import { LikenessSettings } from "@/apps/settings/LikenessSettings";
import { VideoLibrary } from "@/apps/settings/VideoLibrary";
import { CommandsSection } from "@/apps/settings/CommandsSection";
import { CodingKeysSettings } from "@/apps/settings/CodingSettings";
import { SizingPanel } from "@/shell/pages/settings/SizingPanel";
import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@maipai/ui/src/dashboard/components/ui/alert-dialog";
import { useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@maipai/ui/src/ui/tabs";
import { SettingsRenderer } from "@/shell/pages/settings/SettingsRenderer";
import { useSearchParams } from "react-router-dom";
import { useTabItem } from "@/shell/tabIdentity";
import { useSettingsCapabilities } from "@/shell/pages/settings/useSettingsCapabilities";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@maipai/ui/src/ui/dialog";
import type { PersonRosterEntry, Roster } from "@/lib/api";
import { scopeValueFor } from "@/shell/pages/settings/settingsViewer";

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
      <AwaySessionsSection />
      <DevicesSection />
      {canViewFaceEnrollment(person, person) ? <Card><FaceEnrollmentBody profile={person} viewer={person} /></Card> : null}
      {canViewFaceEnrollment(person, person) ? <Card><VoiceEnrollmentBody profile={person} viewer={person} /></Card> : null}
    </>
  );
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
function HomeEngineAdminSettings({ person }: SettingsViewProps) {
  const [removal, setRemoval] = useState<{ message: string; confirm: () => void } | null>(null);
  const [params, setParams] = useSearchParams();
  const tabIds = ["overview", "models", "engines", "advanced"] as const;
  const requestedTab = params.get("tab");
  const activeTab = tabIds.includes(requestedTab as typeof tabIds[number]) ? requestedTab! : "overview";
  function changeTab(value: string) {
    setParams((previous) => { const next = new URLSearchParams(previous); if (value === "overview") next.delete("tab"); else next.set("tab", value); return next; });
  }
  const household = { scope: "household" as const, scopeValue: scopeValueFor("household", person.id), only: ["household.ai"] };
  return <>
  <Tabs value={activeTab} onValueChange={changeTab}>
    <TabsList variant="line" aria-label="Engines and AI topics">
      <TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="models">Models</TabsTrigger><TabsTrigger value="engines">Engines</TabsTrigger><TabsTrigger value="advanced">Advanced</TabsTrigger>
    </TabsList>
    {activeTab === "overview" ? <div role="tabpanel" aria-label="Overview" id="engine-tab-overview">
      <div className="flex min-w-0 flex-col gap-6">
        <SettingsRenderer {...household} includeKeys={["chat.paused", "chat.paused_message", "engines.stack.where"]} />
        <InstallPlanSection />
      </div>
    </div> : null}
    {activeTab === "models" ? <div role="tabpanel" aria-label="Models" id="engine-tab-models"><div className="flex min-w-0 flex-col gap-6"><ModelsAndStorageSection /><Card><CardHeader><CardTitle>Memory and model choices</CardTitle></CardHeader><CardContent><SizingPanel person={person} onRemoval={(message, confirm) => setRemoval({ message, confirm })} /></CardContent></Card><ModelsSection /></div></div> : null}
    {activeTab === "engines" ? <div role="tabpanel" aria-label="Engines" id="engine-tab-engines"><div className="flex min-w-0 flex-col gap-6"><SettingsRenderer {...household} includeExpert includeKeys={["engines.stack.remote.host", "engines.stack.remote.local_port", "engines.stack.remote.ssh_port", "engines.stack.remote.allow_tailnet"]} /><EngineLinkCredentialSection /><EnginesConsole person={person} /></div></div> : null}
    {activeTab === "advanced" ? <div role="tabpanel" aria-label="Advanced" id="engine-tab-advanced">
      <div className="flex min-w-0 flex-col gap-6">
        <SettingsRenderer {...household} includeExpert includeKeys={[
          "chat.context_size_override", "chat.flash_attention_override", "chat.kv_cache_override", "chat.model_id", "health.keep_warm", "chat.teen_gate_grain", "chat.search_assist", "engines.stack.url", "engines.stack.use_chat", "engines.stack.use_embeddings", "engines.stack.use_stt", "engines.stack.use_tts", "voice.hesitations", "engines.turn_signal.choice",
          ...["chat", "router", "embed", "rerank", "vision", "image", "video", "music", "coding", "judge", "tts", "stt", "wakeword"].map((role) => `engines.${role}.choice`),
        ]} expandAdvanced titleOverrides={{ "household.ai": "Model per job" }} />
        <HuggingFaceTokenSection />
      </div>
    </div> : null}
  </Tabs>
  <AlertDialog open={removal !== null} onOpenChange={(open) => { if (!open) setRemoval(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Turn this feature off?</AlertDialogTitle><AlertDialogDescription>{removal?.message}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => { const pending = removal; setRemoval(null); pending?.confirm(); }}>Confirm</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </>;
}
// The user list, ready for the People section once the spec names this trail view (the report's commons order).
function HomeUsersAdminSettings({ person }: SettingsViewProps) { return <UsersSection person={person} />; }
function HomeDevicesAdminSettings({ person }: SettingsViewProps) {
  const { capabilities } = useSettingsCapabilities(person);
  const [params, setParams] = useSearchParams();
  const addOpen = params.get("addRobot") === "1";
  const setAddOpen = (open: boolean) => setParams((previous) => { const next = new URLSearchParams(previous); if (open) next.set("addRobot", "1"); else next.delete("addRobot"); return next; });
  return capabilities.includes("robots.enabled") ? <><HouseholdRobotsSection /><Dialog open={addOpen} onOpenChange={setAddOpen}><DialogContent scroll="viewport"><DialogHeader><DialogTitle>Add a robot</DialogTitle><DialogDescription>Pair a robot with this home.</DialogDescription></DialogHeader><AddRobotSection onClose={() => setAddOpen(false)} /><StackChanInstallDialog /></DialogContent></Dialog><RobotPasswordSection /></> : null;
}
function AccountLikenessView() { useTabItem("Pictures and videos"); return <LikenessSettings />; }
function PicturesLibraryView() { useTabItem("Pictures and videos"); return <><PicturesLibrary /><VideoLibrary /></>; }
function HomeRoutingStatsSettings() { return <RoutingStatsSection />; }

export const SETTINGS_VIEWS: Record<string, ComponentType<SettingsViewProps>> = {
  "account.profile": AccountProfile,
  "account.coding_keys": CodingKeysSettings,
  "account.voice": AccountVoiceControls,
  "home.commands": HomeCommandsSettings,
  "home.voice_catalog": HomeVoiceCatalogSettings,
  "home.engine_admin": HomeEngineAdminSettings,
  "home.users_admin": HomeUsersAdminSettings,
  "home.devices_admin": HomeDevicesAdminSettings,
  "home.routing_stats": HomeRoutingStatsSettings,
  "home.reference_library": ReferenceLibrarySettings,
  "home.pictures_library": PicturesLibraryView,
  "account.likeness": AccountLikenessView,
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
  return <VoiceBrowserSection person={person} />;
}

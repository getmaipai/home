import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@maipai/ui/src/dashboard/components/ui/collapsible";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { NextSettingsRenderer } from "@/next/pages/settings/NextSettingsRenderer";
import { FaceEnrollmentCard } from "@/apps/people/FaceEnrollmentCard";
import { ProfileForm } from "@/apps/people/ProfileForm";
import { api, type PersonRosterEntry, type Roster } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import { SettingsSectionFrame, type SettingsSection } from "@/next/pages/settings/SettingsSectionFrame";

const telegramNotificationKeys = ["notifications.telegram.chat_id", ...["approvals.requested", "backups.target_failing", "engines.problem", "engines.update_applied", "engines.update_available", "engines.update_failed", "file.shared_with_household", "file.shared_with_you", "memory.judge_failed", "memory.updated", "model.download_failed", "model.download_ready", "person.band_changed", "repairs.new", "updates.available"].map((key) => `notifications.${key}.telegram`)];

const sections = [
  { id: "profile", title: "Profile", description: "Your name and profile photo." },
  { id: "appearance", title: "Appearance", description: "Choose how MaiPai looks." },
  { id: "voice-ai", title: "Voice and AI", description: "Choose how MaiPai speaks and responds." },
  { id: "notifications", title: "Notifications", description: "Choose what you hear about." },
  { id: "privacy-data", title: "Privacy and data", description: "Review your data and signed-in devices." },
] as const;

export function NextMeSettings({ person, onPersonChange = () => {} }: { person: Roster; onPersonChange?: () => void | Promise<void> }) {
  const queryClient = useQueryClient();
  function renderSection(id: typeof sections[number]["id"]) {
    if (id === "profile") {
      return <><ProfileForm person={person} canEdit layout="page" onSaved={async (_saved: PersonRosterEntry) => { await Promise.all([queryClient.invalidateQueries({ queryKey: ["people"] }), onPersonChange()]); }} /><FaceEnrollmentCard profile={person} viewer={person} /></>;
    }
    if (id === "appearance") {
      return <>
        <NextSettingsRenderer scope="person" scopeValue={`person:${person.id}`} only={["profile.appearance"]} includeKeys={["ui.appearance", "ui.look"]} />
        <Collapsible>
          <Card><CardHeader className="pb-2"><CollapsibleTrigger className="flex min-h-12 w-full items-center justify-between text-left font-medium">Advanced<span aria-hidden>⌄</span></CollapsibleTrigger></CardHeader><CollapsibleContent><CardContent className="pt-0"><NextSettingsRenderer scope="person" scopeValue={`person:${person.id}`} only={["profile.appearance"]} includeKeys={["ui.show_turn_stats"]} /></CardContent></CollapsibleContent></Card>
        </Collapsible>
      </>;
    }
    if (id === "voice-ai") return <><NextSettingsRenderer scope="person" scopeValue={`person:${person.id}`} only={["person.persona", "person.voice", "person.search"]} /><ManagementLinks links={["Voices", "Commands"]} /></>;
    if (id === "notifications") return <NotificationSettings person={person} />;
    return <><ManagementLinks links={["Devices"]} /><div className="grid gap-4 sm:grid-cols-2">
      <LinkCard title="Storage" description="Usage against your storage limit." to="/storage" />
      <LinkCard title="Privacy" description="See what connects to the internet and what stays here." to="/privacy" />
      <LinkCard title="Status" description="See whether the parts of MaiPai are working." to="/status" />
    </div></>;
  }
  const content: SettingsSection[] = sections.map((item) => ({
    id: item.id,
    label: item.title,
    description: item.description,
    render: renderSection(item.id),
  }));
  return <SettingsSectionFrame sections={content} defaultSection="profile" />;
}

function NotificationSettings({ person }: { person: Roster }) {
  const [chatId, setChatId] = useState<string | null>(null);
  useEffect(() => { let active = true; api.settingsValues(`person:${person.id}`).then((values) => { if (active) setChatId(String(values.find((value) => value.key === "notifications.telegram.chat_id")?.value ?? "").trim() || null); }).catch(() => setChatId(null)); return () => { active = false; }; }, [person.id]);
  return <><NextSettingsRenderer scope="person" scopeValue={`person:${person.id}`} only={["person.notifications"]} includeKeys={["notifications.file_shared.muted_senders"]} /><TelegramAdvanced person={person} configured={Boolean(chatId)} /></>;
}

function TelegramAdvanced({ person, configured }: { person: Roster; configured: boolean }) {
  return <Collapsible defaultOpen={false}><Card><CardHeader className="pb-2"><CollapsibleTrigger className="flex min-h-12 w-full items-center justify-between text-left font-medium">{configured ? "Advanced" : "Advanced, set up Telegram to use these options"}<span aria-hidden>⌄</span></CollapsibleTrigger></CardHeader><CollapsibleContent><CardContent className="pt-0"><NextSettingsRenderer scope="person" scopeValue={`person:${person.id}`} only={["person.notifications"]} includeKeys={telegramNotificationKeys} expandAdvanced /></CardContent></CollapsibleContent></Card></Collapsible>;
}

function ManagementLinks({ links }: { links: readonly ("Voices" | "Commands" | "Devices")[] }) {
  const destinations = { Voices: ["/voices", "Browse voices and manage your voice recordings."], Commands: ["/commands", "View and manage household commands."], Devices: ["/devices", "Review your signed-in devices and sessions."] } as const;
  return <div className="grid gap-4 sm:grid-cols-2">{links.map((title) => <LinkCard key={title} title={title} description={destinations[title][1]} to={destinations[title][0]} />)}</div>;
}

function LinkCard({ title, description, to }: { title: string; description: string; to: string }) {
  return <Link to={to} className="block"><Card className="h-full py-4 transition-colors hover:bg-accent"><CardHeader><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader></Card></Link>;
}

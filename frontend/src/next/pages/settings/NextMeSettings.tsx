import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@maipai/ui/src/dashboard/components/ui/collapsible";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { NextSettingsRenderer } from "@/next/pages/settings/NextSettingsRenderer";
import { ChatSkillsSection } from "@/next/pages/settings/ChatSkillsSection";
import { FaceEnrollmentCard } from "@/apps/people/FaceEnrollmentCard";
import { ProfileForm } from "@/apps/people/ProfileForm";
import { api, type PersonRosterEntry, type Roster } from "@/lib/api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SettingsSectionFrame, type SettingsSection } from "@/next/pages/settings/SettingsSectionFrame";
import type { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/dashboard/components/ui/select";
import { readDeviceAppearancePreference, writeDeviceAppearancePreference } from "@/next/deviceAppearancePreference";
import { isAppearance, type Appearance } from "@/next/appearanceResolve";

const telegramNotificationKeys = ["notifications.telegram.chat_id", ...["approvals.requested", "backups.target_failing", "engines.problem", "engines.update_applied", "engines.update_available", "engines.update_failed", "file.shared_with_household", "file.shared_with_you", "memory.judge_failed", "memory.updated", "model.download_failed", "model.download_ready", "person.band_changed", "repairs.new", "updates.available"].map((key) => `notifications.${key}.telegram`)];

const sections = [
  { id: "profile", title: "Profile", description: "Your name and profile photo." },
  { id: "appearance", title: "Appearance", description: "Choose how MaiPai looks." },
  { id: "chat", title: "Chat", description: "Choose how chat talks, searches and handles photos." },
  // SKILLS-PAGE-01: skills live under Chat settings (owner, 2026-10-06), here
  // until the per-app settings shell (APP-SETTINGS-DESIGN) gives Chat its own.
  { id: "skills", title: "Chat skills", description: "See what the assistant can do for you in chat." },
  { id: "voice-ai", title: "Voice and AI", description: "Choose how MaiPai speaks." },
  { id: "notifications", title: "Notifications", description: "Choose what you hear about." },
  { id: "privacy-data", title: "Privacy and data", description: "Review your data and signed-in devices." },
] as const;

export function NextMeSettings({ person, onPersonChange = () => {} }: { person: Roster; onPersonChange?: () => void | Promise<void> }) {
  const queryClient = useQueryClient();
  function renderSection(id: typeof sections[number]["id"]) {
    if (id === "profile") {
      return <><ProfileForm person={person} canEdit layout="page" onSaved={async (_saved: PersonRosterEntry) => { await Promise.all([queryClient.invalidateQueries({ queryKey: ["people"] }), onPersonChange()]); }} /><FaceEnrollmentCard profile={person} viewer={person} /> </>;
    }
    if (id === "appearance") {
      return <>
        <NextSettingsRenderer scope="person" scopeValue={`person:${person.id}`} only={["profile.appearance"]} includeKeys={["ui.appearance", "ui.look"]} />
        <DeviceAppearanceControl />
        <Collapsible>
          <Card><CardHeader className="pb-2"><CollapsibleTrigger className="flex min-h-12 w-full items-center justify-between text-left font-medium">Advanced<span aria-hidden>⌄</span></CollapsibleTrigger></CardHeader><CollapsibleContent><CardContent className="pt-0"><NextSettingsRenderer scope="person" scopeValue={`person:${person.id}`} only={["profile.appearance"]} includeKeys={["ui.show_turn_stats"]} /></CardContent></CollapsibleContent></Card>
        </Collapsible>
      </>;
    }
    // CHAT-SETTINGS-01: the chat keys, routed by their existing `lives_in`
    // groups into one card (personality, safe search, photo uploads). A child
    // keeps seeing what they could before: photo uploads is a parent's switch
    // for a child, so its group is not offered to a child.
    if (id === "chat") {
      const groups = person.role === "child" ? ["person.persona", "person.search"] : ["person.persona", "person.search", "person.chat"];
      return <NextSettingsRenderer scope="person" scopeValue={`person:${person.id}`} only={groups} titleOverrides={Object.fromEntries(groups.map((group) => [group, "Chat"]))} mergeGroups />;
    }
    if (id === "skills") return <ChatSkillsSection person={person} />;
    if (id === "voice-ai") return <><NextSettingsRenderer scope="person" scopeValue={`person:${person.id}`} only={["person.voice"]} titleOverrides={{ "person.voice": "Voice and AI" }} /><ManagementLinks links={["Voices", "Commands"]} /></>;
    if (id === "notifications") return <NotificationSettings person={person} />;
    return <><ManagementLinks links={["Devices"]} /><div className="grid gap-4 sm:grid-cols-2">
      <LinkCard title="Storage" description="Usage against your storage limit." to="/storage" />
      <LinkCard title="Privacy" description="See what connects to the internet and what stays here." to="/privacy" />
      <LinkCard title="Status" description="See whether the parts of MaiPai are working." to="/status" />
    </div></>;
  }
  // A child has no Skills section (CHAT-UI-SPEC section 9).
  const content: SettingsSection[] = sections.filter((item) => item.id !== "skills" || person.role !== "child").map((item) => ({
    id: item.id,
    label: item.title,
    description: item.description,
    render: renderSection(item.id),
  }));
  return <SettingsSectionFrame sections={content} defaultSection="profile" />;
}

function DeviceAppearanceControl() {
  const [value, setValue] = useState<Appearance | null>(() => readDeviceAppearancePreference());
  const registry = useQuery<SettingsKey[]>({ queryKey: ["settings-registry"], queryFn: () => api.settingsRegistry(), staleTime: Infinity });
  const declaration = registry.data?.find((item) => item.key === "ui.appearance");
  const options = ((declaration?.range as { options?: string[] } | undefined)?.options ?? []).filter(isAppearance);
  return <Card><CardHeader><CardTitle>On this device only</CardTitle><CardDescription>Choose a look for this browser. It does not change your personal setting.</CardDescription></CardHeader><CardContent className="flex flex-wrap items-center gap-3">
    <Select value={value ?? "inherit"} onValueChange={(next) => { const appearance = next === "inherit" ? null : isAppearance(next) ? next : null; setValue(appearance); writeDeviceAppearancePreference(appearance); }}>
      <SelectTrigger className="min-h-12 w-48" aria-label="On this device only"><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="inherit">Use my setting</SelectItem>{options.map((option) => <SelectItem key={option} value={option}>{option[0]!.toUpperCase() + option.slice(1)}</SelectItem>)}</SelectContent>
    </Select>
    <Button type="button" variant="outline" className="min-h-12" aria-label="Reset device appearance" onClick={() => { setValue(null); writeDeviceAppearancePreference(null); }}>Reset</Button>
  </CardContent></Card>;
}

function NotificationSettings({ person }: { person: Roster }) {
  const [chatId, setChatId] = useState<string | null>(null);
  useEffect(() => { let active = true; api.settingsValues(`person:${person.id}`).then((values) => { if (active) setChatId(String(values.find((value) => value.key === "notifications.telegram.chat_id")?.value ?? "").trim() || null); }).catch(() => setChatId(null)); return () => { active = false; }; }, [person.id]);
  return <><NextSettingsRenderer scope="person" scopeValue={`person:${person.id}`} only={["person.notifications", "robot.settings"]} includeKeys={["person.quiet_hours.from", "person.quiet_hours.to", "notifications.browser.enabled", "notifications.file_shared.muted_senders"]} /><TelegramAdvanced person={person} configured={Boolean(chatId)} /></>;
}

function TelegramAdvanced({ person, configured }: { person: Roster; configured: boolean }) {
  return <Collapsible defaultOpen={false}><Card><CardHeader className="pb-2"><CollapsibleTrigger className="flex min-h-12 w-full items-center justify-between text-left font-medium">Telegram options<span aria-hidden>⌄</span></CollapsibleTrigger>{!configured ? <p className="text-sm text-muted-foreground">Set up Telegram first to use these.</p> : null}</CardHeader><CollapsibleContent><CardContent className="pt-0"><NextSettingsRenderer scope="person" scopeValue={`person:${person.id}`} only={["person.notifications"]} includeKeys={telegramNotificationKeys} expandAdvanced /></CardContent></CollapsibleContent></Card></Collapsible>;
}

function ManagementLinks({ links }: { links: readonly ("Voices" | "Commands" | "Devices")[] }) {
  const destinations = { Voices: ["/voices", "Browse voices and manage your voice recordings."], Commands: ["/commands", "View and manage household commands."], Devices: ["/devices", "Review your signed-in devices and sessions."] } as const;
  return <div className="grid gap-4 sm:grid-cols-2">{links.map((title) => <LinkCard key={title} title={title} description={destinations[title][1]} to={destinations[title][0]} />)}</div>;
}

function LinkCard({ title, description, to }: { title: string; description: string; to: string }) {
  return <Link to={to} className="block"><Card className="h-full py-4 transition-colors hover:bg-accent"><CardHeader><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader></Card></Link>;
}

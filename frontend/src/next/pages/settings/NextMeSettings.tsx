import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@maipai/ui/src/dashboard/components/ui/tabs";
import { NativeSelect, NativeSelectOption } from "@maipai/ui/src/dashboard/components/ui/native-select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@maipai/ui/src/dashboard/components/ui/collapsible";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { Avatar } from "@maipai/ui/src/primitives/Avatar";
import { NextSettingsRenderer } from "@/next/pages/settings/NextSettingsRenderer";
import { api, isOwnerOrAdminRole, type Roster } from "@/lib/api";
import { ROLE_LABELS } from "@/apps/people/roles";

const telegramNotificationKeys = ["notifications.telegram.chat_id", ...["approvals.requested", "backups.target_failing", "engines.problem", "engines.update_applied", "engines.update_available", "engines.update_failed", "file.shared_with_household", "file.shared_with_you", "memory.judge_failed", "memory.updated", "model.download_failed", "model.download_ready", "person.band_changed", "repairs.new", "updates.available"].map((key) => `notifications.${key}.telegram`)];

const sections = [
  { id: "profile", title: "Profile", description: "Your name and profile photo." },
  { id: "appearance", title: "Appearance", description: "Choose how MaiPai looks." },
  { id: "voice-ai", title: "Voice and AI", description: "Choose how MaiPai speaks and responds." },
  { id: "notifications", title: "Notifications", description: "Choose what you hear about." },
  { id: "privacy-data", title: "Privacy and data", description: "Review your data and signed-in devices." },
] as const;
type SectionId = typeof sections[number]["id"];

function validSection(value: string | null, isAdmin: boolean): SectionId | "limits" {
  if (sections.some((section) => section.id === value)) return value as SectionId;
  return isAdmin && value === "limits" ? "limits" : "profile";
}

export function NextMeSettings({ person }: { person: Roster }) {
  const isAdmin = isOwnerOrAdminRole(person.role);
  const [params, setParams] = useSearchParams();
  const [section, setSection] = useState<SectionId | "limits">(() => validSection(params.get("section"), isAdmin));

  useEffect(() => {
    const requested = params.get("section");
    if (requested !== null) {
      const next = validSection(requested, isAdmin);
      setSection(next);
      if (next !== requested) setParams((current) => { const updated = new URLSearchParams(current); updated.set("section", next); return updated; }, { replace: true });
    }
  }, [params, isAdmin, setParams]);

  function changeSection(value: string) {
    const next = validSection(value, isAdmin);
    setSection(next);
    setParams((current) => { const updated = new URLSearchParams(current); updated.set("section", next); return updated; }, { replace: true });
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 py-4 md:flex-row md:gap-10">
      <NativeSelect aria-label="Settings section" className="w-full md:hidden [&>select]:min-h-12" value={section} onChange={(event) => changeSection(event.target.value)}>
        {sections.map((item) => <NativeSelectOption key={item.id} value={item.id}>{item.title}</NativeSelectOption>)}
        {isAdmin ? <NativeSelectOption value="limits">Limits</NativeSelectOption> : null}
      </NativeSelect>
      <Tabs orientation="vertical" value={section} onValueChange={changeSection} className="w-full md:flex-1">
        <TabsList aria-label="Settings sections" className="hidden h-auto w-full items-stretch gap-1 bg-transparent p-0 md:flex md:w-56 md:shrink-0">
          {sections.map((item) => <TabsTrigger key={item.id} value={item.id} className="min-h-12 justify-start px-3 text-left">{item.title}</TabsTrigger>)}
          {isAdmin ? <TabsTrigger value="limits" className="min-h-12 justify-start px-3 text-left">Limits</TabsTrigger> : null}
        </TabsList>
        <div className="min-w-0 w-full max-w-3xl flex-1">
          {sections.map((item) => <TabsContent key={item.id} value={item.id} className="mt-0 flex flex-col gap-5">
            <header className="flex flex-col gap-1"><h2 className="text-xl font-semibold">{item.title}</h2><p className="text-sm text-muted-foreground">{item.description}</p></header>
            {item.id === "profile" ? <ProfileCard person={person} /> : null}
            {item.id === "appearance" ? <>
              <NextSettingsRenderer scope="person" scopeValue={`person:${person.id}`} only={["profile.appearance"]} includeKeys={["ui.appearance", "ui.look"]} />
              <Collapsible>
                <Card><CardHeader className="pb-2"><CollapsibleTrigger className="flex min-h-12 w-full items-center justify-between text-left font-medium">Advanced<span aria-hidden>⌄</span></CollapsibleTrigger></CardHeader><CollapsibleContent><CardContent className="pt-0"><NextSettingsRenderer scope="person" scopeValue={`person:${person.id}`} only={["profile.appearance"]} includeKeys={["ui.enrollment_sounds", "ui.show_turn_stats"]} /></CardContent></CollapsibleContent></Card>
              </Collapsible>
            </> : null}
            {item.id === "voice-ai" ? <><NextSettingsRenderer scope="person" scopeValue={`person:${person.id}`} only={["person.persona", "person.voice", "person.search"]} /><ManagementLinks links={["Voices", "Commands"]} /></> : null}
            {item.id === "notifications" ? <NotificationSettings person={person} /> : null}
            {item.id === "privacy-data" ? <><ManagementLinks links={["Devices"]} /><div className="grid gap-4 sm:grid-cols-2">
              <LinkCard title="Storage" description="Usage against your storage limit." to="/storage" />
              <LinkCard title="Privacy" description="See what connects to the internet and what stays here." to="/privacy" />
              <LinkCard title="Status" description="See whether the parts of MaiPai are working." to="/status" />
            </div></> : null}
          </TabsContent>)}
          {isAdmin ? <TabsContent value="limits" className="mt-0 flex flex-col gap-5"><header className="flex flex-col gap-1"><h2 className="text-xl font-semibold">Limits</h2><p className="text-sm text-muted-foreground">Manage daily time and storage limits.</p></header><NextSettingsRenderer scope="person" scopeValue={`person:${person.id}`} only={["person.allowance", "person.storage"]} /></TabsContent> : null}
        </div>
      </Tabs>
    </div>
  );
}

function ProfileCard({ person }: { person: Roster }) {
  return <Card><CardHeader><CardTitle>Your profile</CardTitle><CardDescription>Your household role and profile photo.</CardDescription></CardHeader><CardContent className="flex flex-wrap items-center gap-4"><Avatar name={person.display_name} seed={person.avatar_seed} className="size-16" /><div className="min-w-0 flex-1"><p className="font-medium">{person.display_name}</p><p className="text-sm text-muted-foreground">{ROLE_LABELS[person.role]}</p></div><Link to={`/people/${person.id}`}><Button type="button" variant="outline" className="min-h-12">Edit profile</Button></Link></CardContent></Card>;
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

import { Link } from "react-router-dom";
import { Card, CardDescription, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@maipai/ui/src/dashboard/components/ui/collapsible";
import { NextSettingsRenderer } from "@/next/pages/settings/NextSettingsRenderer";
import { SettingsSectionFrame, type SettingsSection } from "@/next/pages/settings/SettingsSectionFrame";

const definitions = [
  { id: "general", label: "General", description: "Set your household name, location, language, and history options." },
  { id: "people", label: "People", description: "Manage the people and accounts in your household." },
  { id: "ai", label: "AI", description: "Choose models and check the parts that power MaiPai." },
  { id: "integrations", label: "Integrations", description: "Connect services and manage your reference library." },
  { id: "storage", label: "Storage and backups", description: "Set storage limits and manage your backups." },
  { id: "maintenance", label: "Maintenance", description: "Keep MaiPai up to date and review its health." },
] as const;

export function NextHouseholdSettings() {
  const sections: SettingsSection[] = definitions.map((section) => ({
    ...section,
    render: renderSection(section.id),
  }));
  return <SettingsSectionFrame sections={sections} defaultSection="general" />;
}

function renderSection(id: typeof definitions[number]["id"]) {
  if (id === "general") return <NextSettingsRenderer scope="household" scopeValue="household" only={["household.system"]} />;
  if (id === "people") return <div className="grid gap-4 sm:grid-cols-2">
    <LinkCard title="Users" description="Add, edit, and remove household accounts." to="/users" />
    <LinkCard title="Family" description="View and manage your family." to="/people" />
  </div>;
  if (id === "ai") return <>
    <LinkCard title="AI models" description="Download, choose, and manage the household's AI models." to="/models" />
    <LinkCard title="Status" description="Engines and health are on the Status page." to="/status" />
    <Collapsible>
      <Card>
        <CardHeader className="pb-2">
          <CollapsibleTrigger className="flex min-h-12 w-full items-center justify-between text-left font-medium">Advanced AI settings<span aria-hidden>⌄</span></CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent className="px-6 pb-5">
          <NextSettingsRenderer scope="household" scopeValue="household" only={["household.ai"]} expandAdvanced />
        </CollapsibleContent>
      </Card>
    </Collapsible>
  </>;
  if (id === "integrations") return <><NextSettingsRenderer scope="household" scopeValue="household" only={["household.integrations", "household.notifications", "household.reference", "robot.settings"]} includeKeysByGroup={{ "robot.settings": ["household.quiet_hours.from", "household.quiet_hours.to"] }} /><p className="text-sm text-muted-foreground">Household quiet hours apply to children. Adults and teens can set their own hours in Profile → Notifications.</p></>;
  if (id === "storage") return <>
    <NextSettingsRenderer scope="household" scopeValue="household" only={["household.storage"]} />
    <div className="grid gap-4 sm:grid-cols-2">
      <LinkCard title="Backups" description="Review backup history and restore a copy." to="/backups" />
      <LinkCard title="Storage" description="Review household storage and usage." to="/storage" />
    </div>
  </>;
  return <div className="grid gap-4 sm:grid-cols-2">
    <LinkCard title="Updates" description="See what's available and what is up to date." to="/updates" />
    <LinkCard title="Repairs" description="Review issues and the fixes they need." to="/repairs" />
    <LinkCard title="Performance" description="Review reply times, queues, and disk use." to="/performance" />
  </div>;
}

function LinkCard({ title, description, to }: { title: string; description: string; to: string }) {
  return <Link to={to} className="block"><Card className="h-full py-4 transition-colors hover:bg-accent"><CardHeader><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader></Card></Link>;
}

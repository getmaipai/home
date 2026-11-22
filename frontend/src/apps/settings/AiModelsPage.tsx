// STACK-MODELS-HOME-01 (owner decision, 2026-11-21): Settings, AI and models is the one shared page the Stack's admin page also draws
// (`StackModelsPage` in `@maipai/ui`). The Stack holds every model choice; this page reads and saves through Home's forwarder (`/api/ai/stack/*`),
// so a choice made here and one made on the Stack's own page are the same choice. Home adds only what is Home's: who may use each level (people),
// the disk, backup and updates links, and the plain notice for any old value the Stack did not take.
import { i18n } from "@lingui/core";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { StackModelsPage, type StackNavTarget } from "@maipai/ui/src/stack/StackModelsPage";
import { Button } from "@maipai/ui/src/ui/button";
import { createHomeStackClient } from "@/lib/stackModelsClient";
import { AiLevelAccess } from "@/apps/settings/AiLevelAccess";
import { AiMigrationNotice } from "@/apps/settings/AiMigrationNotice";
import type { SettingsViewProps } from "@/shell/pages/settings/settingsViews";

const ROUTES: Record<StackNavTarget, string> = { resources: "/performance", disk: "/storage", updates: "/updates", health: "/repairs" };
const NOT_ADULT = "Only an adult admin can change the AI and models.";

export function AiModelsPage({ person }: SettingsViewProps) {
  const navigate = useNavigate();
  // One client per mounted page: the shared page keeps one cache per client object.
  const client = useMemo(() => createHomeStackClient(), []);
  // The routes behind it answer 403 to anyone but an owner or admin; the page also says so before the person tries.
  const lockedItems = useMemo((): Record<string, string> => (person.role === "owner" || person.role === "admin" ? {} : { recommended: i18n._({ id: NOT_ADULT, message: NOT_ADULT }), "free-space": i18n._({ id: NOT_ADULT, message: NOT_ADULT }), "add-model": i18n._({ id: NOT_ADULT, message: NOT_ADULT }), priority: i18n._({ id: NOT_ADULT, message: NOT_ADULT }) }), [person.role]);
  const extraSections = useMemo(() => [
    { id: "level-access", title: i18n._({ id: "Who can use each level", message: "Who can use each level" }), description: i18n._({ id: "The model for each level is chosen above. Here you choose which people may use Boost and Max.", message: "The model for each level is chosen above. Here you choose which people may use Boost and Max." }), content: <AiLevelAccess client={client} /> },
    { id: "storage-backups", title: i18n._({ id: "Storage and backups", message: "Storage and backups" }), content: <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" onClick={() => navigate("/storage")}>{i18n._({ id: "Storage", message: "Storage" })}</Button><Button type="button" variant="outline" size="sm" onClick={() => navigate("/backups")}>{i18n._({ id: "Backups", message: "Backups" })}</Button></div> },
  ], [client, navigate]);
  return <div className="flex min-w-0 flex-col gap-4" data-testid="ai-features">
    <AiMigrationNotice />
    <StackModelsPage client={client} lockedItems={lockedItems} extraSections={extraSections} onNavigate={(target) => navigate(ROUTES[target])} />
  </div>;
}

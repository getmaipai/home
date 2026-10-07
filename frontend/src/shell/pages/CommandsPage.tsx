import { CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { getIcon } from "@maipai/ui/src/icons";
import { CommandsSection } from "@/apps/settings/CommandsSection";
import { useTabItem } from "@/shell/tabIdentity";
import type { Roster } from "@/lib/api";

export const CommandsIcon = getIcon("workflow");

/** Adult command authoring; the household list lives in Home settings. */
export function CommandsPage({ person }: { person: Roster }) {
  useTabItem("Create command");
  return (
    <div className="flex flex-col gap-4">
      <CardHeader className="p-0">
        <CardTitle className="flex items-center gap-2"><CommandsIcon size={16} className="text-muted-foreground" />Create a command</CardTitle>
      </CardHeader>
      <CommandsSection person={person} />
    </div>
  );
}

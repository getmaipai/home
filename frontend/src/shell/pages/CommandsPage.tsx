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
      <CommandsSection person={person} />
    </div>
  );
}

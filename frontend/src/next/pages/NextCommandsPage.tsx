import { CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { getIcon } from "@maipai/ui/src/icons";
import { CommandsSection } from "@/apps/settings/CommandsSection";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import type { Roster } from "@/lib/api";

export const CommandsIcon = getIcon("workflow");

/** Household command management; the existing section owns its role checks. */
export function NextCommandsPage({ person }: { person: Roster }) {
  useDocumentTitle("Commands");
  return (
    <div className="flex flex-col gap-4">
      <CardHeader className="p-0">
        <CardTitle className="flex items-center gap-2"><CommandsIcon size={16} className="text-muted-foreground" />Commands</CardTitle>
      </CardHeader>
      <CommandsSection person={person} />
    </div>
  );
}

import { BackupsSection } from "@/apps/settings/BackupsSection";
import type { Roster } from "@/lib/api";
import { useTabItem } from "@/shell/tabIdentity";
import { getIcon } from "@maipai/ui/src/icons";

export const BackupsIcon = getIcon("archive");

export function BackupsPage({ person }: { person: Roster }) {
  useTabItem("Backups");
  return (
    <main>
      <h1>Backups</h1>
      <BackupsSection person={person} />
    </main>
  );
}

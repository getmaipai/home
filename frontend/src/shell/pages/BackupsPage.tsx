import { BackupsSection } from "@/apps/settings/BackupsSection";
import type { Roster } from "@/lib/api";
import { useTabItem } from "@/shell/tabIdentity";
import { getIcon } from "@maipai/ui/src/icons";

export const BackupsIcon = getIcon("archive");

export function BackupsPage({ person }: { person: Roster }) {
  useTabItem("Backups");
  return (
    // AUDIT-UI-01: the header bar already names this page; the body does not say it again.
    <BackupsSection person={person} headed={false} />
  );
}

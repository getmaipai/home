import { CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { getIcon } from "@maipai/ui/src/icons";
import { VoiceCatalogSection } from "@/apps/settings/VoiceCatalogSection";
import { ClonedVoicesSection } from "@/apps/settings/ClonedVoicesSection";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import type { Roster } from "@/lib/api";

export const VoicesIcon = getIcon("audio-waveform");

/** Personal voice choices and recordings, composed from the existing
 * settings sections. Their own APIs enforce the applicable permissions. */
export function NextVoicesPage({ person }: { person: Roster }) {
  useDocumentTitle("Voices");
  return (
    <div className="flex flex-col gap-4">
      <CardHeader className="p-0">
        <CardTitle className="flex items-center gap-2"><VoicesIcon size={16} className="text-muted-foreground" />Voices</CardTitle>
      </CardHeader>
      <VoiceCatalogSection personId={person.id} />
      <ClonedVoicesSection person={person} />
    </div>
  );
}

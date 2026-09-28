import { CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { getIcon } from "@maipai/ui/src/icons";
import { DevicesSection } from "@/apps/settings/DevicesSection";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

export const DevicesIcon = getIcon("monitor");

/** Current-person devices and sessions, using the existing scoped section. */
export function NextDevicesPage() {
  useDocumentTitle("Devices");
  return (
    <div className="flex flex-col gap-4">
      <CardHeader className="p-0">
        <CardTitle className="flex items-center gap-2"><DevicesIcon size={16} className="text-muted-foreground" />Devices</CardTitle>
      </CardHeader>
      <DevicesSection />
    </div>
  );
}

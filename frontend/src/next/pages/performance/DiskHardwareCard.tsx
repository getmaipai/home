import { getIcon } from "@maipai/ui/src/icons";
import DataTable from "@maipai/ui/src/dashboard/components/tables/data-table/DataTable";
import { Card, CardHeader, CardContent, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import type { PerformanceDisk, PerformanceHardware } from "@/lib/api";

const DatabaseIcon = getIcon("database");

interface AreaRow extends Record<string, unknown> {
  area: string;
  gb: string;
}

function toGb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

/** ADMIN-PERF-01: disk (`storageSummary()`, already real) and the raw
 * hardware passthrough's `configured` state only - the Stack hasn't
 * spec'd the hardware shape itself yet (routes/engines.ts's own
 * `HardwareSchema` takes the identical honest-passthrough posture), so
 * this card states whether a reading exists rather than guessing at
 * fields inside it. `GET /api/storage` has no `/next` page of its own
 * yet (`routes/storage.ts`'s own header: "none of it has a UI yet") -
 * no link to name here until one exists. */
export function DiskHardwareCard({ disk, hardware }: { disk: PerformanceDisk; hardware: PerformanceHardware }) {
  return (
    <Card className="flex flex-col gap-0!">
      <CardHeader className="border-b border-border">
        <CardTitle className="flex items-center gap-2">
          <DatabaseIcon size={16} className="text-muted-foreground" />
          Storage & hardware
        </CardTitle>
      </CardHeader>
      <CardContent className="p-5 flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          {toGb(disk.free_bytes)} free of {toGb(disk.total_bytes)}
        </p>
        <DataTable data={disk.areas.map((a): AreaRow => ({ area: a.area, gb: toGb(a.bytes) }))} />
        <p className="text-sm text-muted-foreground">Hardware reading: {hardware.configured ? (hardware.hardware ? "available" : "Stack configured, no reading yet") : "no Stack configured"}</p>
      </CardContent>
    </Card>
  );
}

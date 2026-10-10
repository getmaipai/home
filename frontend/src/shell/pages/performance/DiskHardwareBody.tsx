import { DataTable } from "@maipai/ui/src/elements/data-table";
import { tableColumns, useDataTableModel } from "@/shell/components/dataTableModel";
import { DataTableControls } from "@/shell/components/DataTableControls";
import type { PerformanceDisk, PerformanceHardware } from "@/lib/api";

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
 * fields inside it. `GET /api/storage` has no `/` page of its own
 * yet (`routes/storage.ts`'s own header: "none of it has a UI yet") -
 * no link to name here until one exists. */
export function DiskHardwareBody({ disk, hardware }: { disk: PerformanceDisk; hardware: PerformanceHardware }) {
  const rows: AreaRow[] = disk.areas.map((a) => ({ area: a.area, gb: toGb(a.bytes) }));
  const model = useDataTableModel(rows, tableColumns<AreaRow>(["area", "gb"], { area: 200, gb: 100 }));
  return (
    <>
      <p className="mb-4 text-sm text-muted-foreground">
        {toGb(disk.free_bytes)} free of {toGb(disk.total_bytes)}
      </p>
      <DataTable {...model} toolbar={<DataTableControls model={model} />} caption="Storage areas" getRowId={(row) => row.area} />
      <p className="mt-4 text-sm text-muted-foreground">Hardware reading: {hardware.configured ? (hardware.hardware ? "available" : "Stack configured, no reading yet") : "no Stack configured"}</p>
    </>
  );
}

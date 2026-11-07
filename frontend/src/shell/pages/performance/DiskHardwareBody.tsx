import { i18n } from "@lingui/core";
import { DataTable } from "@maipai/ui/src/elements/data-table";
import { formatBytes } from "@maipai/ui/src/format";
import { tableColumns, useDataTableModel } from "@/shell/components/dataTableModel";
import { DataTableControls } from "@/shell/components/DataTableControls";
import type { PerformanceDisk, PerformanceHardware } from "@/lib/api";

interface AreaRow extends Record<string, unknown> {
  area: string;
  gb: string;
}

function toGb(bytes: number): string {
  formatBytes(bytes);
  return i18n._({ id: "{gb} GB", message: "{gb} GB", values: { gb: (bytes / 1024 ** 3).toFixed(1) } });
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
  const model = useDataTableModel(rows, tableColumns<AreaRow>(["area", "gb"], { area: 200, gb: 100 }, { area: i18n._({ id: "Area", message: "Area" }), gb: i18n._({ id: "Size", message: "Size" }) }));
  return (
    <>
      <p className="mb-4 text-sm text-muted-foreground">{i18n._({ id: "{free} free of {total}", message: "{free} free of {total}", values: { free: toGb(disk.free_bytes), total: toGb(disk.total_bytes) } })}</p>
      <DataTable {...model.tableProps} toolbar={model.rows.length >= 10 ? <DataTableControls model={model} /> : undefined} caption={i18n._({ id: "Storage areas", message: "Storage areas" })} getRowId={(row) => row.area} />
      <p className="mt-4 text-sm text-muted-foreground">{i18n._({ id: "Hardware reading: {value}", message: "Hardware reading: {value}", values: { value: hardware.configured ? (hardware.hardware ? i18n._({ id: "available", message: "available" }) : i18n._({ id: "Stack configured, no reading yet", message: "Stack configured, no reading yet" })) : i18n._({ id: "no Stack configured", message: "no Stack configured" }) } })}</p>
    </>
  );
}

// MEM-SPACE-05/06: one capability table, drawn from the Stack's fits_ever; the wizard and Settings > Performance both use it, so there is no second copy.
import { i18n } from "@lingui/core";
import { useQuery } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@maipai/ui/src/ui/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@maipai/ui/src/ui/card";
import { request } from "@/lib/api";

export interface CapabilityData {
  available: boolean; machine_class: string;
  rows: { category: string; label: string; cells: { tier: "standard" | "boost" | "max"; fits: boolean; needs_bytes: number | null }[] }[];
}
const tiers = () => [["standard", i18n._({ id: "Standard", message: "Standard" })], ["boost", i18n._({ id: "Boost", message: "Boost" })], ["max", i18n._({ id: "Max", message: "Max" })]] as const;
const gb = (bytes: number) => Math.round(bytes / 1024 ** 3);

export function capabilityWords(cell: CapabilityData["rows"][number]["cells"][number] | undefined): string {
  if (!cell) return i18n._({ id: "Not offered", message: "Not offered" });
  if (cell.fits) return i18n._({ id: "Yes", message: "Yes" });
  return cell.needs_bytes ? i18n._({ id: "No, needs {gb} GB", message: "No, needs {gb} GB", values: { gb: gb(cell.needs_bytes) } }) : i18n._({ id: "No", message: "No" });
}

/** The Stack reading as a table; hides itself when the Stack is older or not running yet. `path` picks the route (setup before the owner exists, Performance after). */
export function CapabilityTable({ path, framed = false }: { path: string; framed?: boolean }) {
  const { data } = useQuery({ queryKey: ["capabilities", path], queryFn: () => request<CapabilityData>(path), retry: false });
  if (!data?.available || data.rows.length === 0) return null;
  const table = (
    <Table data-testid="capability-table">
      <TableHeader><TableRow><TableHead>{i18n._({ id: "Kind of job", message: "Kind of job" })}</TableHead>{tiers().map(([id, label]) => <TableHead key={id}>{label}</TableHead>)}</TableRow></TableHeader>
      <TableBody>
        {data.rows.map((row) => (
          <TableRow key={row.category}>
            <TableCell>{row.label}</TableCell>
            {tiers().map(([tier]) => <TableCell key={tier}>{capabilityWords(row.cells.find((cell) => cell.tier === tier))}</TableCell>)}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
  if (!framed) return table;
  return (
    <section data-testid="capabilities">
      <Card surface="flat">
        <CardHeader><CardTitle>{i18n._({ id: "What this computer can do", message: "What this computer can do" })}</CardTitle><CardDescription>{i18n._({ id: "Which of Standard, Boost and Max this computer can ever run for each kind of job.", message: "Which of Standard, Boost and Max this computer can ever run for each kind of job." })}</CardDescription></CardHeader>
        <CardContent>{table}</CardContent>
      </Card>
    </section>
  );
}

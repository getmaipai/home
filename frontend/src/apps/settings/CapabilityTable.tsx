// MEM-SPACE-05/06: one capability table, drawn from the Stack's fits_ever; the wizard and Settings > Performance both use it, so there is no second copy.
import { useQuery } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@maipai/ui/src/ui/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { request } from "@/lib/api";

export interface CapabilityData {
  available: boolean; machine_class: string;
  rows: { category: string; label: string; cells: { tier: "standard" | "boost" | "max"; fits: boolean; needs_bytes: number | null }[] }[];
}
const TIERS = [["standard", "Standard"], ["boost", "Boost"], ["max", "Max"]] as const;
const gb = (bytes: number) => Math.round(bytes / 1024 ** 3);

export function capabilityWords(cell: CapabilityData["rows"][number]["cells"][number] | undefined): string {
  if (!cell) return "Not offered";
  if (cell.fits) return "Yes";
  return cell.needs_bytes ? `No, needs ${gb(cell.needs_bytes)} GB` : "No";
}

/** The Stack reading as a table; hides itself when the Stack is older or not running yet. `path` picks the route (setup before the owner exists, Performance after). */
export function CapabilityTable({ path, framed = false }: { path: string; framed?: boolean }) {
  const { data } = useQuery({ queryKey: ["capabilities", path], queryFn: () => request<CapabilityData>(path), retry: false });
  if (!data?.available || data.rows.length === 0) return null;
  const table = (
    <Table data-testid="capability-table">
      <TableHeader><TableRow><TableHead>Kind of job</TableHead>{TIERS.map(([, label]) => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader>
      <TableBody>
        {data.rows.map((row) => (
          <TableRow key={row.category}>
            <TableCell>{row.label}</TableCell>
            {TIERS.map(([tier, label]) => <TableCell key={label}>{capabilityWords(row.cells.find((cell) => cell.tier === tier))}</TableCell>)}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
  if (!framed) return table;
  return (
    <section data-testid="capabilities">
      <Card>
        <CardHeader><CardTitle>What this computer can do</CardTitle><CardDescription>Which of Standard, Boost and Max this computer can ever run for each kind of job.</CardDescription></CardHeader>
        <CardContent>{table}</CardContent>
      </Card>
    </section>
  );
}

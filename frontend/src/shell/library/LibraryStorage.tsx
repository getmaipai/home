// The plain storage meter: the person's own bytes by kind against their limit, from the same route the Storage page uses,
// so the two always agree. Identical files count once. Never another person's usage.
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Button } from "@maipai/ui/src/ui/button";
import { StorageBar, type StorageBarSegment } from "@maipai/ui/src/primitives/StorageBar";
import { formatBytes } from "@maipai/ui/src/format";
import { api, type Roster } from "@/lib/api";

const KIND_LABELS: Record<string, string> = { image: "Pictures", video: "Videos", audio: "Songs", document: "Documents", story: "Stories", other: "Other" };
const ORDER = ["image", "video", "audio", "document", "story", "other"];

export function LibraryStorage({ me }: { me: Roster }) {
  const usage = useQuery({ queryKey: ["storage-usage"], queryFn: () => api.storageUsage() });
  const row = usage.data?.people.find((person) => person.personId === me.id);
  if (usage.isError) return <p className="text-base text-muted-foreground">Home could not read your storage. Reload the page to try again.</p>;
  if (!row) return null;
  const merged = new Map<string, number>();
  for (const entry of row.byKind) merged.set(entry.kind, (merged.get(entry.kind) ?? 0) + entry.bytes);
  const segments: StorageBarSegment[] = ORDER.filter((kind) => (merged.get(kind) ?? 0) > 0).map((kind) => ({ id: kind, label: KIND_LABELS[kind] ?? kind, bytes: merged.get(kind)! }));
  const capacity = row.capBytes > 0 ? row.capBytes : null;
  const full = capacity !== null && row.usageBytes >= capacity * 0.95;
  const child = me.role === "child";
  const admin = me.role === "owner" || me.role === "admin";
  return (
    <section aria-label="Storage" className="flex flex-col gap-2" data-testid="library-storage">
      <p className="text-base font-medium">{capacity ? `${formatBytes(row.usageBytes)} of ${formatBytes(capacity)} used` : `${formatBytes(row.usageBytes)} used`}</p>
      <StorageBar segments={segments} capacityBytes={capacity} />
      <p className="text-base text-muted-foreground">Identical files count once.</p>
      {full ? <p className="text-base">{child ? "Your storage is almost full. Ask a grown-up if you need more room." : "Your storage is almost full. Delete some files, or raise the limit in Settings, Storage."}</p> : null}
      {admin ? <div><Button asChild variant="link"><Link to="/storage">Everyone's storage</Link></Button></div> : null}
    </section>
  );
}

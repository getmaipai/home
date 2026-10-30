import { useState } from "react";
import { useHeaderExtra } from "@maipai/ui/src/dashboard/layouts/full/vertical/header/HeaderExtraContext";
import { PageHeaderTitle } from "@/shell/pageHeaderTitle";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SettingsShell } from "@maipai/ui/src/settings/SettingsShell";
import type { SettingsAreaDef } from "@maipai/ui/src/settings/settingsAudience";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { Alert, AlertDescription } from "@maipai/ui/src/dashboard/components/ui/alert";
import { Empty, EmptyDescription, EmptyHeader } from "@maipai/ui/src/dashboard/components/ui/empty";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@maipai/ui/src/dashboard/components/ui/alert-dialog";
import { request, type Roster } from "@/lib/api";
import { baseViewer } from "@/shell/pages/settings/settingsViewer";
import { useTabItem } from "@/shell/tabIdentity";
import "@/shell/pages/settings/settingsTokens.css";

export interface TrashRow {
  kind: string; id: string; title: string; deleted_at: string; trash_until: string | null; can_restore: boolean; can_purge: boolean;
}
// Storage's record actions have no preference keys. The kit owns the settings layout.
const TRASH_AREA: SettingsAreaDef = {
  id: "storage-trash", title: "Storage", audience: { min_role: "guest" }, groups: [{ label: "Storage", sections: ["trash"] }], sections: [{ id: "trash", label: "Trash", icon: "trash", kind: "view", view: "trash" }],
};
export function TrashPage({ person }: { person: Roster }) {
  useHeaderExtra(PageHeaderTitle);
  useTabItem("Trash");
  const navigate = useNavigate();
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["trash", person.id], queryFn: () => request<{ rows: TrashRow[] }>("/api/trash") });
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState<TrashRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function act(row: TrashRow, restore: boolean) {
    setBusy(true);
    setError(null);
    try {
      const path = `/api/trash/${encodeURIComponent(row.kind)}/${encodeURIComponent(row.id)}`;
      await request(path + (restore ? "/restore" : ""), { method: restore ? "POST" : "DELETE" });
      setPending(null);
      await client.invalidateQueries({ queryKey: ["trash", person.id] });
    } catch {
      setError(restore ? "Home could not restore this item. Refresh Trash and try again." : "Home could not delete this item forever. Refresh Trash and try again.");
    } finally { setBusy(false); }
  }
  const rows = query.data?.rows.filter((row) => row.title.toLocaleLowerCase().includes(search.toLocaleLowerCase())) ?? [];
  return <>
    <SettingsShell area={TRASH_AREA} viewer={baseViewer(person)} activeSection="trash" layout="docked" contentAs="section"
      sectionHref={() => "/storage/trash"} onNavigate={() => navigate("/storage/trash")}
      searchQuery={search} onSearchChange={setSearch} onBack={() => navigate("/storage")}
      backLink={<Button variant="link" nativeButton={false} render={<Link to="/storage" />}>Storage</Button>}>
      {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription><Button onClick={() => void query.refetch()}>Refresh Trash</Button></Alert> : null}
      {query.isError ? <Alert variant="destructive"><AlertDescription>Home could not load Trash. Try again.</AlertDescription><Button onClick={() => void query.refetch()}>Try again</Button></Alert> : query.isPending ? <p>Loading Trash</p> : rows.length === 0 ? <Empty><EmptyHeader><EmptyDescription>{search ? "No items match your search." : "Trash is empty. Things you delete stay here for 30 days."}</EmptyDescription></EmptyHeader></Empty> :
        <ItemGroup>{rows.map((row) => <Item key={`${row.kind}:${row.id}`}>
          <ItemContent><ItemTitle>{row.title}</ItemTitle><ItemDescription>{row.trash_until ? `Kept until ${new Date(row.trash_until).toLocaleDateString()}` : "Waiting for removal"}</ItemDescription></ItemContent>
          <ItemActions><Button disabled={busy || !row.can_restore} onClick={() => void act(row, true)}>Restore</Button><Button variant="destructive" disabled={busy || !row.can_purge} onClick={() => setPending(row)}>Delete forever</Button></ItemActions>
        </Item>)}</ItemGroup>}
    </SettingsShell>
    {pending ? <AlertDialog open onOpenChange={(open) => { if (!open && !busy) setPending(null); }}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete forever?</AlertDialogTitle><AlertDialogDescription>This removes the item from Home for good. You cannot undo this.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={busy} onClick={() => { if (pending) void act(pending, false); }}>Delete forever</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
    </AlertDialog> : null}
  </>;
}

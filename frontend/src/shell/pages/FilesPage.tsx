import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getIcon } from "@maipai/ui/src/icons";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { Input } from "@maipai/ui/src/ui/input";
import { Select } from "@maipai/ui/src/primitives/Select";
import { File } from "@maipai/ui/src/elements/file";
import { DataTable } from "@/shell/components/DataTable";
import { api, ApiError, type PersonRosterEntry, type Roster, type VisibleFile } from "@/lib/api";
import { useTabItem } from "@/shell/tabIdentity";

export const FilesIcon = getIcon("folder");

const KIND_LABELS: Record<string, string> = { image: "Image", video: "Video", audio: "Audio", document: "Document", story: "Story", other: "File" };
const kindLabel = (kind: string) => KIND_LABELS[kind] ?? KIND_LABELS.other!;

interface FileRow extends Record<string, unknown> {
  file: string;
  owner: string;
  kind: string;
  id: string;
}

/** The old /files Library, rebuilt with the Home page patterns. It keeps
 * STORE-SHARE-01's real visibility semantics and share management while
 * moving the direct route into the current sidebar. */
export function FilesPage({ person }: { person: Roster }) {
  useTabItem("Library");
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("all");
  const [kind, setKind] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [shareTarget, setShareTarget] = useState("household");
  const queryClient = useQueryClient();
  const filesQuery = useQuery<VisibleFile[]>({ queryKey: ["files"], queryFn: () => api.files() });
  const peopleQuery = useQuery<PersonRosterEntry[]>({ queryKey: ["people"], queryFn: () => api.people() });
  const rows = filesQuery.data ?? [];
  const people = peopleQuery.data ?? [];
  const nameFor = (id: string) => id === person.id ? "You" : people.find((entry) => entry.id === id)?.display_name ?? id;
  // STORE-DELETE-01: a file whose owner left while it was shared is listed
  // under the household, with who shared it.
  const ownerLabel = (row: VisibleFile) => row.household ? `Household, shared by ${row.former_owner_name ?? "someone no longer here"}` : nameFor(row.owner_person_id);
  const filtered = rows.filter((row) => {
    if (source === "mine" && row.shared) return false;
    if (source === "shared" && !row.shared) return false;
    if (kind !== "all" && row.file.kind !== kind) return false;
    const text = `${row.file.media_type} ${row.file.id} ${ownerLabel(row)} ${kindLabel(row.file.kind)}`.toLocaleLowerCase();
    return text.includes(search.trim().toLocaleLowerCase());
  });
  const selected = rows.find((row) => row.file.id === selectedId) ?? null;
  const canManageSelected = selected !== null && !selected.shared;
  const sharesQuery = useQuery({ queryKey: ["file-shares", selectedId], queryFn: () => api.fileShares(selectedId!), enabled: canManageSelected && selectedId !== null });
  const shareTargets = people.filter((entry) => entry.id !== person.id);
  const tableRows: FileRow[] = filtered.map((row) => {
    const visible = {
      file: row.file.media_type,
      owner: ownerLabel(row),
      kind: kindLabel(row.file.kind),
    };
    Object.defineProperty(visible, "id", { value: row.file.id });
    return visible as FileRow;
  });

  async function shareSelected() {
    if (!selected) return;
    try {
      await api.shareFile(selected.file.id, shareTarget);
      await queryClient.invalidateQueries({ queryKey: ["file-shares", selected.file.id] });
    } catch (error) { toast.error(error instanceof ApiError ? error.message : "Could not share that file."); }
  }

  async function unshare(shareId: string) {
    try {
      await api.unshare(shareId);
      await queryClient.invalidateQueries({ queryKey: ["file-shares", selectedId] });
      await queryClient.invalidateQueries({ queryKey: ["files"] });
    } catch (error) { toast.error(error instanceof ApiError ? error.message : "Could not unshare that file."); }
  }

  return (
    <div className="flex flex-col gap-4 pb-4">
      <CardHeader>
        <CardTitle><span className="flex items-center gap-2"><FilesIcon size={16} className="text-muted-foreground" />Library</span></CardTitle>
      </CardHeader>
      <AsyncState data={filesQuery.data} error={filesQuery.isError} isFetching={filesQuery.isFetching} onRetry={() => filesQuery.refetch()} errorMessage={filesQuery.error instanceof ApiError ? filesQuery.error.message : "Could not load your Library."} loadingLabel="Loading your files">
        {() => <>
          <Card>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-2">
                <label htmlFor="library-search" className="text-sm font-medium">Search your Library</label>
                <Input id="library-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search files" />
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="library-source" className="text-sm font-medium">Whose</label>
                <Select aria-label="Whose" value={source} onValueChange={setSource} options={["all", "mine", "shared"]} getLabel={(value) => ({ all: "Everyone", mine: "Mine", shared: "Shared with me" })[value as "all" | "mine" | "shared"] ?? value} />
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="library-kind" className="text-sm font-medium">Kind</label>
                <Select aria-label="Kind" value={kind} onValueChange={setKind} options={["all", ...Object.keys(KIND_LABELS)]} getLabel={(value) => value === "all" ? "All kinds" : kindLabel(value)} />
              </div>
              </div>
            </CardContent>
          </Card>
          <DataTable data={tableRows} rowKey={(row) => row.id} rowActions={(row) => [{ label: "View details", onClick: () => setSelectedId(row.id) }]} emptyMessage="Nothing here yet. Stories, pictures and documents you make in chat are kept here." />
          {tableRows.length > 0 ? (
            <Card>
              <CardHeader><CardTitle>File details</CardTitle></CardHeader>
              <CardContent>
                <div className="flex flex-col gap-3">
                <label htmlFor="library-file" className="text-sm font-medium">Select a file</label>
                <Select aria-label="Select a file" value={selectedId ?? "none"} onValueChange={(value) => setSelectedId(value === "none" ? null : value)} options={["none", ...filtered.map((row) => row.file.id)]} getLabel={(value) => {
                  const row = rows.find((entry) => entry.file.id === value);
                  return value === "none" ? "Choose a file" : row ? `${row.file.media_type}, ${ownerLabel(row)}` : value;
                }} />
                {selected ? <>
                  <FileDetails file={selected} ownerLabel={ownerLabel(selected)} kindLabel={kindLabel(selected.file.kind)} />
                  <dl className="grid gap-2 text-sm sm:grid-cols-2">
                    <div><dt className="text-muted-foreground">Retention</dt><dd>{selected.file.retention === "kept" ? "Kept until deleted" : "Follows the conversation"}</dd></div>
                  </dl>
                  {canManageSelected ? <div className="flex flex-col gap-3 border-t border-border pt-3">
                    <h2 className="text-sm font-medium">Shared with</h2>
                    {(sharesQuery.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">Not shared with anyone yet.</p> : (sharesQuery.data ?? []).map((share) => <div key={share.id} className="flex items-center justify-between gap-2"><span className="truncate text-sm">{share.to === "household" ? "The whole household" : nameFor(share.to)}</span><Button variant="outline" size="row" onClick={() => void unshare(share.id)}>Unshare</Button></div>)}
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Select aria-label="Share with" value={shareTarget} onValueChange={setShareTarget} options={["household", ...shareTargets.map((entry) => entry.id)]} getLabel={(value) => value === "household" ? "The whole household" : shareTargets.find((entry) => entry.id === value)?.display_name ?? value} />
                      <Button size="row" onClick={() => void shareSelected()}>Share</Button>
                    </div>
                  </div> : null}
                </> : null}
                </div>
              </CardContent>
            </Card>
          ) : null}
        </>}
      </AsyncState>
    </div>
  );
}

function FileDetails({ file, ownerLabel, kindLabel }: { file: VisibleFile; ownerLabel: string; kindLabel: string }) {
  return <>
    <File.Root>
      <File.Icon mimeType={file.file.media_type} />
      <File.Name>{file.file.id}</File.Name>
      <File.Size bytes={file.file.size} />
      <File.Download data={new URL(api.fileContentUrl(file.file.id), window.location.origin === "null" ? "http://localhost" : window.location.origin).href} sourceType="url" mimeType={file.file.media_type} filename={file.file.id} hitArea48 />
    </File.Root>
    <dl className="grid gap-2 text-sm sm:grid-cols-2">
      <div><dt className="text-muted-foreground">Owner</dt><dd>{ownerLabel}</dd></div>
      <div><dt className="text-muted-foreground">Kind</dt><dd>{kindLabel}</dd></div>
    </dl>
  </>;
}

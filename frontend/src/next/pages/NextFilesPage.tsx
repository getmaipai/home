import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getIcon } from "@maipai/ui/src/icons";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { NextDataTable } from "@/next/components/NextDataTable";
import { api, ApiError, type PersonRosterEntry, type Roster, type VisibleFile } from "@/lib/api";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

export const FilesIcon = getIcon("folder");

const KIND_LABELS: Record<string, string> = { image: "Image", video: "Video", audio: "Audio", document: "Document", story: "Story", other: "File" };
const kindLabel = (kind: string) => KIND_LABELS[kind] ?? KIND_LABELS.other!;

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB"];
  let value = size / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

interface FileRow extends Record<string, unknown> {
  file: string;
  owner: string;
  kind: string;
  size: string;
  id: string;
}

/** The old /files Library, rebuilt with the Home page patterns. It keeps
 * STORE-SHARE-01's real visibility semantics and share management while
 * moving the direct route into the current sidebar. */
export function NextFilesPage({ person }: { person: Roster }) {
  useDocumentTitle("Library");
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
  const filtered = rows.filter((row) => {
    if (source === "mine" && row.shared) return false;
    if (source === "shared" && !row.shared) return false;
    if (kind !== "all" && row.file.kind !== kind) return false;
    const text = `${row.file.media_type} ${row.file.id} ${nameFor(row.owner_person_id)} ${kindLabel(row.file.kind)}`.toLocaleLowerCase();
    return text.includes(search.trim().toLocaleLowerCase());
  });
  const selected = rows.find((row) => row.file.id === selectedId) ?? null;
  const canManageSelected = selected !== null && !selected.shared;
  const sharesQuery = useQuery({ queryKey: ["file-shares", selectedId], queryFn: () => api.fileShares(selectedId!), enabled: canManageSelected && selectedId !== null });
  const shareTargets = people.filter((entry) => entry.id !== person.id);
  const tableRows: FileRow[] = filtered.map((row) => {
    const visible = {
      file: row.file.media_type,
      owner: nameFor(row.owner_person_id),
      kind: kindLabel(row.file.kind),
      size: formatBytes(row.file.size),
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
      <CardHeader className="p-0">
        <CardTitle className="flex items-center gap-2"><FilesIcon size={16} className="text-muted-foreground" />Library</CardTitle>
      </CardHeader>
      <AsyncState data={filesQuery.data} error={filesQuery.isError} isFetching={filesQuery.isFetching} onRetry={() => filesQuery.refetch()} errorMessage={filesQuery.error instanceof ApiError ? filesQuery.error.message : "Could not load your Library."} loadingLabel="Loading your files">
        {() => <>
          <Card>
            <CardContent className="grid gap-4 p-4 sm:grid-cols-3">
              <div className="flex flex-col gap-2">
                <label htmlFor="library-search" className="text-sm font-medium">Search your Library</label>
                <input id="library-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search files" className="h-12 rounded-md border border-input bg-background px-3 text-sm" />
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="library-source" className="text-sm font-medium">Whose</label>
                <select id="library-source" value={source} onChange={(event) => setSource(event.target.value)} className="h-12 rounded-md border border-input bg-background px-3 text-sm">
                  <option value="all">Everyone</option><option value="mine">Mine</option><option value="shared">Shared with me</option>
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="library-kind" className="text-sm font-medium">Kind</label>
                <select id="library-kind" value={kind} onChange={(event) => setKind(event.target.value)} className="h-12 rounded-md border border-input bg-background px-3 text-sm">
                  <option value="all">All kinds</option>{Object.entries(KIND_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </div>
            </CardContent>
          </Card>
          <NextDataTable data={tableRows} rowKey={(row) => row.id} rowActions={(row) => [{ label: "View details", onClick: () => setSelectedId(row.id) }]} emptyMessage="Nothing here yet. Stories, pictures and documents you make in chat are kept here." />
          {tableRows.length > 0 ? (
            <Card>
              <CardHeader className="border-b border-border"><CardTitle>File details</CardTitle></CardHeader>
              <CardContent className="flex flex-col gap-3 p-4">
                <label htmlFor="library-file" className="text-sm font-medium">Select a file</label>
                <select id="library-file" value={selectedId ?? "none"} onChange={(event) => setSelectedId(event.target.value === "none" ? null : event.target.value)} className="h-12 rounded-md border border-input bg-background px-3 text-sm">
                  <option value="none">Choose a file</option>{filtered.map((row) => <option key={row.file.id} value={row.file.id}>{row.file.media_type} — {nameFor(row.owner_person_id)}</option>)}
                </select>
                {selected ? <>
                  <dl className="grid gap-2 text-sm sm:grid-cols-2">
                    <div><dt className="text-muted-foreground">Owner</dt><dd>{nameFor(selected.owner_person_id)}</dd></div>
                    <div><dt className="text-muted-foreground">Kind</dt><dd>{kindLabel(selected.file.kind)}</dd></div>
                    <div><dt className="text-muted-foreground">Size</dt><dd>{formatBytes(selected.file.size)}</dd></div>
                    <div><dt className="text-muted-foreground">Retention</dt><dd>{selected.file.retention === "kept" ? "Kept until deleted" : "Follows the conversation"}</dd></div>
                  </dl>
                  {canManageSelected ? <div className="flex flex-col gap-3 border-t border-border pt-3">
                    <h2 className="text-sm font-medium">Shared with</h2>
                    {(sharesQuery.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">Not shared with anyone yet.</p> : (sharesQuery.data ?? []).map((share) => <div key={share.id} className="flex items-center justify-between gap-2"><span className="truncate text-sm">{share.to === "household" ? "The whole household" : nameFor(share.to)}</span><Button variant="outline" className="min-h-12" onClick={() => void unshare(share.id)}>Unshare</Button></div>)}
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <select aria-label="Share with" value={shareTarget} onChange={(event) => setShareTarget(event.target.value)} className="h-12 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm">
                        <option value="household">The whole household</option>{shareTargets.map((entry) => <option key={entry.id} value={entry.id}>{entry.display_name}</option>)}
                      </select>
                      <Button className="min-h-12" onClick={() => void shareSelected()}>Share</Button>
                    </div>
                  </div> : null}
                </> : null}
              </CardContent>
            </Card>
          ) : null}
        </>}
      </AsyncState>
    </div>
  );
}

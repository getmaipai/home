import { useEffect, useState } from "react";
import { Button } from "@maipai/ui/src/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@maipai/ui/src/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { FolderPicker, type FolderPickerCopy } from "@maipai/ui/src/primitives/FolderPicker";
import { api, ApiError, type SetupFolderListing, type SetupPlacementRow } from "@/lib/api";

export interface StorageChoice { models?: string; records?: string }
type FolderClass = "models" | "records";

const PICKER_ERROR = "Home couldn't open that folder. Go up a level or pick another folder, then try again.";
const COPY: Record<FolderClass, { title: string; about: string; pickerTitle: string }> = {
  models: { title: "AI models folder", about: "Where Home keeps the AI models it downloads. Models are large, so pick a drive with plenty of free space.", pickerTitle: "Choose the AI models folder" },
  records: { title: "Home's data folder", about: "Where Home keeps your family's chats, people and memories.", pickerTitle: "Choose Home's data folder" },
};
const PICKER_COPY = (title: string): FolderPickerCopy => ({
  title,
  upLabel: "Up one level",
  chooseLabel: "Use this folder",
  newFolderLabel: "New folder",
  newFolderNameLabel: "Name for the new folder",
  createLabel: "Create folder",
  cancelLabel: "Cancel",
  emptyText: "There are no folders in here. Use this folder, or make a new one.",
  errorText: PICKER_ERROR,
  retryLabel: "Try again",
  loadingLabel: "Loading folders",
  freeSpaceLabel: (formatted) => `${formatted} free on this drive`,
});

/** Placement rows as the sentences shown to the owner. */
export function placementLine(row: SetupPlacementRow): string {
  // Some refusal texts already end with the next step; do not say it twice.
  if (/\b(choose|pick|go up|make)\b/i.test(row.text)) return row.text.trim();
  return `${row.text} ${row.fix}`.trim();
}

// Every row is passed as openable: the kit greys out a row it is told is not
// writable, but a folder Home cannot write to (/Volumes, /Users) must still be
// opened to reach a drive or a home folder inside it. "Use this folder" is
// disabled inside a folder Home cannot write to instead.
export function StorageStep({ split, value, onChange }: {
  /** The engine runs on another computer: only Home's data folder is asked here. */
  split: boolean;
  value: StorageChoice;
  /** `blocked` is true while a check runs or a refusal stands, so Continue waits. */
  onChange: (value: StorageChoice, blocked: boolean) => void;
}) {
  const [picking, setPicking] = useState<FolderClass | null>(null);
  const [listing, setListing] = useState<SetupFolderListing | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [lastPath, setLastPath] = useState<string | undefined>(undefined);
  const [rows, setRows] = useState<SetupPlacementRow[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  const kinds: FolderClass[] = split ? ["records"] : ["models", "records"];
  const layout: StorageChoice = { ...(!split && value.models ? { models: value.models } : {}), ...(value.records ? { records: value.records } : {}) };
  const layoutKey = JSON.stringify(layout);
  const chosen = Object.keys(layout).length > 0;

  useEffect(() => {
    if (!chosen) { setRows(null); setCheckError(null); setChecking(false); return; }
    let active = true;
    setChecking(true);
    setCheckError(null);
    void api.setupStorageCheck(layout).then(
      (result) => { if (active) setRows(result.rows); },
      (reason) => { if (active) { setRows(null); setCheckError(reason instanceof ApiError ? reason.message : "Home couldn't check that folder. Choose it again, or keep the default folder."); } },
    ).finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
    // The layout is read through its key so an equal object does not re-run the check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey]);

  const refused = (rows ?? []).some((row) => row.kind === "refusal");
  const blocked = picking !== null || checking || refused || checkError !== null;
  useEffect(() => { onChange(value, blocked); }, [layoutKey, blocked]); // eslint-disable-line react-hooks/exhaustive-deps

  async function open(path: string | undefined) {
    setLoading(true);
    setPickerError(null);
    try {
      const next = await api.setupFolders(path);
      setListing(next);
      setLastPath(next.path);
    } catch (reason) {
      setPickerError(reason instanceof ApiError ? reason.message : PICKER_ERROR);
    } finally { setLoading(false); }
  }

  function startPicking(which: FolderClass) {
    setPicking(which);
    setListing(undefined);
    void open(value[which]);
  }

  function choose(path: string) {
    if (!picking) return;
    onChange({ ...value, [picking]: path }, true);
    setPicking(null);
  }

  async function create(name: string) {
    if (!listing) return;
    setLoading(true);
    setPickerError(null);
    try {
      const made = await api.setupCreateFolder(listing.path, name);
      const next = await api.setupFolders(made.path);
      setListing(next);
      setLastPath(next.path);
    } catch (reason) {
      setPickerError(reason instanceof ApiError ? reason.message : PICKER_ERROR);
    } finally { setLoading(false); }
  }

  const problems = rows ?? [];
  return (
    <div className="flex flex-col gap-4">
      {split ? <p className="text-base text-muted-foreground md:text-lg">The AI runs on your other computer, so you choose its models folder there. Here you only choose where Home keeps its own data.</p> : null}
      {kinds.map((which) => {
        const copy = COPY[which];
        const path = layout[which];
        return (
          <Card key={which}>
            <CardHeader>
              <CardTitle>{copy.title}</CardTitle>
              <CardDescription>{copy.about}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="break-all text-base md:text-lg">{path ?? "The ready-to-use folder (recommended)"}</p>
              {picking === which ? (
                <FolderPicker
                  listing={listing ? { path: listing.path, parent: listing.parent, freeBytes: listing.freeBytes, rows: listing.folders.map((folder) => ({ name: folder.name, path: folder.path, writable: true })) } : undefined}
                  copy={PICKER_COPY(copy.pickerTitle)}
                  loading={loading}
                  error={pickerError !== null}
                  onRetry={() => void open(lastPath)}
                  onOpen={(next) => void open(next)}
                  onUp={() => { if (listing?.parent) void open(listing.parent); }}
                  onChoose={choose}
                  onCreate={(name) => void create(name)}
                  chooseDisabled={listing ? !listing.writable : false}
                />
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" size="lg" disabled={picking !== null} onClick={() => startPicking(which)}>{path ? "Choose a different folder" : "Choose a folder"}</Button>
                  {path ? <Button type="button" variant="ghost" size="lg" disabled={picking !== null} onClick={() => onChange({ ...value, [which]: undefined }, true)}>Keep the default</Button> : null}
                </div>
              )}
              {picking === which && pickerError ? <p role="alert">{pickerError}</p> : null}
              {picking === which && listing && !listing.writable ? <p className="text-base text-muted-foreground md:text-lg">Home can't save files in this folder. Go up and pick a folder you own, or make a new one here.</p> : null}
              {picking === which ? <Button type="button" variant="ghost" size="lg" onClick={() => setPicking(null)}>Cancel</Button> : null}
            </CardContent>
          </Card>
        );
      })}
      {checking ? <p role="status" className="text-base text-muted-foreground md:text-lg">Checking that Home can use your choice.</p> : null}
      {checkError ? <Alert variant="destructive"><AlertTitle>Home couldn't check your choice</AlertTitle><AlertDescription>{checkError}</AlertDescription></Alert> : null}
      {problems.map((row) => (
        <Alert key={`${row.class}-${row.id}`} variant={row.kind === "refusal" ? "destructive" : "warning"}>
          <AlertTitle>{row.kind === "refusal" ? "Home can't use this folder" : "Worth knowing"}</AlertTitle>
          <AlertDescription>{placementLine(row)}</AlertDescription>
        </Alert>
      ))}
      {chosen && !checking && !checkError && rows && rows.length === 0 && picking === null ? <p role="status" className="text-base text-muted-foreground md:text-lg">Home can use your choice. Press Continue when you are ready.</p> : null}
    </div>
  );
}

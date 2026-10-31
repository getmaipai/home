import { getIcon } from "@maipai/ui/src/icons";
import { useEffect, useState } from "react";
import { Button } from "@maipai/ui/src/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@maipai/ui/src/ui/alert";
import { Card, CardContent, CardHeader } from "@maipai/ui/src/dashboard/components/ui/card";
import { FolderPicker, type FolderPickerCopy } from "@maipai/ui/src/primitives/FolderPicker";
import { RouteSkeleton } from "@maipai/ui/src/primitives/RouteSkeleton";
import { needGb } from "../../../../shared/diskPlanMath";
import { api, ApiError, type SetupFolderListing, type SetupPlacementRow } from "@/lib/api";

const ErrorIcon = getIcon("circle-alert");

const CheckIcon = getIcon("check");

export interface StorageChoice { models?: string; records?: string }
type FolderClass = "models" | "records";

const PICKER_ERROR = "Home couldn't open that folder. Go up a level or pick another folder, then try again.";
const COPY: Record<FolderClass, { title: string; about: string; pickerTitle: string }> = {
  models: { title: "AI models", about: "Home saves your pick, but for now downloads the AI models to its default folder.", pickerTitle: "Choose the AI models folder" },
  records: { title: "Home's data", about: "Your family's chats, people and memories. Small, usually well under 5 GB.", pickerTitle: "Choose Home's data folder" },
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
  const [windowOpen, setWindowOpen] = useState<FolderClass | null>(null);
  const [nativeRefusal, setNativeRefusal] = useState<{ which: FolderClass; text: string } | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [lastPath, setLastPath] = useState<string | undefined>(undefined);
  const [rows, setRows] = useState<SetupPlacementRow[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [defaults, setDefaults] = useState<{ records: string; models: string; models_need_bytes?: number } | null>(null);
  // A choice already saved on the server (after a reload, or coming Back) is shown again.
  useEffect(() => {
    api.setupStorageDefaults().then((result) => {
      setDefaults(result);
      const saved = result.chosen ?? {};
      if (!value.records && !value.models && (saved.records || saved.models)) onChange({ ...(saved.records ? { records: saved.records } : {}), ...(!split && saved.models ? { models: saved.models } : {}) }, true);
    }, () => setDefaults(null));
    // Read once on mount; the saved choice only fills an empty one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const kinds: FolderClass[] = split ? ["records"] : ["records", "models"];
  const layout: StorageChoice = { ...(!split && value.models ? { models: value.models } : {}), ...(value.records ? { records: value.records } : {}) };
  const layoutKey = JSON.stringify(layout);

  useEffect(() => {
    let active = true;
    setChecking(true);
    setCheckError(null);
    void api.setupStorageCheck({ ...layout, split }).then(
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

  // This computer's own folder window first; the in-page picker when there is none.
  async function startPicking(which: FolderClass) {
    setPicking(which);
    setWindowOpen(which);
    setListing(undefined);
    setPickerError(null);
    setNativeRefusal(null);
    try {
      const native = await api.setupNativeFolder(which);
      if (native.status === "chosen") { onChange({ ...value, [which]: native.path }, true); setPicking(null); return; }
      if (native.status === "cancelled") { setPicking(null); return; }
      if (native.status === "refused") { setPicking(null); setNativeRefusal({ which, text: native.error }); return; }
    } catch { /* fall through to the in-page picker */ } finally { setWindowOpen(null); }
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
      {split ? <p className="text-base text-muted-foreground md:text-lg">The AI models folder is set on your other computer.</p> : null}
      {kinds.map((which) => {
        const copy = COPY[which];
        const path = layout[which];
        const own = problems.filter((row) => row.class === which);
        const state = own.some((row) => row.kind === "refusal") ? "invalid" : checking || rows === null || checkError ? undefined : "valid";
        return (
          <Card key={which} state={state}>
            <CardHeader>
              <h2 className="text-2xl font-semibold md:text-3xl">{copy.title}</h2>
              <p className="text-base text-muted-foreground md:text-lg">{copy.about}{which === "models" && defaults?.models_need_bytes ? ` Plan for about ${needGb(defaults.models_need_bytes)} GB free there.` : ""}</p>
            </CardHeader>
            <CardContent>
              <p className="break-all text-base md:text-lg">{path ?? defaults?.[which] ?? "Default folder"}</p>
              {windowOpen === which ? (
                <p role="status" className="pt-3 text-base text-muted-foreground md:text-lg">Choose a folder in the window that just opened.</p>
              ) : picking === which ? (
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
                <div className="flex flex-wrap gap-2 pt-3">
                  <Button type="button" variant="secondary" size="lg" disabled={picking !== null} onClick={() => void startPicking(which)}>{path ? "Choose a different folder" : "Choose a folder"}</Button>
                  {path ? <Button type="button" variant="ghost" size="lg" disabled={picking !== null} onClick={() => onChange({ ...value, [which]: undefined }, true)}>Keep the default</Button> : null}
                </div>
              )}
              {nativeRefusal?.which === which ? <div className="pt-3"><Alert variant="destructive"><AlertDescription>{nativeRefusal.text}</AlertDescription></Alert></div> : null}
              {picking === which && pickerError ? <Alert variant="destructive"><ErrorIcon /><AlertDescription>{pickerError}</AlertDescription></Alert> : null}
              {picking === which && listing && !listing.writable ? <p className="text-base text-muted-foreground md:text-lg">Home can't save files in this folder. Go up and pick a folder you own, or make a new one here.</p> : null}
              {picking === which && windowOpen !== which ? <Button type="button" variant="ghost" size="lg" onClick={() => setPicking(null)}>Cancel</Button> : null}
              {picking !== which ? own.map((row) => (
                <div key={row.id} className="pt-3">
                  <Alert variant={row.kind === "refusal" ? "destructive" : "warning"}>
                    <AlertTitle>{row.kind === "refusal" ? "Home can't use this folder" : "Worth knowing"}</AlertTitle>
                    <AlertDescription>{placementLine(row)}</AlertDescription>
                  </Alert>
                </div>
              )) : null}
              {picking !== which && state === "valid" && own.length === 0 ? <p role="status" className="flex items-center gap-2 pt-3 text-base font-medium text-[color:var(--hue-teal)]"><CheckIcon aria-hidden className="size-5" />Home can use this folder.</p> : null}
            </CardContent>
          </Card>
        );
      })}
      {checking ? <RouteSkeleton label="Checking that Home can use your choice" /> : null}
      {checkError ? <Alert variant="destructive"><AlertTitle>Home couldn't check your choice</AlertTitle><AlertDescription>{checkError}</AlertDescription></Alert> : null}
      {problems.filter((row) => !kinds.includes(row.class as FolderClass)).map((row) => (
        <Alert key={`${row.class}-${row.id}`} variant={row.kind === "refusal" ? "destructive" : "warning"}>
          <AlertTitle>{row.kind === "refusal" ? "Home can't use this folder" : "Worth knowing"}</AlertTitle>
          <AlertDescription>{placementLine(row)}</AlertDescription>
        </Alert>
      ))}
    </div>
  );
}

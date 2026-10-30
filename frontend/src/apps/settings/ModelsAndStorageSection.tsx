// COMPONENTS-01: Settings, Engines and AI, Models and storage. Every installable part of the AI as a row with its
// size, state and what uses it, an Install and an Uninstall with a plain confirmation, and the room left on this
// computer. Admins only (the settings area gates the page and the routes gate it again). Progress is the row's own
// bar (rule S6: one job's progress lives on its own card) and the same job feeds the install strip above. A
// failure is the Stack's Repairs item with Try again; this page shows the sentence and the same Try again.
// Kit primitives only (rule 9b).
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@maipai/ui/src/ui/alert";
import { Badge } from "@maipai/ui/src/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { JobProgress } from "@maipai/ui/src/elements/job-progress";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@maipai/ui/src/dashboard/components/ui/alert-dialog";
import { ApiError } from "@/lib/api";
import { componentsApi, type ComponentGroup, type ComponentRow } from "@/lib/componentsApi";
import { downloadProgress } from "@/lib/downloadProgress";

const KEY = ["components"] as const;
const GROUPS: Array<{ id: ComponentGroup; title: string }> = [
  { id: "chat", title: "Chat and thinking" }, { id: "voice", title: "Voice" }, { id: "pictures", title: "Pictures" },
  { id: "video", title: "Video" }, { id: "music", title: "Music" }, { id: "tools", title: "Picture tools" }, { id: "loras", title: "Styles you added" },
];

export const sizeWords = (n: number): string => (n >= 1e12 ? `${(n / 1e12).toFixed(1)} TB` : n >= 1e9 ? `${n >= 1e10 ? Math.round(n / 1e9) : (n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const messageOf = (error: unknown, fallback: string) => (error instanceof ApiError ? error.message : fallback);

/** "today", "3 weeks ago": how long since a part was last used, for the person deciding what to free. */
export function lastUsedWords(iso: string | null, now = Date.now()): string {
  if (!iso) return "Not used yet";
  const days = Math.floor((now - Date.parse(iso)) / 86_400_000);
  if (!Number.isFinite(days) || days <= 0) return "Used today";
  if (days === 1) return "Used yesterday";
  if (days < 14) return `Used ${days} days ago`;
  if (days < 60) return `Used ${Math.floor(days / 7)} weeks ago`;
  return `Used ${Math.floor(days / 30)} months ago`;
}

function stateBadge(row: ComponentRow): { text: string; variant: "secondary" | "destructive" | "outline" } {
  if (row.state === "installing") return { text: "Installing", variant: "secondary" };
  if (row.state === "failed") return { text: "Did not finish", variant: "destructive" };
  if (row.state === "installed") return { text: row.requirement === "required" ? "Installed, needed" : "Installed", variant: "secondary" };
  if (row.requirement === "unsupported") return { text: "Not for this computer", variant: "outline" };
  // A recommended part an upgrade did not pull (Detailed video, 74 GB): said quietly here, with the Install button; never a notification.
  if (row.plan_need === "recommended") return { text: "Recommended, not installed", variant: "outline" };
  return { text: "Not installed", variant: "outline" };
}

function Row({ row, refresh, setError }: { row: ComponentRow; refresh: () => void; setError: (message: string | null) => void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [licenceOpen, setLicenceOpen] = useState(false);
  const badge = stateBadge(row);
  const installed = row.state === "installed";
  // A part with a licence of its own asks once: the admin reads the points and accepts, then the install starts.
  // A licence the household's acknowledgement covers is information only: the row just installs (LICENCE-ACK-01).
  const needsLicence = !!row.licence && !row.licence.accepted_at && !row.licence.covered;
  async function install(accepted?: string) {
    setError(null); setBusy(true);
    try { await componentsApi.install(row.id, accepted); refresh(); }
    catch (e) { setError(messageOf(e, `Could not start installing ${row.label}. Check that the engine is running, then try again.`)); }
    finally { setBusy(false); }
  }
  async function uninstall() {
    setError(null); setConfirm(false); setBusy(true);
    try { await componentsApi.uninstall(row.id); refresh(); }
    catch (e) { setError(messageOf(e, `Could not remove ${row.label}. Try again.`)); }
    finally { setBusy(false); }
  }
  const facts = [
    installed || row.state === "installing" ? (row.size_bytes ? `Uses ${sizeWords(row.size_bytes)}` : null) : row.download_bytes > 0 ? `Download about ${sizeWords(row.download_bytes)}` : null,
    installed ? lastUsedWords(row.last_used_at) : null,
    row.used_by.length ? `Used by: ${row.used_by.join(", ")}` : null,
  ].filter(Boolean).join(" · ");
  // The plain reason a button is off sits under the row, so it never hides in a tooltip.
  const reason = row.state === "failed" && row.failure ? row.failure
    : !installed && row.state !== "installing" && !row.can_install ? row.install_block
    : installed && !row.can_uninstall ? row.uninstall_block : null;
  return (
    <>
      <Item data-testid={`component-${row.id}`}>
        <ItemContent>
          <ItemTitle>{row.label} <Badge variant={badge.variant}>{badge.text}</Badge></ItemTitle>
          <ItemDescription clamp={false}>{row.summary}{facts ? ` ${facts}` : ""}</ItemDescription>
          {row.state === "installing" ? <JobProgress {...downloadProgress({ title: row.label, state: "running", status: "Downloading and installing", percent: row.percent ?? undefined })} variant="full" /> : null}
          {reason ? <p className="text-sm text-muted-foreground">{reason}</p> : null}
        </ItemContent>
        <ItemActions>
          {!installed && row.state !== "installing" ? (
            <Button type="button" onClick={() => (needsLicence ? setLicenceOpen(true) : void install())} disabled={busy || !row.can_install} aria-label={`${row.state === "failed" ? "Try again: " : "Install "}${row.label}`}>{row.state === "failed" ? "Try again" : "Install"}</Button>
          ) : null}
          {installed ? (
            <Button type="button" variant="outline" onClick={() => setConfirm(true)} disabled={busy || !row.can_uninstall} aria-label={`Uninstall ${row.label}`}>Uninstall</Button>
          ) : null}
        </ItemActions>
      </Item>
      {row.licence && needsLicence ? (
        <AlertDialog open={licenceOpen} onOpenChange={setLicenceOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Before you get {row.label}</AlertDialogTitle>
              <AlertDialogDescription>It comes with its maker's licence ({row.licence.name}). Read these points, then accept to start the {sizeWords(row.download_bytes || row.full_bytes)} download. You only need to accept once for this computer.</AlertDialogDescription>
            </AlertDialogHeader>
            <div className="flex max-h-72 flex-col gap-3 overflow-y-auto text-sm">
              <ul className="flex list-disc flex-col gap-2 pl-5">{row.licence.summary.map((line) => <li key={line}>{line}</li>)}</ul>
              <p>The full licence: <span className="font-mono break-all">{row.licence.url}</span></p>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Not now</AlertDialogCancel>
              <AlertDialogAction onClick={() => { setLicenceOpen(false); void install(row.licence!.id); }}>I accept, get it</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Uninstall {row.label}?</AlertDialogTitle>
            <AlertDialogDescription>This frees {sizeWords(row.size_bytes ?? 0)}. You can install it again later.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => void uninstall()}>Uninstall</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** LICENCE-ACK-01: the one admin prompt (a Home that never saw the wizard's licence wording), then the one extras button. */
function LicencePrompt({ refresh, setError, installing }: { refresh: () => void; setError: (message: string | null) => void; installing: boolean }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const query = useQuery({ queryKey: ["licences"], queryFn: componentsApi.licences });
  const data = query.data;
  if (!data || data.stack !== "ok") return null;
  const done = () => { void queryClient.invalidateQueries({ queryKey: ["licences"] }); refresh(); };
  async function accept() {
    setError(null); setBusy(true); setOpen(false);
    try { await componentsApi.acceptLicences(); done(); } catch (e) { setError(messageOf(e, "Home couldn't save your accept. Check that the engine is running, then press Accept again.")); } finally { setBusy(false); }
  }
  async function installExtras() {
    setError(null); setBusy(true);
    try { await componentsApi.installExtras(); done(); } catch (e) { setError(messageOf(e, "Home couldn't start the extras. Check that the engine is running, then try again.")); } finally { setBusy(false); }
  }
  if (data.needs_prompt) return (
    <section aria-label="Licences" data-testid="licence-prompt">
    <Alert>
      <AlertTitle>Accept the licences for the AI models Home installs</AlertTitle>
      <AlertDescription>
        <p>Accept once, and Home installs any of them without asking again.</p>
        <Button type="button" onClick={() => setOpen(true)} disabled={busy}>See the licences</Button>
      </AlertDescription>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Licences of the AI models Home installs</AlertDialogTitle>
            <AlertDialogDescription>These are the licences that come with parts Home installs for you. Accepting covers all of them.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex max-h-72 flex-col gap-4 overflow-y-auto text-sm">
            {data.licences.map((licence) => (
              <div key={licence.id} className="flex flex-col gap-1">
                <p className="font-medium">{licence.label}: {licence.name}</p>
                <ul className="flex list-disc flex-col gap-1 pl-5">{licence.summary.map((line) => <li key={line}>{line}</li>)}</ul>
                <p>The full licence: <span className="font-mono break-all">{licence.url}</span></p>
              </div>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Not now</AlertDialogCancel>
            <AlertDialogAction onClick={() => void accept()}>Accept</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Alert>
    </section>
  );
  if (data.extras && !installing) return (
    <section aria-label="Recommended extras" data-testid="licence-extras">
    <Alert>
      <AlertTitle>Recommended extras are not installed</AlertTitle>
      <AlertDescription>
        <p>{data.extras.labels.join(", ")}. The licences are accepted. Progress shows on the install strip.</p>
        <Button type="button" onClick={() => void installExtras()} disabled={busy}>Install the recommended extras ({data.extras.size})</Button>
      </AlertDescription>
    </Alert>
    </section>
  );
  return null;
}

export function ModelsAndStorageSection() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: KEY, queryFn: componentsApi.list,
    refetchInterval: (q) => (q.state.data?.components?.some((row) => row.state === "installing") ? 2000 : 30_000),
  });
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: KEY }); };
  const data = query.data;
  return (
    <section aria-labelledby="models-storage-heading" className="flex flex-col gap-3">
      <h2 id="models-storage-heading" className="text-lg font-semibold">Models and storage</h2>
      {data ? (
        <p className="text-sm text-muted-foreground">
          {sizeWords(data.installed_bytes)} of AI on this computer{data.free_disk_bytes !== null ? `, ${sizeWords(data.free_disk_bytes)} free` : ""}. Add or remove parts here. Everything stays on this computer.
        </p>
      ) : null}
      <LicencePrompt refresh={refresh} setError={setError} installing={!!data?.components?.some((row) => row.state === "installing")} />
      {query.isError ? <Alert variant="destructive"><AlertTitle>The list did not load</AlertTitle><AlertDescription>{messageOf(query.error, "Check that Home is running, then reload this page.")}</AlertDescription></Alert> : null}
      {data?.stack === "unreachable" ? <Alert><AlertTitle>The AI engine isn't answering</AlertTitle><AlertDescription>{data.message ?? "Check that the engine is running, then reload this page."}</AlertDescription></Alert> : null}
      {error ? <Alert variant="destructive"><AlertTitle>That did not work</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
      {data?.stack === "ok" ? GROUPS.map((group) => {
        const rows = (data.components ?? []).filter((row) => row.group === group.id);
        if (rows.length === 0) return null;
        return (
          <section key={group.id} aria-label={group.title} className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">{group.title}</h3>
            <ItemGroup variant="card" aria-label={group.title}>
              {rows.map((row) => <Row key={row.id} row={row} refresh={refresh} setError={setError} />)}
            </ItemGroup>
          </section>
        );
      }) : null}
    </section>
  );
}

import { i18n } from "@lingui/core";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { Button } from "@maipai/ui/src/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@maipai/ui/src/dashboard/components/ui/alert-dialog";
import { StatusCard } from "@maipai/ui/src/elements/status-card";
import { api, type Roster } from "@/lib/api";
import { errorLine } from "@/lib/hubReachability";
import { formatDateTime } from "@/lib/format";

const KEY = ["adult-auto-locks"] as const;
const pictureCount = (count: number) => count === 1 ? i18n._({ id: "picture", message: "picture" }) : i18n._({ id: "pictures", message: "pictures" });

export function AutoLocksSection({ person }: { person: Roster }) {
  const owner = person.role === "owner";
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: KEY, queryFn: api.autoLocks, enabled: owner });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [resultLine, setResultLine] = useState<string | null>(null);
  const [undoRun, setUndoRun] = useState<string | null>(null);
  const [failureRetry, setFailureRetry] = useState<(() => Promise<void>) | null>(null);
  const count = query.data?.candidates ?? 0;
  if (!owner) return null;

  async function clear() {
    setBusy(true); setActionError(null); setResultLine(null); setFailureRetry(null);
    try {
      const result = await api.clearAutoLocks(count);
      setUndoRun(result.run_id);
      setResultLine(i18n._({ id: result.changed === 1 ? "Done. 1 picture is visible again." : "Done. {count} pictures are visible again.", message: result.changed === 1 ? "Done. 1 picture is visible again." : "Done. {count} pictures are visible again.", values: { count: result.changed } }));
      setConfirming(false);
      await queryClient.invalidateQueries({ queryKey: KEY });
    } catch (cause) {
      const line = errorLine(cause, i18n._({ id: "The cleanup could not be saved. Look again and try once more.", message: "The cleanup could not be saved. Look again and try once more." }));
      setActionError(line);
      if ((cause as { status?: number })?.status === 409) {
        setConfirming(false);
        await queryClient.invalidateQueries({ queryKey: KEY });
      } else { setConfirming(false); setFailureRetry(() => clear); }
    } finally { setBusy(false); }
  }

  async function undo(runId: string) {
    setBusy(true); setActionError(null); setResultLine(null); setFailureRetry(null);
    try {
      const result = await api.undoAutoLocks(runId);
      const changed = result.changed_since ? i18n._({ id: " {count} {pictures} changed since.", message: " {count} {pictures} changed since.", values: { count: result.changed_since, pictures: pictureCount(result.changed_since) } }) : "";
      setResultLine(i18n._({ id: result.restored === 1 ? "Undone. 1 picture is locked again.{changed}" : "Undone. {count} pictures are locked again.{changed}", message: result.restored === 1 ? "Undone. 1 picture is locked again.{changed}" : "Undone. {count} pictures are locked again.{changed}", values: { count: result.restored, changed } }));
      setUndoRun(null);
      await queryClient.invalidateQueries({ queryKey: KEY });
    } catch (cause) {
      setActionError(errorLine(cause, i18n._({ id: "Undo could not be completed. Look again and try once more.", message: "Undo could not be completed. Look again and try once more." })));
      setFailureRetry(() => () => undo(runId));
    } finally { setBusy(false); }
  }

  const lastRun = query.data?.last_run;
  return <section aria-label={i18n._({ id: "Adult lock", message: "Adult lock" })} className="flex flex-col gap-3">
    <ItemGroup variant="card">
      <Item size="setting">
        <ItemContent>
          <ItemTitle>{i18n._({ id: "Clear automatic locks", message: "Clear automatic locks" })}</ItemTitle>
          <ItemDescription clamp={false}>{i18n._({ id: "Some pictures were locked by Home on its own, not by you. Clearing them makes them visible again. Pictures you locked yourself, and adult-style pictures, are never changed.", message: "Some pictures were locked by Home on its own, not by you. Clearing them makes them visible again. Pictures you locked yourself, and adult-style pictures, are never changed." })}</ItemDescription>
          {query.data ? <p className="text-body text-muted-foreground">{count === 0 ? i18n._({ id: "Nothing needs clearing. No picture was locked by Home on its own.", message: "Nothing needs clearing. No picture was locked by Home on its own." }) : i18n._({ id: count === 1 ? "1 picture was locked automatically." : "{count} pictures were locked automatically.", message: count === 1 ? "1 picture was locked automatically." : "{count} pictures were locked automatically.", values: { count } })}</p> : null}
          {lastRun ? <p className="text-body text-muted-foreground">{i18n._({ id: "Last cleared {date}: {pictures}.", message: "Last cleared {date}: {pictures}.", values: { date: formatDateTime(lastRun.at), pictures: `${lastRun.changed} ${pictureCount(lastRun.changed)}` } })}</p> : null}
          {busy ? <p className="text-body text-muted-foreground">{i18n._({ id: "Please wait for this change to finish.", message: "Please wait for this change to finish." })}</p> : null}
        </ItemContent>
        <ItemActions>
          {count > 0 ? <Button type="button" variant="outline" disabled={busy || !query.data} onClick={() => setConfirming(true)}>{i18n._({ id: "Clear {count} locks", message: "Clear {count} locks", values: { count } })}</Button> : null}
          {undoRun && !lastRun?.undone ? <Button type="button" variant="ghost" disabled={busy} onClick={() => void undo(undoRun)}>{i18n._({ id: "Undo", message: "Undo" })}</Button> : null}
        </ItemActions>
      </Item>
    </ItemGroup>
    {query.isError ? <div role="alert"><StatusCard kind="problem" title={i18n._({ id: "That did not work", message: "That did not work" })} line={errorLine(query.error, i18n._({ id: "Could not load automatic locks. Check your connection and try again.", message: "Could not load automatic locks. Check your connection and try again." }))} /><Button type="button" variant="outline" onClick={() => void query.refetch()}>{i18n._({ id: "Try again", message: "Try again" })}</Button></div> : null}
    {actionError ? <div role="alert"><StatusCard kind="problem" title={i18n._({ id: "That did not work", message: "That did not work" })} line={actionError} />{failureRetry ? <Button type="button" variant="outline" disabled={busy} onClick={() => void failureRetry()}>{i18n._({ id: "Try again", message: "Try again" })}</Button> : null}</div> : null}
    {resultLine ? <p role="status" aria-live="polite" className="text-body">{resultLine}</p> : null}
    <AlertDialog open={confirming} onOpenChange={setConfirming}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>{i18n._({ id: "Clear {count} automatic locks? You can undo this right after.", message: "Clear {count} automatic locks? You can undo this right after.", values: { count } })}</AlertDialogTitle><AlertDialogDescription>{i18n._({ id: "Confirm this change to make the automatically locked pictures visible again.", message: "Confirm this change to make the automatically locked pictures visible again." })}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel disabled={busy}>{i18n._({ id: "Cancel", message: "Cancel" })}</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={(event) => { event.preventDefault(); void clear(); }}>{i18n._({ id: "Clear locks", message: "Clear locks" })}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>;
}

// AIMODELS-CLEAN-01: "Free up space" on the AI and models page. Lists the parts nothing uses now, with plain names, sizes and a
// reason, and removes only the ones the person ticks, after one confirm. Never automatic. The server re-checks each id at
// removal time and says what it kept (the in-use guard is the one the Stack already has). Model names do not appear here.
import { i18n } from "@lingui/core";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@maipai/ui/src/ui/alert";
import { Button } from "@maipai/ui/src/ui/button";
import { Checkbox } from "@maipai/ui/src/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@maipai/ui/src/ui/dialog";
import { Skeleton } from "@maipai/ui/src/ui/skeleton";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@maipai/ui/src/dashboard/components/ui/alert-dialog";
import { aiChoicesApi, type CleanupResult } from "@/lib/aiChoicesApi";
import { sizeGb } from "../../../../shared/diskPlanMath";
import { errorLine } from "@/lib/hubReachability";

const KEY = ["ai", "unused"] as const;

export interface FreeUpSpaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after any removal, so the page re-reads its cards and numbers. */
  onChanged?: () => void;
}

const messageOf = (error: unknown, fallback: string) => (errorLine(error, fallback));
const joinNames = (names: string[]) => (names.length <= 1 ? (names[0] ?? "") : i18n._({ id: "{names} and {last}", message: "{names} and {last}", values: { names: names.slice(0, -1).join(", "), last: names[names.length - 1] } }));

export function FreeUpSpaceDialog({ open, onOpenChange, onChanged }: FreeUpSpaceDialogProps) {
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<CleanupResult | null>(null);
  const query = useQuery({ queryKey: KEY, queryFn: aiChoicesApi.unused, enabled: open, staleTime: 0 });
  const remove = useMutation({
    mutationFn: (ids: string[]) => aiChoicesApi.cleanup(ids),
    onSuccess: (done) => {
      setResult(done); setPicked(new Set());
      void queryClient.invalidateQueries({ queryKey: KEY });
      onChanged?.();
    },
  });
  const items = query.data?.items ?? [];
  const total = query.data?.total_bytes ?? 0;
  const chosen = items.filter((item) => picked.has(item.id));
  const chosenBytes = chosen.reduce((sum, item) => sum + item.bytes, 0);
  const allPicked = items.length > 0 && chosen.length === items.length;
  const toggle = (id: string, on: boolean) => setPicked((previous) => { const next = new Set(previous); if (on) next.add(id); else next.delete(id); return next; });
  // The confirm sits outside this dialog's DOM, so a click on it reads as an outside click; ignore that dismissal while it is open.
  const close = (next: boolean) => { if (!next && confirm) return; if (!next) { setResult(null); setConfirm(false); setPicked(new Set()); remove.reset(); } onOpenChange(next); };
  const keptNames = (result?.results ?? []).filter((entry) => entry.status === "kept").map((entry) => entry.message);

  return (
    <>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{i18n._({ id: "Free up space", message: "Free up space" })}</DialogTitle>
            <DialogDescription>
              {query.isLoading ? i18n._({ id: "Looking for parts nothing uses.", message: "Looking for parts nothing uses." }) : items.length > 0 ? i18n._({ id: "You can free {size}. Nothing is removed until you pick it and confirm.", message: "You can free {size}. Nothing is removed until you pick it and confirm.", values: { size: sizeGb(total) } }) : i18n._({ id: "Nothing to clean up.", message: "Nothing to clean up." })}
            </DialogDescription>
          </DialogHeader>
          {query.isLoading ? <Skeleton aria-label={i18n._({ id: "Loading", message: "Loading" })} /> : null}
          {query.isError ? <Alert variant="destructive"><AlertTitle>{i18n._({ id: "The list did not load", message: "The list did not load" })}</AlertTitle><AlertDescription>{messageOf(query.error, i18n._({ id: "Check that Home is running, then open Free up space again.", message: "Check that Home is running, then open Free up space again." }))}</AlertDescription></Alert> : null}
          {remove.isError ? <Alert variant="destructive"><AlertTitle>{i18n._({ id: "That did not work", message: "That did not work" })}</AlertTitle><AlertDescription>{messageOf(remove.error, i18n._({ id: "Check that the engine is running, then try again.", message: "Check that the engine is running, then try again." }))}</AlertDescription></Alert> : null}
          {result ? (
            <Alert>
              <AlertTitle>{result.freed_bytes > 0 ? i18n._({ id: "Freed {size}.", message: "Freed {size}.", values: { size: sizeGb(result.freed_bytes) } }) : i18n._({ id: "Nothing was removed.", message: "Nothing was removed." })}</AlertTitle>
              <AlertDescription>
                {result.kept > 0 ? i18n._({ id: "{count, plural, one {# kept because it is in use. } other {# kept because they are in use. }}", message: "{count, plural, one {# kept because it is in use. } other {# kept because they are in use. }}", values: { count: result.kept } }) : ""}
                {result.failed > 0 ? i18n._({ id: "{count} did not finish. Try again. ", message: "{count} did not finish. Try again. ", values: { count: result.failed } }) : ""}
                {keptNames.join(" ")}
              </AlertDescription>
            </Alert>
          ) : null}
          {!query.isLoading && !query.isError && items.length === 0 && !result ? <p className="text-sm text-muted-foreground">{i18n._({ id: "Everything installed is in use.", message: "Everything installed is in use." })}</p> : null}
          {items.length > 0 ? (
            <>
              <Button type="button" variant="outline" onClick={() => setPicked(allPicked ? new Set() : new Set(items.map((item) => item.id)))}>{allPicked ? i18n._({ id: "Clear all", message: "Clear all" }) : i18n._({ id: "Select all", message: "Select all" })}</Button>
              <ItemGroup variant="card" aria-label={i18n._({ id: "Parts nothing uses", message: "Parts nothing uses" })}>
                {items.map((item) => (
                  <Item key={item.id} data-testid={`unused-${item.id}`}>
                    <ItemActions>
                      <Checkbox id={`unused-check-${item.id}`} checked={picked.has(item.id)} onCheckedChange={(on) => toggle(item.id, on === true)} aria-label={`${item.name}, ${sizeGb(item.bytes)}`} />
                    </ItemActions>
                    <ItemContent>
                      <ItemTitle><label htmlFor={`unused-check-${item.id}`}>{item.name}</label></ItemTitle>
                      <ItemDescription clamp={false}>{sizeGb(item.bytes)}. {item.reason}</ItemDescription>
                    </ItemContent>
                  </Item>
                ))}
              </ItemGroup>
            </>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)}>{i18n._({ id: "Close", message: "Close" })}</Button>
            {items.length > 0 ? (
              <Button type="button" onClick={() => setConfirm(true)} disabled={chosen.length === 0 || remove.isPending}>
                {chosen.length === 0 ? i18n._({ id: "Pick what to remove", message: "Pick what to remove" }) : i18n._({ id: "Remove {count} and free {size}", message: "Remove {count} and free {size}", values: { count: chosen.length, size: sizeGb(chosenBytes) } })}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{i18n._({ id: "Remove {joinNames}?", message: "Remove {joinNames}?", values: { joinNames: joinNames(chosen.map((item) => item.name)) } })}</AlertDialogTitle>
            <AlertDialogDescription>{i18n._({ id: "You can get {value} back later. It is a download of the same size, {joinNames}, and your settings stay. Backups are not affected: they hold your family's data and settings, and models are not part of them.", message: "You can get {value} back later. It is a download of the same size, {joinNames}, and your settings stay. Backups are not affected: they hold your family's data and settings, and models are not part of them.", values: { value: chosen.length === 1 ? i18n._({ id: "it", message: "it" }) : i18n._({ id: "them", message: "them" }), joinNames: joinNames(chosen.map((item) => sizeGb(item.bytes))) } })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{i18n._({ id: "Keep them", message: "Keep them" })}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirm(false); remove.mutate(chosen.map((item) => item.id)); }}>{i18n._({ id: "Remove", message: "Remove" })}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/kit/ui/alert-dialog";
import type { PendingConfirm } from "@/kit/schema/actions";

/** Renders `useDispatchAction()`'s own pending-confirm state as a real
 * dialog (docs/UI.md > Dialog: "AlertDialog... for destructive confirms,
 * no outside-click close"). One instance per SchemaPage, not per node -
 * only one confirm can ever be pending at a time. */
export function ConfirmDialog({ pendingConfirm }: { pendingConfirm: PendingConfirm | null }) {
  return (
    <AlertDialog open={pendingConfirm !== null} onOpenChange={(open) => !open && pendingConfirm?.cancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{pendingConfirm?.prompt}</AlertDialogTitle>
          {pendingConfirm?.error ? <AlertDialogDescription>{pendingConfirm.error}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => pendingConfirm?.cancel()}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => pendingConfirm?.confirm()} disabled={pendingConfirm?.busy}>
            {pendingConfirm?.busy ? "Working…" : "Confirm"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

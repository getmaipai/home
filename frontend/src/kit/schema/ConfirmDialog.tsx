import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/kit/ui/alert-dialog";
import { Button } from "@/kit/ui/button";
import type { PendingConfirm } from "@/kit/schema/actions";

/** Renders `useDispatchAction()`'s own pending-confirm state as a real
 * dialog (docs/UI.md > Dialog: "AlertDialog... for destructive confirms,
 * no outside-click close"). One instance per SchemaPage, not per node -
 * only one confirm can ever be pending at a time.
 *
 * The confirm button is a plain `Button`, not `AlertDialogAction`: Radix's
 * own `AlertDialogPrimitive.Action` closes the dialog itself the instant
 * it's clicked, before this component's `confirm()` (an async call) ever
 * settles - a real bug a code review's own regression test caught live
 * (2026-09-05): a batch action that failed partway through showed no
 * error at all, because the dialog had already closed on click, out from
 * under the still-running request. `pendingConfirm`'s own `busy`/`error`
 * state is the only thing allowed to decide when this dialog closes now. */
export function ConfirmDialog({ pendingConfirm }: { pendingConfirm: PendingConfirm | null }) {
  return (
    <AlertDialog open={pendingConfirm !== null} onOpenChange={(open) => !open && pendingConfirm?.cancel()}>
      <AlertDialogContent
        onEscapeKeyDown={(e) => {
          // Radix closes an AlertDialog on Escape by default, same as any
          // other dismissal - but while `busy` the confirmed action is
          // still running, and cancelling here only hides the dialog
          // (`onOpenChange`'s own cancel() above), it can't actually stop
          // that in-flight request. A code review (2026-09-05) found this
          // meant Escape mid-confirm let the household member believe
          // they'd backed out, while the action's own onSettled callback
          // (e.g. a batch action's exitSelectMode) still fired once it
          // resolved - a side effect landing after they thought they'd
          // cancelled it. Blocked the same way the Cancel/Confirm buttons
          // are already disabled for the same state.
          if (pendingConfirm?.busy) e.preventDefault();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{pendingConfirm?.prompt}</AlertDialogTitle>
          {pendingConfirm?.error ? <AlertDialogDescription>{pendingConfirm.error}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => pendingConfirm?.cancel()} disabled={pendingConfirm?.busy}>
            Cancel
          </AlertDialogCancel>
          <Button onClick={() => pendingConfirm?.confirm()} disabled={pendingConfirm?.busy}>
            {pendingConfirm?.busy ? "Working…" : "Confirm"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

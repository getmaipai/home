import { Fragment, useState } from "react";
import { getIcon } from "@maipai/ui/src/icons";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@maipai/ui/src/dashboard/components/ui/alert-dialog";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@maipai/ui/src/dashboard/components/ui/dropdown-menu";

const MoreHorizontal = getIcon("more-horizontal");

export interface DataTableAction {
  label: string;
  onClick: () => void | Promise<void>;
  disabled?: boolean;
  destructive?: boolean;
  confirmLabel?: string;
}

/** Shipped action controls rendered only through DataTable's rowActions slot. */
export function DataTableRowActions({ actions }: { actions: readonly DataTableAction[] }) {
  const [pending, setPending] = useState<DataTableAction | null>(null);
  if (actions.length === 0) return null;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={
          <Button type="button" variant="ghost" size="row" aria-label="More actions">
            <MoreHorizontal aria-hidden="true" className="size-4" />
            <span>Actions</span>
          </Button>
        } />
        <DropdownMenuContent align="end">
          {actions.map((action, index) => (
            <Fragment key={action.label}>
              {index > 0 && Boolean(action.destructive) !== Boolean(actions[index - 1]?.destructive) && <DropdownMenuSeparator />}
              <DropdownMenuItem
                variant={action.destructive ? "destructive" : "default"}
                disabled={action.disabled}
                onClick={() => action.destructive ? setPending(action) : void action.onClick()}
              >
                {action.label}
              </DropdownMenuItem>
            </Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={pending !== null} onOpenChange={(open) => { if (!open) setPending(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pending?.label}</AlertDialogTitle>
            <AlertDialogDescription>{pending?.confirmLabel ?? `Are you sure you want to ${pending?.label.toLocaleLowerCase()} this item?`}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={async () => {
              if (pending) await pending.onClick();
              setPending(null);
            }}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

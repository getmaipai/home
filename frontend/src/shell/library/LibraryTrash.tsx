import { i18n } from "@lingui/core";
// The Trash section: what the person deleted, how long Home still holds it, Restore and Delete forever. It reads the
// household Trash provider (kind "file"), so this list and the Trash page are one source.
import { useState } from "react";
import { Button } from "@maipai/ui/src/ui/button";
import { DestructiveConfirm } from "@maipai/ui/src/primitives/DestructiveConfirm";
import { EmptyState } from "@maipai/ui/src/primitives/EmptyState";
import type { LibraryTrashItem } from "@/lib/api";
import { daysLeft } from "./libraryModel";

export function LibraryTrash({ rows, busy, onRestore, onPurge }: { rows: readonly LibraryTrashItem[]; busy: boolean; onRestore: (ids: string[]) => void; onPurge: (ids: string[]) => void }) {
  const [confirm, setConfirm] = useState<string[] | null>(null);
  if (rows.length === 0) return <EmptyState icon="trash" text={i18n._({ id: "Trash is empty. Files you delete wait here for 30 days, then they are gone.", message: "Trash is empty. Files you delete wait here for 30 days, then they are gone." })} />;
  const count = confirm?.length ?? 0;
  return (
    <div className="flex flex-col gap-3" data-testid="library-trash">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-base text-muted-foreground">{i18n._({ id: "Trash holds these files for 30 days. Restore brings back a file and its sharing.", message: "Trash holds these files for 30 days. Restore brings back a file and its sharing." })}</p>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => setConfirm(rows.map((row) => row.id))}>{i18n._({ id: "Empty Trash", message: "Empty Trash" })}</Button>
      </div>
      {confirm ? (
        <DestructiveConfirm
          message={count === 1 && rows.length > 1 ? i18n._({ id: "Delete this file forever?", message: "Delete this file forever?" }) : i18n._({ id: "{count, plural, one {Delete # file forever?} other {Delete # files forever?}}", message: "{count, plural, one {Delete # file forever?} other {Delete # files forever?}}", values: { count } })}
          detail={i18n._({ id: "This cannot be undone. The file is gone from the Library; a copy that a chat still shows stays in that chat.", message: "This cannot be undone. The file is gone from the Library; a copy that a chat still shows stays in that chat." })}
          confirmLabel={i18n._({ id: "Delete forever", message: "Delete forever" })}
          busyLabel={i18n._({ id: "Deleting", message: "Deleting" })}
          busy={busy}
          cancelLabel={i18n._({ id: "Keep them", message: "Keep them" })}
          onConfirm={() => { onPurge(confirm); setConfirm(null); }}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
      <ul aria-label={i18n._({ id: "Files in Trash", message: "Files in Trash" })} className="m-0 flex list-none flex-col gap-2 p-0">
        {rows.map((row) => {
          const left = daysLeft(row.trash_until);
          return (
            <li key={row.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
              {row.thumb_url ? <img src={row.thumb_url} alt="" loading="lazy" className="size-14 shrink-0 rounded-md bg-muted object-cover" /> : null}
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-medium">{row.title}</p>
                <p className="text-base text-muted-foreground">{left === null ? i18n._({ id: "Held until you delete it", message: "Held until you delete it" }) : left === 0 ? "Removed today" : `${left} ${left === 1 ? "day" : "days"} left`}</p>
              </div>
              {row.can_restore ? <Button type="button" variant="secondary" disabled={busy} aria-label={`Restore ${row.title}`} onClick={() => onRestore([row.id])}>{i18n._({ id: "Restore", message: "Restore" })}</Button> : null}
              {row.can_purge ? <Button type="button" variant="ghost" disabled={busy} aria-label={`Delete ${row.title} forever`} onClick={() => setConfirm([row.id])}>{i18n._({ id: "Delete forever", message: "Delete forever" })}</Button> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

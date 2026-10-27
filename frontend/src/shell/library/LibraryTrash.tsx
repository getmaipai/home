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
  if (rows.length === 0) return <EmptyState icon="trash" text="Trash is empty. Files you delete wait here for 30 days, then they are gone." />;
  const count = confirm?.length ?? 0;
  return (
    <div className="flex flex-col gap-3" data-testid="library-trash">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-base text-muted-foreground">Trash holds these files for 30 days. Restore brings back a file and its sharing.</p>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => setConfirm(rows.map((row) => row.id))}>Empty Trash</Button>
      </div>
      {confirm ? (
        <DestructiveConfirm
          message={count === 1 && rows.length > 1 ? "Delete this file forever?" : `Delete ${count} ${count === 1 ? "file" : "files"} forever?`}
          detail="This cannot be undone. The file is gone from the Library; a copy that a chat still shows stays in that chat."
          confirmLabel="Delete forever"
          busyLabel="Deleting"
          busy={busy}
          cancelLabel="Keep them"
          onConfirm={() => { onPurge(confirm); setConfirm(null); }}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
      <ul aria-label="Files in Trash" className="m-0 flex list-none flex-col gap-2 p-0">
        {rows.map((row) => {
          const left = daysLeft(row.trash_until);
          return (
            <li key={row.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
              {row.thumb_url ? <img src={row.thumb_url} alt="" loading="lazy" className="size-14 shrink-0 rounded-md bg-muted object-cover" /> : null}
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-medium">{row.title}</p>
                <p className="text-base text-muted-foreground">{left === null ? "Held until you delete it" : left === 0 ? "Removed today" : `${left} ${left === 1 ? "day" : "days"} left`}</p>
              </div>
              {row.can_restore ? <Button type="button" variant="secondary" disabled={busy} aria-label={`Restore ${row.title}`} onClick={() => onRestore([row.id])}>Restore</Button> : null}
              {row.can_purge ? <Button type="button" variant="ghost" disabled={busy} aria-label={`Delete ${row.title} forever`} onClick={() => setConfirm([row.id])}>Delete forever</Button> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

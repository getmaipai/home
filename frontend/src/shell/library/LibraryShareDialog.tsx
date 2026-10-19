// Sharing inside the home: one ShareDialog over the existing share routes. A share adds a pointer, no bytes are copied, and
// nothing leaves the home. One file reads its current shares; several files (the batch bar) add or remove the same
// recipient on every file the person owns. The hub checks every change again (a child may not share, an adults-only
// picture may not reach a child), and its plain sentence is shown on the row.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShareDialog, FILE_SHARE_ROLES, type ShareConfirmStep } from "@maipai/ui/src/elements/share-dialog";
import { api, type LibraryItem, type Roster } from "@/lib/api";
import { useLibraryActions } from "./useLibraryActions";

export function LibraryShareDialog({ items, me, open, onOpenChange }: { items: readonly LibraryItem[]; me: Roster; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const { reason, refresh } = useLibraryActions(me.id);
  const owned = items.filter((item) => item.owner.id === me.id);
  const single = owned.length === 1 && items.length === 1 ? owned[0]! : null;
  const people = useQuery({ queryKey: ["people"], queryFn: () => api.people(), enabled: open });
  const shares = useQuery({ queryKey: ["file-shares", single?.id], queryFn: () => api.fileShares(single!.id), enabled: open && single !== null });
  // Batch: the shares this dialog made, so a second press on the same row can undo them.
  const [made, setMade] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [asking, setAsking] = useState(false);

  const roleOf = (target: string) => single ? ((shares.data ?? []).some((share) => share.to === target) ? "view" : "off") : ((made[target]?.length ?? 0) > 0 ? "view" : "off");

  async function change(target: string, role: string) {
    setBusy(target);
    setErrors((current) => { const rest = { ...current }; delete rest[target]; return rest; });
    try {
      if (role === "view") {
        const ids: string[] = [];
        for (const item of owned) ids.push((await api.shareFile(item.id, target)).id);
        setMade((current) => ({ ...current, [target]: ids }));
      } else if (single) {
        for (const share of (shares.data ?? []).filter((entry) => entry.to === target)) await api.unshare(share.id);
      } else {
        for (const id of made[target] ?? []) await api.unshare(id);
        setMade((current) => ({ ...current, [target]: [] }));
      }
      await queryClient.invalidateQueries({ queryKey: ["file-shares"] });
      await refresh();
    } catch (error) {
      setErrors((current) => ({ ...current, [target]: reason(error) }));
    } finally { setBusy(null); }
  }

  const confirm: ShareConfirmStep | null = asking ? {
    title: "Share with everyone in the home?",
    body: "Everyone in the home, including the children, will be able to see this. You can stop sharing at any time. A picture marked for adults only is never shown to a child.",
    confirmLabel: "Share with everyone",
    cancelLabel: "Go back",
    busy: busy === "household",
    onConfirm: async () => { await change("household", "view"); setAsking(false); },
    onCancel: () => setAsking(false),
  } : null;

  const title = single ? `Share ${single.name}` : `Share ${owned.length} files`;
  return (
    <>
    <ShareDialog
      open={open}
      onOpenChange={(next) => { onOpenChange(next); if (!next) { setAsking(false); setMade({}); setErrors({}); } }}
      labels={{ title }}
      roles={FILE_SHARE_ROLES}
      household={{ role: roleOf("household"), busy: busy === "household", ...(errors.household ? { error: errors.household } : {}) }}
      members={(people.data ?? []).filter((person) => person.id !== me.id).map((person) => ({
        id: person.id, name: person.display_name, avatarSeed: person.avatar_seed, role: roleOf(person.id), busy: busy === person.id,
        ...(errors[person.id] ? { error: errors[person.id] } : {}),
      }))}
      onRoleChange={(id, role) => { if (id === "household" && role === "view") setAsking(true); else void change(id, role); }}
      confirm={confirm}
      {...(people.isError ? { error: "Home could not load the people in your home. Close this and try again." } : {})}
    />
    </>
  );
}

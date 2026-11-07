import { i18n } from "@lingui/core";
import { useState, type FormEvent } from "react";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { Label } from "@maipai/ui/src/ui/label";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@maipai/ui/src/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@maipai/ui/src/ui/dialog";
import { getIcon } from "@maipai/ui/src/icons";
import { LIST_ICONS, type ListIcon } from "./reminderTypes";

export function ListMenu({ title, onRename, onChangeIcon, onDelete }: {
  title: string;
  onRename: (title: string) => Promise<unknown>;
  onChangeIcon: (icon: ListIcon) => Promise<unknown>;
  onDelete: () => void;
}) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [iconOpen, setIconOpen] = useState(false);
  const [name, setName] = useState(title);

  function openRename() {
    setName(title);
    setRenameOpen(true);
  }

  async function saveRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return;
    if (await onRename(name.trim())) setRenameOpen(false);
  }

  return <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="ghost" aria-label={i18n._({ id: "List options", message: "List options" })}>•••</Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={openRename}>{i18n._({ id: "Rename", message: "Rename" })}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setIconOpen(true)}>{i18n._({ id: "Change icon", message: "Change icon" })}</DropdownMenuItem>
        <DropdownMenuItem onSelect={onDelete}>{i18n._({ id: "Delete", message: "Delete" })}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
      <DialogContent>
        <DialogHeader><DialogTitle>{i18n._({ id: "Rename list", message: "Rename list" })}</DialogTitle><DialogDescription>{i18n._({ id: "Choose a name for this list.", message: "Choose a name for this list." })}</DialogDescription></DialogHeader>
        <form className="grid gap-4" onSubmit={(event) => void saveRename(event)}>
          <div className="grid gap-2"><Label htmlFor="rename-list">{i18n._({ id: "Name", message: "Name" })}</Label><Input id="rename-list" value={name} onChange={(event) => setName(event.target.value)} /></div>
          <DialogFooter><Button type="submit" disabled={!name.trim()}>{i18n._({ id: "Save", message: "Save" })}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    <Dialog open={iconOpen} onOpenChange={setIconOpen}>
      <DialogContent>
        <DialogHeader><DialogTitle>{i18n._({ id: "Change icon", message: "Change icon" })}</DialogTitle><DialogDescription>{i18n._({ id: "Choose an icon for {title}.", message: "Choose an icon for {title}.", values: { title } })}</DialogDescription></DialogHeader>
        <div className="grid grid-cols-4 gap-2">
          {LIST_ICONS.map((icon) => {
            const Icon = getIcon(icon === "cart" ? "box" : icon === "sparkle" ? "sparkles" : icon);
            return <Button key={icon} variant="outline" aria-label={icon} onClick={() => { void onChangeIcon(icon).then((saved) => { if (saved) setIconOpen(false); }); }}><Icon aria-hidden /></Button>;
          })}
        </div>
      </DialogContent>
    </Dialog>
  </>;
}

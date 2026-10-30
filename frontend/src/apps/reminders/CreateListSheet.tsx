import { useState, type FormEvent } from "react";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { Label } from "@maipai/ui/src/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@maipai/ui/src/ui/sheet";
import { Toggle } from "@maipai/ui/src/ui/toggle";
import { getIcon } from "@maipai/ui/src/icons";
import { LIST_ICONS, type ListIcon } from "./reminderTypes";

export function CreateListSheet({ open, onOpenChange, onCreate, isPhone }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (title: string, icon: ListIcon) => Promise<void>;
  isPhone: boolean;
}) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<ListIcon>("sparkle");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return;
    await onCreate(name.trim(), icon);
    setName("");
    setIcon("sparkle");
  }

  return <><Sheet open={open} onOpenChange={onOpenChange}>
    <SheetContent side={isPhone ? "bottom" : "right"}>
      <SheetHeader><SheetTitle>Create a list</SheetTitle><SheetDescription>Give your list a name and an icon.</SheetDescription></SheetHeader>
      <form className="grid gap-4 p-4" onSubmit={(event) => void submit(event)}>
        <div className="grid gap-2"><Label htmlFor="new-list-name">Name</Label><Input id="new-list-name" value={name} onChange={(event) => setName(event.target.value)} /></div>
        <fieldset className="grid grid-cols-4 gap-2">
          <legend className="mb-2">Icon</legend>
          {LIST_ICONS.map((name) => {
            const Icon = getIcon(name === "cart" ? "box" : name === "sparkle" ? "sparkles" : name);
            return <Toggle key={name} pressed={icon === name} aria-label={name} onPressedChange={(pressed) => { if (pressed) setIcon(name); }}><Icon aria-hidden /></Toggle>;
          })}
        </fieldset>
        <Button type="submit" disabled={!name.trim()}>Create list</Button>
      </form>
    </SheetContent>
  </Sheet></>;
}

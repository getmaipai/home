import { useState, type FormEvent } from "react";
import type { List as ListRecord } from "@maipai/spec/gen/ts/list.js";
import { Button } from "@maipai/ui/src/ui/button";
import { Checkbox } from "@maipai/ui/src/ui/checkbox";
import { Input } from "@maipai/ui/src/ui/input";
import { getIcon } from "@maipai/ui/src/icons";
import { dueLabel, labelFor } from "./reminderTypes";
import { ListMenu } from "./ListMenu";
import type { ListIcon } from "./reminderTypes";

export function ListMain({ list, isPhone, canManage, onBack, onAdd, onToggle, onClearDone, onRename, onChangeIcon, onDelete }: {
  list: ListRecord;
  isPhone: boolean;
  canManage: boolean;
  onBack: () => void;
  onAdd: (text: string) => Promise<void>;
  onToggle: (itemId: string, done: boolean) => Promise<void>;
  onClearDone: () => Promise<void>;
  onRename: (title: string) => Promise<void>;
  onChangeIcon: (icon: ListIcon) => Promise<void>;
  onDelete: () => void;
}) {
  const [text, setText] = useState("");
  const [showDone, setShowDone] = useState(false);
  const openItems = list.items.filter((item) => !item.done);
  const doneItems = list.items.filter((item) => item.done);
  const EmptyIcon = getIcon("sparkles");
  const tagline = list.kind === "shopping" ? "A few things to pick up" : list.kind === "todo" ? "What needs doing" : "Your own list";
  const date = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date());

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    setText("");
    try {
      await onAdd(value);
    } catch (error) {
      setText(value);
      throw error;
    }
  }

  return <main className="flex min-h-0 min-w-0 flex-1 flex-col">
    <header className="grid grid-cols-[1fr_auto] items-end gap-3 border-b px-4 py-4">
      <div>
        <p className="m-0 text-base font-medium tracking-wider text-muted-foreground">YOUR LIST</p>
        <h1 className="m-0 text-3xl font-semibold">{labelFor(list)}</h1>
        <p className="m-0 text-muted-foreground">{tagline}</p>
      </div>
      <p className="m-0 text-sm text-muted-foreground">{date}</p>
      {isPhone ? <Button variant="ghost" onClick={onBack}>Lists</Button> : null}
      {canManage ? <ListMenu title={list.title} onRename={onRename} onChangeIcon={onChangeIcon} onDelete={onDelete} /> : null}
    </header>
    <section className="min-h-0 flex-1 overflow-y-auto px-4" aria-label={labelFor(list)}>
      {openItems.length === 0 && doneItems.length === 0 ? <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <span className="rounded-2xl bg-primary/10 p-5"><EmptyIcon aria-hidden className="size-9 text-primary" /></span>
        <h2 className="m-0 text-xl font-semibold">Nothing on the list yet</h2>
        <p className="m-0 text-muted-foreground">Add the first thing and we'll keep it here for you.</p>
      </div> : <ul className="m-0 list-none p-0">
        {openItems.map((item) => <li key={item.id} className="flex min-h-12 items-center gap-3 border-b py-2">
          <Checkbox checked={false} onCheckedChange={(checked) => void onToggle(item.id, checked === true)} aria-label={item.text} />
          <span className="flex-1">{item.text}</span>
          {item.due_at ? <span data-due-chip="true" className="rounded-full bg-muted px-3 py-1 text-sm text-muted-foreground">{dueLabel(item.due_at)}</span> : null}
        </li>)}
      </ul>}
      {doneItems.length ? <>
        <Button variant="ghost" onClick={() => setShowDone((value) => !value)} aria-expanded={showDone}>{showDone ? "Hide done" : `Done (${doneItems.length})`}</Button>
        {showDone ? <ul className="m-0 list-none p-0">{doneItems.map((item) => <li key={item.id} data-done="true" className="flex min-h-12 items-center gap-3 border-b py-2 text-muted-foreground">
          <Checkbox checked onCheckedChange={(checked) => void onToggle(item.id, checked === true)} aria-label={item.text} />
          <span className="line-through">{item.text}</span>
        </li>)}</ul> : null}
        <Button variant="ghost" onClick={() => void onClearDone()}>Clear done</Button>
      </> : null}
    </section>
    <form className="mt-auto flex items-center gap-2 border-t p-4" onSubmit={(event) => void submit(event)}>
      <Input aria-label="Add an item" placeholder="Add an item" value={text} onChange={(event) => setText(event.target.value)} />
      <Button type="submit" disabled={!text.trim()}>Add</Button>
    </form>
  </main>;
}

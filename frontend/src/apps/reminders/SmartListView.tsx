import type { ComingUpItem } from "@/lib/api";
import type { List as ListRecord } from "@maipai/spec/gen/ts/list.js";
import { ComingUpRow } from "./ComingUpRow";
import type { ReminderView } from "./reminderTypes";
import { dueLabel } from "./reminderTypes";

export type SmartItem = { id: string; label: string; text: string; at: string; list?: ListRecord };

export function SmartListView({ view, items, onChanged }: {
  view: Extract<ReminderView, { kind: "today" | "scheduled" }>;
  items: SmartItem[];
  onChanged: () => void;
}) {
  const title = view.kind === "today" ? "Today" : "Scheduled";
  return <main className="flex min-h-0 min-w-0 flex-1 flex-col">
    <header className="border-b px-4 py-4">
      <p className="m-0 text-base tracking-wider text-muted-foreground">SMART LIST</p>
      <h1 className="m-0 text-3xl font-semibold">{title}</h1>
    </header>
    <ul className="m-0 list-none overflow-y-auto p-4">
      {items.map((item) => item.label === "Reminder" && view.kind === "scheduled"
        ? <ComingUpRow key={item.id} item={{ id: item.id, kind: "reminder", text: item.text, at: item.at } as ComingUpItem} onChanged={onChanged} />
        : <li key={item.id} className="flex items-center justify-between gap-3 border-b py-3">
          <div><p className="m-0">{item.text}</p><p className="m-0 text-sm text-muted-foreground">{item.label}</p></div>
          <span className="text-sm text-muted-foreground">{dueLabel(item.at)}</span>
        </li>)}
    </ul>
  </main>;
}

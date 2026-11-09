import { i18n } from "@lingui/core";
import type { ComingUpItem } from "@/lib/api";
import type { List as ListRecord } from "@maipai/spec/gen/ts/list.js";
import { ComingUpRow } from "./ComingUpRow";
import { dueLabel } from "./reminderTypes";

export type SmartItem = { id: string; label: string; text: string; at: string; list?: ListRecord };

export function SmartListView({ view, items, onChanged }: {
  view: { kind: "today" | "scheduled" };
  items: SmartItem[];
  onChanged: () => void;
}) {
  const title = view.kind === "today" ? i18n._({ id: "Today", message: "Today" }) : i18n._({ id: "Scheduled", message: "Scheduled" });
  return <section className="flex min-h-0 min-w-0 flex-1 flex-col">
    <header className="border-b px-4 py-4">
      <p className="m-0 text-base tracking-wider text-muted-foreground">{i18n._({ id: "SMART LIST", message: "SMART LIST" })}</p>
      <h1 className="m-0 text-title font-semibold">{title}</h1>
    </header>
    <ul className="m-0 list-none overflow-y-auto p-4">
      {items.map((item) => item.label === "Reminder" && view.kind === "scheduled"
        ? <ComingUpRow key={item.id} item={{ id: item.id, kind: "reminder", text: item.text, at: item.at } as ComingUpItem} onChanged={onChanged} />
        : <li key={item.id} className="flex items-center justify-between gap-3 py-3">
          <div><p className="m-0 text-row">{item.text}</p><p className="m-0 text-supporting text-muted-foreground">{item.label}</p></div>
          <span className="text-supporting text-muted-foreground">{dueLabel(item.at)}</span>
        </li>)}
    </ul>
  </section>;
}

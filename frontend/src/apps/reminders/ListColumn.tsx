import { Button } from "@maipai/ui/src/ui/button";
import { getIcon } from "@maipai/ui/src/icons";
import type { List as ListRecord } from "@maipai/spec/gen/ts/list.js";
import type { ReminderView } from "./reminderTypes";
import { iconFor, itemCount, labelFor } from "./reminderTypes";

type Props = {
  lists: ListRecord[];
  view: ReminderView;
  todayCount: number;
  scheduledCount: number;
  onCreate: () => void;
  onSelect: (view: ReminderView) => void;
};

export function ListColumn({ lists, view, todayCount, scheduledCount, onCreate, onSelect }: Props) {
  return <aside className="flex w-full shrink-0 flex-col border-r p-3 sm:w-72" aria-label="Reminder lists">
    <div className="flex items-center justify-between px-3 py-2">
      <h2 className="text-lg font-semibold">Lists</h2>
      <Button type="button" variant="ghost" size="icon" aria-label="Create list" onClick={onCreate}>+</Button>
    </div>
    <div className="grid gap-1">
      <Button variant={view.kind === "today" ? "secondary" : "ghost"} onClick={() => onSelect({ kind: "today" })}>
        <span>Today</span>{todayCount > 0 ? <span>{todayCount}</span> : null}
      </Button>
      <Button variant={view.kind === "scheduled" ? "secondary" : "ghost"} onClick={() => onSelect({ kind: "scheduled" })}>
        <span>Scheduled</span>{scheduledCount > 0 ? <span>{scheduledCount}</span> : null}
      </Button>
      <hr className="my-2" />
      {lists.map((list, index) => {
        const name = iconFor(list);
        const Icon = getIcon(name === "cart" ? "box" : name === "sparkle" ? "sparkles" : name);
        const active = view.kind === "list" && view.id === list.id;
        const token = (index % 5) + 1;
        return <Button key={list.id} variant={active ? "secondary" : "ghost"} onClick={() => onSelect({ kind: "list", id: list.id })}>
          <span className={`flex size-9 items-center justify-center rounded-md bg-chart-${token}/15 text-chart-${token}`}>
            <Icon aria-hidden className="size-5" />
          </span>
          <span className="flex-1 text-left">{labelFor(list)}</span>
          {itemCount(list) > 0 ? <span className="text-muted-foreground">{itemCount(list)}</span> : null}
        </Button>;
      })}
    </div>
    <p className="mt-auto border-t px-2 pt-4 text-sm text-muted-foreground">Keep the little things somewhere safe, so you can stay with the moment.</p>
  </aside>;
}

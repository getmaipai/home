import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Page } from "@maipai/ui/src/primitives/Page";
import { Badge } from "@maipai/ui/src/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { Checkbox } from "@maipai/ui/src/ui/checkbox";
import { Input } from "@maipai/ui/src/ui/input";
import { api } from "@/lib/api";
import { getIcon } from "@maipai/ui/src/icons";
import { useBreakpoint } from "@maipai/ui/src/hooks/useBreakpoint";
import { RemindersTabs } from "@/apps/reminders/RemindersTabs";

export const RemindersIcon = getIcon("layout-list");
const LISTS_QUERY_KEY = ["household-lists"];

export function RemindersPage() {
  const queryClient = useQueryClient();
  const isPhone = useBreakpoint().tier === "phone";
  const listsQuery = useQuery({ queryKey: LISTS_QUERY_KEY, queryFn: api.lists });
  const lists = useMemo(() => (listsQuery.data ?? []).filter((list) => list.scope === "household" && (list.kind === "shopping" || list.kind === "todo")), [listsQuery.data]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [showDone, setShowDone] = useState(false);
  const selected = lists.find((list) => list.id === selectedId) ?? (isPhone ? undefined : lists.find((list) => list.kind === "shopping") ?? lists[0]);
  const openItems = selected?.items.filter((item) => !item.done) ?? [];
  const doneItems = selected?.items.filter((item) => item.done) ?? [];
  useEffect(() => {
    if (selectedId && !lists.some((list) => list.id === selectedId)) setSelectedId(null);
  }, [lists, selectedId]);

  async function addItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = text.trim();
    if (!selected || !value) return;
    setText("");
    try {
      await api.addListItem(selected.id, value);
    } catch (error) {
      setText(value);
      throw error;
    }
    await queryClient.invalidateQueries({ queryKey: LISTS_QUERY_KEY });
  }

  async function toggleItem(itemId: string, done: boolean) {
    if (!selected) return;
    await api.editListItem(selected.id, itemId, done);
    await queryClient.invalidateQueries({ queryKey: LISTS_QUERY_KEY });
  }

  async function clearDone() {
    if (!selected) return;
    await api.clearDoneListItems(selected.id);
    setShowDone(false);
    await queryClient.invalidateQueries({ queryKey: LISTS_QUERY_KEY });
  }

  return (
    <Page title="Reminders" hideTitle>
      <div className="flex min-h-0 flex-1 flex-col">
        <RemindersTabs value="lists" />
        <div className="flex min-h-0 flex-1">
        {!isPhone ? <aside className="hidden w-64 flex-col gap-2 p-3 md:flex" aria-label="Reminder lists">
          <h2 className="px-3 py-2 text-lg font-semibold">Lists</h2>
          {lists.map((list) => <Button key={list.id} variant={selected?.id === list.id ? "secondary" : "ghost"} onClick={() => { setSelectedId(list.id); setShowDone(false); }}>
            {list.kind === "shopping" ? "Shopping" : "To-do"}
            <Badge variant="secondary">{list.items.filter((item) => !item.done).length}</Badge>
          </Button>)}
        </aside> : null}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {selected ? (
            <>
              <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  {isPhone ? <Button variant="ghost" onClick={() => setSelectedId(null)}>Lists</Button> : null}
                  <h2 className="truncate text-xl font-semibold">{selected.kind === "shopping" ? "Shopping" : "To-do"}</h2>
                  <Badge variant="secondary">{openItems.length}</Badge>
                </div>
                {selected.kind === "shopping" && doneItems.length > 0 ? <Button variant="ghost" onClick={clearDone}>Clear done</Button> : null}
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto px-4">
                <ul className="m-0 list-none p-0">
                  {openItems.map((item) => (
                    <li key={item.id} className="flex min-h-12 items-center gap-3 border-b py-2">
                      <Checkbox checked={false} onCheckedChange={(checked) => void toggleItem(item.id, checked === true)} aria-label={item.text} />
                      <span>{item.text}</span>
                    </li>
                  ))}
                </ul>
                {doneItems.length > 0 ? (
                  <>
                    <Button variant="ghost" onClick={() => setShowDone((value) => !value)} aria-expanded={showDone}>
                      {showDone ? "Hide done" : `Done (${doneItems.length})`}
                    </Button>
                    {showDone ? <ul className="m-0 list-none p-0">{doneItems.map((item) => (
                      <li key={item.id} data-done="true" className="flex min-h-12 items-center gap-3 border-b py-2 text-muted-foreground">
                        <Checkbox checked onCheckedChange={(checked) => void toggleItem(item.id, checked === true)} aria-label={item.text} />
                        <span className="line-through">{item.text}</span>
                      </li>
                    ))}</ul> : null}
                  </>
                ) : null}
              </div>
              <form className="flex items-center gap-2 border-t p-4" onSubmit={(event) => void addItem(event)}>
                <Input aria-label="Add an item" placeholder="Add an item" value={text} onChange={(event) => setText(event.target.value)} />
                <Button type="submit" disabled={!text.trim()}>Add</Button>
              </form>
            </>
          ) : (
            <section className="flex flex-1 flex-col gap-2 p-4 lg:hidden" aria-label="Reminder lists">
              <h2 className="text-xl font-semibold">Lists</h2>
              {lists.map((list) => <Button key={list.id} variant="outline" onClick={() => setSelectedId(list.id)}>
                <span>{list.kind === "shopping" ? "Shopping" : "To-do"}</span>
                <Badge variant="secondary">{list.items.filter((item) => !item.done).length}</Badge>
              </Button>)}
            </section>
          )}
          {listsQuery.isError ? <p role="alert" className="p-4 text-destructive">Could not load household lists.</p> : null}
        </main>
        </div>
      </div>
    </Page>
  );
}

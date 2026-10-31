import { useEffect, useMemo, useState, useContext } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { List as ListRecord } from "@maipai/spec/gen/ts/list.js";
import { Page } from "@maipai/ui/src/primitives/Page";
import { Button } from "@maipai/ui/src/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@maipai/ui/src/ui/alert-dialog";
import { useBreakpoint } from "@maipai/ui/src/hooks/useBreakpoint";
import { WakeWordPersonContext } from "@/apps/chat/chatThreadContexts";
import { useHeaderExtra } from "@maipai/ui/src/dashboard/layouts/full/vertical/header/HeaderExtraContext";
import { PageHeaderTitle } from "@/shell/pageHeaderTitle";
import { api } from "@/lib/api";
import { CreateListSheet } from "./CreateListSheet";
import { RemindersIcon } from "./remindersIcon";
import { ListColumn } from "./ListColumn";
import { ListMain } from "./ListMain";
import { SmartListView, type SmartItem } from "./SmartListView";
import { labelFor, type ListIcon, type ReminderView } from "./reminderTypes";

const LISTS_QUERY_KEY = ["household-lists"];
const COMING_QUERY_KEY = ["household-coming-up"];

export { RemindersIcon };

function RemindersHeaderAction() {
  return <><Button type="button" variant="ghost" size="icon-lg" aria-label="Create list" onClick={() => window.dispatchEvent(new Event("maipai:reminders-add-list"))}>+</Button></>;
}

function orderLists(input: ListRecord[]): ListRecord[] {
  return input
    .filter((list) => list.kind === "custom" || list.kind === "shopping" || list.kind === "todo")
    .sort((a, b) => {
      if (a.kind === b.kind) return labelFor(a).localeCompare(labelFor(b));
      if (a.kind === "shopping") return -1;
      if (b.kind === "shopping") return 1;
      if (a.kind === "todo") return -1;
      return 1;
    });
}

function sameDay(value: string, today: string): boolean {
  return new Date(value).toDateString() === today;
}

export function RemindersPage() {
  useHeaderExtra(PageHeaderTitle, RemindersHeaderAction);
  const queryClient = useQueryClient();
  const person = useContext(WakeWordPersonContext);
  const isPhone = useBreakpoint().width < 640;
  const listsQuery = useQuery({ queryKey: LISTS_QUERY_KEY, queryFn: api.lists });
  const comingQuery = useQuery({ queryKey: COMING_QUERY_KEY, queryFn: api.comingUp });
  const lists = useMemo(() => orderLists(listsQuery.data ?? []), [listsQuery.data]);
  const [view, setView] = useState<ReminderView>({ kind: "list", id: "" });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [phoneShowingList, setPhoneShowingList] = useState(false);
  const selected = view.kind === "list"
    ? lists.find((list) => list.id === view.id) ?? (view.id ? undefined : lists.find((list) => list.kind === "shopping") ?? lists[0])
    : undefined;

  const jobs = useMemo(() => (comingQuery.data ?? [])
    .filter((item) => item.kind === "reminder")
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at)), [comingQuery.data]);
  const today = new Date().toDateString();
  const todayJobs = jobs.filter((item) => sameDay(item.at, today));
  const dueItems = lists.flatMap((list) => list.items
    .filter((item) => !item.done && item.due_at)
    .map((item) => ({ list, item })));
  const todayItems = dueItems.filter(({ item }) => sameDay(item.due_at!, today));
  const smartItems = useMemo<SmartItem[]>(() => {
    const jobsToShow = view.kind === "today" ? todayJobs : jobs;
    const itemsToShow = view.kind === "today" ? todayItems : dueItems;
    return [
      ...jobsToShow.map((item) => ({ id: item.id, label: "Reminder", text: item.text, at: item.at })),
      ...itemsToShow.map(({ list, item }) => ({ id: item.id, label: labelFor(list), text: item.text, at: item.due_at!, list })),
    ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }, [dueItems, jobs, todayItems, todayJobs, view.kind]);

  useEffect(() => {
    if (!listsQuery.isFetching && view.kind === "list" && !view.id && lists[0]) {
      setView({ kind: "list", id: lists[0].id });
    }
  }, [lists, listsQuery.isFetching, view]);

  useEffect(() => {
    const open = () => setSheetOpen(true);
    window.addEventListener("maipai:reminders-add-list", open);
    return () => window.removeEventListener("maipai:reminders-add-list", open);
  }, []);

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: LISTS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: COMING_QUERY_KEY }),
    ]);
  }

  async function addItem(text: string) {
    if (!selected) return;
    await api.addListItem(selected.id, text, selected.kind !== "shopping");
    await refresh();
  }

  async function toggleItem(itemId: string, done: boolean) {
    if (!selected) return;
    await api.editListItem(selected.id, itemId, done);
    await refresh();
  }

  async function clearDone() {
    if (!selected) return;
    await api.clearDoneListItems(selected.id);
    await refresh();
  }

  async function createList(title: string, icon: ListIcon) {
    const created = await api.createList({ kind: "custom", scope: "person", title, icon });
    setSheetOpen(false);
    setView({ kind: "list", id: created.id });
    setPhoneShowingList(true);
    await refresh();
  }

  async function renameList(title: string) {
    if (!selected) return;
    await api.updateList(selected.id, { title });
    await refresh();
  }

  async function changeIcon(icon: ListIcon) {
    if (!selected) return;
    await api.updateList(selected.id, { icon });
    await refresh();
  }

  async function deleteSelected() {
    if (!selected) return;
    await api.deleteList(selected.id);
    setConfirmDelete(false);
    setView({ kind: "list", id: "" });
    await refresh();
  }

  const canManage = selected?.kind === "custom" && person?.role !== "child";
  const showColumn = !isPhone || !phoneShowingList;
  const todayCount = todayJobs.length + todayItems.length;
  const scheduledCount = jobs.length + dueItems.length;

  return <Page title="Reminders" hideTitle>
    <div className="flex min-h-0 flex-1">
      {showColumn ? <ListColumn
        lists={lists}
        view={view}
        todayCount={todayCount}
        scheduledCount={scheduledCount}
        onCreate={() => setSheetOpen(true)}
        onSelect={(next) => {
          setView(next);
          setPhoneShowingList(true);
        }}
      /> : null}
      {(!isPhone || phoneShowingList) && selected && view.kind === "list" ? <ListMain
        list={selected}
        isPhone={isPhone}
        canManage={canManage}
        onBack={() => setPhoneShowingList(false)}
        onAdd={addItem}
        onToggle={toggleItem}
        onClearDone={clearDone}
        onRename={renameList}
        onChangeIcon={changeIcon}
        onDelete={() => setConfirmDelete(true)}
      /> : null}
      {(!isPhone || phoneShowingList) && view.kind !== "list" ? <SmartListView
        view={view}
        items={smartItems}
        onChanged={() => void comingQuery.refetch()}
      /> : null}
    </div>
    <CreateListSheet open={sheetOpen} onOpenChange={setSheetOpen} onCreate={createList} isPhone={isPhone} />
    <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {selected ? labelFor(selected) : "list"}?</AlertDialogTitle>
          <AlertDialogDescription>Its {selected?.items.length ?? 0} items go too.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => void deleteSelected()}>Delete list</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    {listsQuery.isError || comingQuery.isError ? <p role="alert" className="p-4 text-destructive">Could not load reminders.</p> : null}
  </Page>;
}

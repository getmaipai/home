import type { PersonRow } from "@/types";
import type { List as ListT } from "@maipai/spec/gen/ts/list.js";
import type { RemovedItem } from "@/lib/lists";
import { addItem, clearDoneItems, copyList, createList, deleteList, editItem, moveItems, removeItem, reorderItems, updateList } from "@/lib/lists";
import { isListPronoun, resolveItems, resolveList, visibleListById } from "@/lib/listResolver";
import type { UndoInverse } from "@/lib/toolUndo";

export const LIST_ACTIONS = ["create_list", "rename_list", "delete_list", "add_items", "remove_items", "check_items", "uncheck_items", "edit_item", "move_items", "copy_list", "reorder", "clear_done", "show_list", "find_list"] as const;
export type ListAction = (typeof LIST_ACTIONS)[number];
export interface ListActionInput { action: ListAction; list?: string; to_list?: string; items?: string[]; name?: string; exclude?: string[]; order?: string[]; lastListId?: string; lastItemIds?: string[] }
export type ListActionResult = { ok: true; reply: string; listId?: string; itemIds?: string[]; undo?: { inverse: UndoInverse[] } } | { ok: false; reply: string };
/** The one line a minor gets for a household-list action that is a parent's. */
export const PARENT_CAN_DO_THAT = "A parent can do that.";
const fail = (reply: string): ListActionResult => ({ ok: false, reply });
const success = (reply: string, listId?: string, itemIds?: string[], inverse?: UndoInverse[]): ListActionResult => ({ ok: true, reply, ...(listId ? { listId } : {}), ...(itemIds ? { itemIds } : {}), ...(inverse?.length ? { undo: { inverse } } : {}) });
function resolve(actor: PersonRow, words?: string, lastListId?: string) {
  if (!words) return fail("Which list do you mean?");
  const result = resolveList(actor, words, { lastListId });
  return result.ok ? result.list : result.reason === "ambiguous" ? fail(`I found ${result.candidates} lists called that; which one?`) : fail("I couldn't find that list.");
}
/** The items a removal takes, with the place each held, so an Undo puts them back where they were. */
function removedEntries(items: ListT["items"], taken: (item: ListT["items"][number]) => boolean): RemovedItem[] {
  return items.flatMap((item, index) => (taken(item) ? [{ index, item }] : []));
}
function operationError(error: string): string { return error === "no such list" ? "I couldn't find that list." : "I couldn't update that list."; }
export function runListAction(actor: PersonRow, band: "child" | "teen" | "adult", input: ListActionInput): ListActionResult {
  const action = input.action;
  if (action === "create_list") {
    if (!input.name) return fail("What should I call the list?");
    const out = createList(actor, { kind: "custom", title: input.name, scope: "person" });
    return out.ok
      ? success("I created the list.", out.value.id, undefined, [{ kind: "remove_list", listId: out.value.id }])
      : fail("I couldn't create that list.");
  }
  const list = resolve(actor, input.list, input.lastListId);
  if (!("id" in list)) return list as ListActionResult;
  let target = list as ListT;
  const minor = band === "child" || band === "teen";
  const shopping = target.scope === "household" && target.kind === "shopping";
  const minorAllowed = new Set<ListAction>(["add_items", "check_items", "uncheck_items", "show_list", "find_list"]);
  if (minor && target.scope === "household" && !(shopping && minorAllowed.has(action))) return fail(PARENT_CAN_DO_THAT);
  if (action === "show_list" || action === "find_list") return success(action === "show_list" ? "Here is the list." : "I found the list.", target.id, target.items.map((item) => item.id));
  if (action === "rename_list") {
    if (!input.name) return fail("What should I call the list?");
    const oldTitle = target.title;
    const out = updateList(actor, target.id, { title: input.name });
    return out.ok
      ? success("I renamed the list.", target.id, undefined, [{ kind: "rename_list", listId: target.id, title: oldTitle }])
      : fail(operationError(out.error));
  }
  if (["check_items", "uncheck_items", "edit_item", "remove_items", "move_items", "reorder", "clear_done"].includes(action)) {
    // A fresh read of the same list by id; the id is never run through the word matcher, which could pick another list.
    const refreshed = visibleListById(actor, target.id);
    if (refreshed) target = refreshed;
  }
  if (action === "delete_list") {
    const out = deleteList(actor, target.id); return out.ok ? success("I deleted the list.", target.id, undefined, [{ kind: "restore_list", listId: target.id }]) : fail(operationError(out.error));
  }
  if (action === "copy_list") {
    if (!input.name) return fail("What should I call the copy?");
    const exclude = new Set(input.exclude ?? []);
    const excludeIds = target.items.filter((item) => exclude.has(item.text)).map((item) => item.id);
    const out = copyList(actor, target.id, { name: input.name, excludeItemIds: excludeIds }); return out.ok
      ? success("I copied the list.", out.value.id, out.value.items.map((item) => item.id), [{ kind: "remove_list", listId: out.value.id }])
      : fail("I couldn't copy that list.");
  }
  if (action === "reorder") {
    const ids = (input.order ?? []).map((word) => resolveItems(target, word, { lastItemIds: input.lastItemIds })).filter((r) => r.ok).flatMap((r) => r.ok ? r.items.map((item) => item.id) : []);
    const before = target.items.map((item) => item.id);
    const out = reorderItems(actor, target.id, ids);
    if (!out.ok) return fail("I couldn't reorder the list.");
    const changed = out.value.items.some((item, index) => item.id !== before[index]);
    const inverse: UndoInverse[] = changed ? [{ kind: "reorder_back", listId: target.id, order: before }] : [];
    return success("I reordered the list.", target.id, undefined, inverse);
  }
  if (action === "clear_done") {
    const removed = removedEntries(target.items, (item) => item.done);
    const out = clearDoneItems(actor, target.id);
    if (!out.ok) return fail("I couldn't clear the completed items.");
    const inverse: UndoInverse[] = removed.length > 0 ? [{ kind: "restore_items", listId: target.id, removed }] : [];
    return success("I cleared the completed items.", target.id, undefined, inverse);
  }
  const phrases = input.items ?? [];
  const selected = [] as ListT["items"];
  for (const words of action === "add_items" ? [] : phrases) {
    if (isListPronoun(words) && input.lastItemIds?.length) {
      const recent = target.items.filter((item) => input.lastItemIds!.includes(item.id));
      if (recent.length) { selected.push(...recent); continue; }
    }
    const result = resolveItems(target, words, { lastItemIds: input.lastItemIds });
    if (!result.ok) return result.reason === "ambiguous" ? fail(`I found ${result.candidates} matching items; which one?`) : fail("I couldn't find that item.");
    selected.push(...result.items);
  }
  if (action === "add_items") {
    if (!phrases.length) return fail("What should I add?");
    const inverses: UndoInverse[] = [];
    for (const text of phrases) { const out = addItem(actor, target.id, { text }); if (!out.ok) return fail("I couldn't add those items."); inverses.push({ kind: "remove_item", listId: target.id, itemId: out.value.items.at(-1)!.id }); }
    return success("I added the items.", target.id, inverses.map((inverse) => inverse.kind === "remove_item" ? inverse.itemId : ""), inverses);
  }
  const itemIds = selected.map((item) => item.id);
  if (action === "move_items") {
    const other = resolve(actor, input.to_list, input.lastListId);
    if (!("id" in other)) return other as ListActionResult;
    const destination = other as ListT;
    // A minor never puts items onto a household list, whatever the source: that is a parent's.
    if (minor && destination.scope === "household") return fail(PARENT_CAN_DO_THAT);
    const out = moveItems(actor, target.id, destination.id, itemIds);
    return out.ok
      ? success("I moved the items.", destination.id, itemIds, [
        { kind: "move_items_back", fromListId: destination.id, toListId: target.id, itemIds },
      ])
      : fail("I couldn't move those items.");
  }
  if (action === "remove_items") {
    const wanted = new Set(itemIds);
    const removed = removedEntries(target.items, (item) => wanted.has(item.id));
    const gone = removed.filter((entry) => removeItem(actor, target.id, entry.item.id).ok);
    const inverse: UndoInverse[] = gone.length > 0 ? [{ kind: "restore_items", listId: target.id, removed: gone }] : [];
    const noun = gone.length === 1 ? "item" : "items";
    return success(`Removed ${gone.length} ${noun}.`, target.id, itemIds, inverse);
  }
  if (["check_items", "uncheck_items", "edit_item"].includes(action)) {
    if (action === "edit_item" && !input.name) return fail("What should I change the item to?");
    const changed: string[] = [];
    const renamed: UndoInverse[] = [];
    for (const item of selected) {
      const edit = action === "check_items" ? { done: true } : action === "uncheck_items" ? { done: false } : { text: input.name! };
      const out = editItem(actor, target.id, item.id, edit);
      if (!out.ok) return fail("I couldn't update that item.");
      if ("done" in edit && item.done !== edit.done) changed.push(item.id);
      if ("text" in edit && item.text !== edit.text) {
        renamed.push({ kind: "edit_item_back", listId: target.id, itemId: item.id, previousText: item.text });
      }
    }
    const wasDone = action === "uncheck_items";
    const inverse: UndoInverse[] = changed.length > 0 ? [{ kind: "set_items_done", listId: target.id, itemIds: changed, done: wasDone }] : [];
    inverse.push(...renamed);
    return success("I updated the items.", target.id, itemIds, inverse);
  }
  return fail("I couldn't do that list action.");
}

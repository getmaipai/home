import type { PersonRow } from "@/types";
import type { List as ListT } from "@maipai/spec/gen/ts/list.js";
import { addItem, clearDoneItems, copyList, createList, deleteList, editItem, moveItems, removeItem, reorderItems, updateList } from "@/lib/lists";
import { isListPronoun, resolveItems, resolveList } from "@/lib/listResolver";
import type { UndoInverse } from "@/lib/toolUndo";

export const LIST_ACTIONS = ["create_list", "rename_list", "delete_list", "add_items", "remove_items", "check_items", "uncheck_items", "edit_item", "move_items", "copy_list", "reorder", "clear_done", "show_list", "find_list"] as const;
export type ListAction = (typeof LIST_ACTIONS)[number];
export interface ListActionInput { action: ListAction; list?: string; to_list?: string; items?: string[]; name?: string; exclude?: string[]; order?: string[]; lastListId?: string; lastItemIds?: string[] }
export type ListActionResult = { ok: true; reply: string; listId?: string; itemIds?: string[]; undo?: { inverse: UndoInverse[] } } | { ok: false; reply: string };
const fail = (reply: string): ListActionResult => ({ ok: false, reply });
const success = (reply: string, listId?: string, itemIds?: string[], inverse?: UndoInverse[]): ListActionResult => ({ ok: true, reply, ...(listId ? { listId } : {}), ...(itemIds ? { itemIds } : {}), ...(inverse?.length ? { undo: { inverse } } : {}) });
function resolve(actor: PersonRow, words?: string, lastListId?: string) {
  if (!words) return fail("Which list do you mean?");
  const result = resolveList(actor, words, { lastListId });
  return result.ok ? result.list : result.reason === "ambiguous" ? fail(`I found ${result.candidates} lists called that; which one?`) : fail("I couldn't find that list.");
}
function operationError(error: string): string { return error === "no such list" ? "I couldn't find that list." : "I couldn't update that list."; }
export function runListAction(actor: PersonRow, band: "child" | "teen" | "adult", input: ListActionInput): ListActionResult {
  const action = input.action;
  if (action === "create_list") {
    if (!input.name) return fail("What should I call the list?");
    const out = createList(actor, { kind: "custom", title: input.name, scope: "person" });
    return out.ok ? success("I created the list.", out.value.id) : fail("I couldn't create that list.");
  }
  const list = resolve(actor, input.list, input.lastListId);
  if (!("id" in list)) return list as ListActionResult;
  let target = list as ListT;
  const minor = band === "child" || band === "teen";
  const shopping = target.scope === "household" && target.kind === "shopping";
  const minorAllowed = new Set<ListAction>(["add_items", "check_items", "uncheck_items", "show_list", "find_list"]);
  if (minor && target.scope === "household" && !(shopping && minorAllowed.has(action))) return fail("A parent can do that.");
  if (action === "show_list" || action === "find_list") return success(action === "show_list" ? "Here is the list." : "I found the list.", target.id, target.items.map((item) => item.id));
  if (action === "rename_list") {
    if (!input.name) return fail("What should I call the list?");
    const out = updateList(actor, target.id, { title: input.name }); return out.ok ? success("I renamed the list.", target.id) : fail(operationError(out.error));
  }
  if (["check_items", "uncheck_items", "edit_item", "remove_items", "move_items", "reorder", "clear_done"].includes(action)) {
    const refreshed = resolveList(actor, target.id);
    if (refreshed.ok) target = refreshed.list;
  }
  if (action === "delete_list") {
    const out = deleteList(actor, target.id); return out.ok ? success("I deleted the list.", target.id, undefined, [{ kind: "restore_list", listId: target.id }]) : fail(operationError(out.error));
  }
  if (action === "copy_list") {
    if (!input.name) return fail("What should I call the copy?");
    const exclude = new Set(input.exclude ?? []);
    const excludeIds = target.items.filter((item) => exclude.has(item.text)).map((item) => item.id);
    const out = copyList(actor, target.id, { name: input.name, excludeItemIds: excludeIds }); return out.ok ? success("I copied the list.", out.value.id, out.value.items.map((item) => item.id)) : fail("I couldn't copy that list.");
  }
  if (action === "reorder") {
    const ids = (input.order ?? []).map((word) => resolveItems(target, word, { lastItemIds: input.lastItemIds })).filter((r) => r.ok).flatMap((r) => r.ok ? r.items.map((item) => item.id) : []);
    const out = reorderItems(actor, target.id, ids); return out.ok ? success("I reordered the list.", target.id) : fail("I couldn't reorder the list.");
  }
  if (action === "clear_done") {
    const out = clearDoneItems(actor, target.id); return out.ok ? success("I cleared the completed items.", target.id) : fail("I couldn't clear the completed items.");
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
    const other = resolve(actor, input.to_list, input.lastListId); if (!("id" in other)) return other as ListActionResult;
    const out = moveItems(actor, target.id, (other as ListT).id, itemIds); return out.ok ? success("I moved the items.", (other as ListT).id, itemIds) : fail("I couldn't move those items.");
  }
  if (action === "remove_items") {
    for (const id of itemIds) removeItem(actor, target.id, id);
    return success("I removed the items.", target.id, itemIds);
  }
  if (["check_items", "uncheck_items", "edit_item"].includes(action)) {
    if (action === "edit_item" && !input.name) return fail("What should I change the item to?");
    for (const item of selected) {
      const edit = action === "check_items" ? { done: true } : action === "uncheck_items" ? { done: false } : { text: input.name! };
      const out = editItem(actor, target.id, item.id, edit); if (!out.ok) return fail("I couldn't update that item.");
    }
    return success("I updated the items.", target.id, itemIds);
  }
  return fail("I couldn't do that list action.");
}

// Every change the Library page makes to a file, in one place. Each call goes to a hub route that checks the caller
// again (owner only, age band, role), so the page never relies on hiding a button.
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type LibraryItem } from "@/lib/api";

export interface BatchResult { done: string[]; refused: { id: string; reason: string }[] }
const NOT_YOURS = "it is not yours to change";

export function useLibraryActions(meId: string) {
  const queryClient = useQueryClient();
  const refresh = async () => {
    await Promise.all(["library", "library-summary", "library-trash", "storage-usage", "file-shares"].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
  };
  const reason = (error: unknown) => error instanceof ApiError ? error.message : "Home could not do that. Check your connection and try again.";

  async function each(items: readonly LibraryItem[], run: (item: LibraryItem) => Promise<unknown>, ownOnly = true): Promise<BatchResult> {
    const result: BatchResult = { done: [], refused: [] };
    for (const item of items) {
      if (ownOnly && item.owner.id !== meId) { result.refused.push({ id: item.id, reason: NOT_YOURS }); continue; }
      try { await run(item); result.done.push(item.id); }
      catch (error) { result.refused.push({ id: item.id, reason: reason(error) }); }
    }
    await refresh();
    return result;
  }

  return {
    refresh,
    trash: (items: readonly LibraryItem[]) => each(items, (item) => api.trashLibraryFile(item.id)),
    keep: (items: readonly LibraryItem[]) => each(items, (item) => item.retention === "kept" ? Promise.resolve() : api.updateLibraryFile(item.id, { keep: true })),
    restore: async (ids: readonly string[]) => {
      const result: BatchResult = { done: [], refused: [] };
      for (const id of ids) {
        try { await api.restoreLibraryFile(id); result.done.push(id); } catch (error) { result.refused.push({ id, reason: reason(error) }); }
      }
      await refresh();
      return result;
    },
    purge: async (ids: readonly string[]) => {
      const result: BatchResult = { done: [], refused: [] };
      for (const id of ids) {
        try { await api.purgeLibraryFile(id); result.done.push(id); } catch (error) { result.refused.push({ id, reason: reason(error) }); }
      }
      await refresh();
      return result;
    },
    rename: async (id: string, name: string) => { await api.updateLibraryFile(id, { name: name.trim() === "" ? null : name.trim() }); await refresh(); },
    recheck: async (id: string) => { await api.recheckLibraryAudience(id); await refresh(); },
    reason,
  };
}

/** "4 moved to Trash. 1 could not be moved: it is not yours to change." */
export function batchSentence(result: BatchResult, done: (count: number) => string, failed: string): string {
  const parts: string[] = [];
  if (result.done.length > 0) parts.push(`${done(result.done.length)}.`);
  if (result.refused.length > 0) {
    const first = result.refused[0]!.reason;
    parts.push(`${result.refused.length} ${failed}: ${first.charAt(0).toLowerCase()}${first.slice(1).replace(/\.$/, "")}.`);
  }
  return parts.join(" ");
}

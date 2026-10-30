import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ReferenceSaveView } from "@/lib/api";

const KEY = ["reference-saves"];

/** READER-05: the person's saved articles and the one place that saves or removes one (the list is the source of truth for the Save state). */
export function useReferenceSaves() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: KEY, queryFn: api.referenceSaves, retry: false });
  const saves: ReferenceSaveView[] = query.data?.saves ?? [];
  const refresh = () => queryClient.invalidateQueries({ queryKey: KEY });
  const add = useMutation({ mutationFn: (target: { book: string; path: string }) => api.referenceSave(target.book, target.path), onSettled: refresh });
  const remove = useMutation({ mutationFn: (id: string) => api.referenceUnsave(id), onSettled: refresh });
  const find = (book: string, path: string) => saves.find((save) => save.book === book && save.path === path);
  return {
    saves,
    isPending: query.isPending,
    isError: query.isError,
    isSaved: (book: string, path: string) => find(book, path) !== undefined,
    setSaved: (book: string, path: string, on: boolean) => {
      const existing = find(book, path);
      if (on && !existing) add.mutate({ book, path });
      if (!on && existing) remove.mutate(existing.id);
    },
    remove: (id: string) => remove.mutate(id),
  };
}

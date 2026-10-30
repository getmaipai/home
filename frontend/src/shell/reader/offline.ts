import { useCallback, useEffect, useState } from "react";
import { keepOnDevice, listKept, readKeptJson, removeFromDevice, type OfflineResult } from "@/lib/offlineMedia";
import type { ReferenceArticleView } from "@/lib/api";

/** READER-12: a kept reference article is the offline record of kind `reference`; its id is `<book>~<path>`. */
export const referenceRecord = (book: string, path: string) => ({ kind: "reference", id: `${book}~${path}` });
export const splitReferenceId = (id: string): { book: string; path: string } => { const at = id.indexOf("~"); return { book: id.slice(0, at), path: id.slice(at + 1) }; };

export interface KeptArticle { book: string; path: string; title: string }

/** The article text kept on this device, or null when it was never kept (or this browser cannot keep copies). */
export async function readKeptArticle(book: string, path: string): Promise<ReferenceArticleView | null> {
  return (await readKeptJson(referenceRecord(book, path), "a~")) as ReferenceArticleView | null;
}

/** The person's kept articles on this device (no network), with Keep and Remove that refresh the list. */
export function useKeptArticles() {
  const [kept, setKept] = useState<KeptArticle[]>([]);
  const [ready, setReady] = useState(false);
  const refresh = useCallback(async () => {
    try {
      setKept((await listKept()).filter((m) => m.kind === "reference").map((m) => ({ ...splitReferenceId(m.id), title: m.title })));
    } catch { setKept([]); }
    setReady(true);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return {
    kept,
    ready,
    isKept: (book: string, path: string) => kept.some((item) => item.book === book && item.path === path),
    keep: async (book: string, path: string): Promise<OfflineResult> => { const result = await keepOnDevice(referenceRecord(book, path)); await refresh(); return result; },
    remove: async (book: string, path: string) => { await removeFromDevice(referenceRecord(book, path)); await refresh(); },
  };
}

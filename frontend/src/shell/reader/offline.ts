import { readKeptJson } from "@/lib/offlineMedia";
import type { ReferenceArticleView } from "@/lib/api";

/** READER-12: a kept reference article is the offline record of kind `reference`; its id is `<book>~<path>`. */
export const referenceRecord = (book: string, path: string) => ({ kind: "reference", id: `${book}~${path}` });
export const splitReferenceId = (id: string): { book: string; path: string } => { const at = id.indexOf("~"); return { book: id.slice(0, at), path: id.slice(at + 1) }; };

export interface KeptArticle { book: string; path: string; title: string }

/** The article text kept on this device, or null when it was never kept (or this browser cannot keep copies). */
export async function readKeptArticle(book: string, path: string): Promise<ReferenceArticleView | null> {
  return (await readKeptJson(referenceRecord(book, path), "a~")) as ReferenceArticleView | null;
}


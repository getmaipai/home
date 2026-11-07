import { readKeptJson } from "@/lib/offlineMedia";
import type { ReferenceArticleView } from "@/lib/api";

/** READER-12: a kept reference article is the offline record of kind `reference`; its id is `<book>~<path>`. */
export const referenceRecord = (book: string, path: string) => ({ kind: "reference", id: `${book}~${path}` });
/** The article text kept on this device, or null when it was never kept (or this browser cannot keep copies). */
export async function readKeptArticle(book: string, path: string): Promise<ReferenceArticleView | null> {
  return (await readKeptJson(referenceRecord(book, path), "a~")) as ReferenceArticleView | null;
}


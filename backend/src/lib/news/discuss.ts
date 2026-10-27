// NEWS-DISCUSS-TOOL-2026-10-27: a story's text for the chat's `read_item` tool. The same floors as the reader: only a story the
// person's band is released, the band's own stored copy (a child's gate and a teen's links hold), and a teaser-only story reads
// as its summary. A child never reaches Discuss, so a child's reference resolves to nothing.
import type { PersonRow } from "@/types";
import { loadContent, textOfBlocks } from "./article";
import { releasedItem } from "./cards";
import { viewerOf } from "./data";

/** What the chat tool message can carry (composer.ts cuts a tool result at 6000 characters, JSON included). */
export const DISCUSS_MAX_CHARS = 5000;

export async function readNewsStory(person: PersonRow, id: string): Promise<{ title: string; text: string } | null> {
  const viewer = viewerOf(person);
  if (person.role === "guest" || viewer.band === "child") return null;
  const item = releasedItem(viewer, id);
  if (!item) return null;
  const content = await loadContent(item, viewer.band);
  const text = textOfBlocks(content.blocks).slice(0, DISCUSS_MAX_CHARS).trim();
  if (!text) return null;
  return { title: `${item.title}${item.publisher ? ` (${item.publisher})` : ""}`, text };
}

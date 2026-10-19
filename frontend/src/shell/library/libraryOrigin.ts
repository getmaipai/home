import type { LibraryItem } from "@/lib/api";
import { chatTurnHref } from "@/apps/chat/chatTurnDeepLinkModel";

export type LibraryOrigin = { label: string; href?: string };

export function libraryOrigin(item: LibraryItem, fallbackOrigin?: string): LibraryOrigin {
  const origin = item.origin ?? fallbackOrigin;
  if (origin === "fetched") return { label: "Fetched from a media source" };
  if (item.chat_id && item.turn_id) {
    const title = item.chat_title?.trim() || "Chat";
    const label = origin === "made" ? `Made in chat: ${title}` : `Sent in chat: ${title}`;
    return { label, href: chatTurnHref(item.chat_id, item.turn_id, origin === "sent" ? "user" : "assistant") };
  }
  if (item.chat_deleted) return { label: "The chat was deleted" };
  if (origin === "made") return { label: "Made by Home" };
  return { label: "Added to the Library" };
}

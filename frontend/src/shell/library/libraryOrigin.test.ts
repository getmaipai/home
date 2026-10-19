import { expect, test } from "bun:test";
import type { LibraryItem } from "@/lib/api";
import { libraryOrigin } from "./libraryOrigin";

const item = (patch: Partial<LibraryItem> = {}) => ({
  id: "file-demo0001", kind: "image", name: "Lake", media_type: "image/png", size_bytes: 10, created_at: "2026-10-19",
  owner: { id: "person-demo", display_name: "Nova" }, shared_with: { count: 0, household: false }, retention: "kept",
  chat_id: null, can_edit: false, audience: null, duration_seconds: null, thumb_url: "", expires_at: null, version_count: 1,
  ...patch,
}) as LibraryItem;

test("a chat-made item links to its exact turn and names the chat", () => {
  expect(libraryOrigin(item({ origin: "made", chat_id: "conv-a", turn_id: "turn-a", chat_title: "Weekend plans" }))).toEqual({
    label: "Made in chat: Weekend plans", href: "/chat?conversation=conv-a&turn=turn-a",
  });
});

test("sent chat files link to the turn that carried them", () => {
  expect(libraryOrigin(item({ origin: "sent", chat_id: "conv-a", turn_id: "turn-a", chat_title: "Weekend plans" }))).toEqual({
    label: "Sent in chat: Weekend plans", href: "/chat?conversation=conv-a&turn=turn-a&message=user",
  });
});

test("deleted chats and fetched files have plain origin text", () => {
  expect(libraryOrigin(item({ origin: "made", chat_deleted: true }))).toEqual({ label: "The chat was deleted" });
  expect(libraryOrigin(item({ origin: "fetched", chat_id: "conv-a", turn_id: "turn-a" }))).toEqual({ label: "Fetched from a media source" });
});

// Date buckets for the chat list: the kit's thread-list.aui.tsx groups Today / Yesterday / Earlier
// and has no hook to change the labels, so the list body composes the kit's own item with this.
export type ChatListGroupLabel = "Today" | "Yesterday" | "Previous 7 days" | "Older";

const DAY_MS = 86_400_000;

/** Local calendar days, not 24-hour windows: 23:30 last night is Yesterday at 00:10 today. */
export function chatListGroupLabel(date: Date | undefined, now: Date): ChatListGroupLabel {
  if (!date) return "Today";
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = date.getTime();
  if (t >= startOfToday) return "Today";
  if (t >= startOfToday - DAY_MS) return "Yesterday";
  if (t >= startOfToday - 7 * DAY_MS) return "Previous 7 days";
  return "Older";
}

export function groupChatList<T extends { lastMessageAt?: Date | undefined }>(items: readonly T[], now: Date): Array<{ label: ChatListGroupLabel; items: T[] }> {
  const time = (item: T) => item.lastMessageAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const groups: Array<{ label: ChatListGroupLabel; items: T[] }> = [];
  for (const item of [...items].sort((a, b) => time(b) - time(a))) {
    const label = chatListGroupLabel(item.lastMessageAt, now);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

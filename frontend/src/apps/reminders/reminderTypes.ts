import type { List as ListRecord } from "@maipai/spec/gen/ts/list.js";

export const LIST_ICONS = ["cart", "check", "sparkle", "briefcase", "home", "heart", "book", "star", "gift", "plane", "leaf", "sun"] as const;
export type ListIcon = typeof LIST_ICONS[number];
export type ReminderView = { kind: "list"; id: string } | { kind: "today" | "scheduled" };

export function iconFor(list: ListRecord): ListIcon {
  if (list.kind === "shopping") return "cart";
  if (list.kind === "todo") return "check";
  return (list.icon ?? "sparkle") as ListIcon;
}

export function labelFor(list: ListRecord): string {
  if (list.kind === "shopping") return "Shopping";
  if (list.kind === "todo") return "To-do";
  return list.title;
}

export function itemCount(list: ListRecord): number {
  return list.items.filter((item) => !item.done).length;
}

export function dueLabel(value: string): string {
  return new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

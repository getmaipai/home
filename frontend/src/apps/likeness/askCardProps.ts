// PERUSE-2026-10-25: the words and state of the consent card, as plain data for the kit ApprovalCard. Not a component: the
// chat thread and the settings list each render the Element directly with these props (rule 9, no wrapper).
import type { ComponentProps } from "react";
import type { ApprovalCard } from "@maipai/ui/src/elements/approval-card";
import type { LikenessAsk } from "@/lib/likenessAsksApi";

type ApprovalCardProps = ComponentProps<typeof ApprovalCard>;

export const ASK_POLL_MS = 2_000;
export const askKey = (id: string) => ["likeness-ask", id] as const;
export const askOpen = (ask: Pick<LikenessAsk, "state">): boolean => ask.state === "waiting" || ask.state === "approved";

function plural(count: number, noun: string): string { return count === 1 ? `1 ${noun}` : `${count} ${noun}s`; }

/** The words an ask shows in the card's status row once it has been answered or has ended. */
export function askStatusWords(ask: Pick<LikenessAsk, "state" | "subject_name">): { state: "running" | "denied"; words: string } {
  switch (ask.state) {
    case "approved": case "consumed": return { state: "running", words: "Said yes. Making it now." };
    case "declined": return { state: "denied", words: `${ask.subject_name} said no. Nothing was made.` };
    case "expired": return { state: "denied", words: "No answer in 10 minutes. Nothing was made. Ask again." };
    default: return { state: "denied", words: "This request ended. Nothing was made." };
  }
}

/** Everything the card needs except the icon and the two handlers. */
export function askCardProps(ask: LikenessAsk): Pick<ApprovalCardProps, "state" | "title" | "subtitle" | "command" | "allowLabel" | "denyLabel" | "statusLabels"> {
  const medium = ask.medium === "video" ? "video" : "picture";
  const settled = askStatusWords(ask);
  return {
    state: ask.state === "waiting" ? "request" : settled.state,
    title: `${ask.requester_name} wants to make a ${medium} that looks like you`,
    subtitle: `This is exactly what will be made. ${plural(ask.count, medium)}${ask.style_name ? ", with your saved style" : ""}. It includes adult content.`,
    ...(ask.prompt !== null ? { command: ask.prompt } : {}),
    allowLabel: "Consent",
    denyLabel: "Decline",
    statusLabels: { running: settled.words, denied: settled.words, done: settled.words },
  };
}

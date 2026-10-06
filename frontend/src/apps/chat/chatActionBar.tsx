import { type FeedbackAdapter } from "@assistant-ui/react";
import { toast } from "sonner";
import { create } from "zustand";
import { api } from "@/lib/api";

/** One reply's open "What went wrong?" form: what is picked so far. */
export type FeedbackFormState = { selected: string[]; note: string; sent: boolean };

// ELEMENTS-ADOPT-02: the replies whose "What went wrong?" form is open,
// keyed by turn id. A thumbs-down tapped in this session opens it empty; a
// reloaded thread never reopens it for an old rating.
export const useFeedbackFormStore = create<{
  open: Record<string, FeedbackFormState>;
  openFor(turnId: string): void;
  update(turnId: string, change: Partial<FeedbackFormState>): void;
  close(turnId: string): void;
}>((set) => ({
  open: {},
  openFor: (turnId) => set((s) => ({ open: { ...s.open, [turnId]: { selected: [], note: "", sent: false } } })),
  update: (turnId, change) => set((s) => {
    const current = s.open[turnId];
    return current ? { open: { ...s.open, [turnId]: { ...current, ...change } } } : s;
  }),
  close: (turnId) => set((s) => {
    if (s.open[turnId] === undefined) return s;
    const open = { ...s.open };
    delete open[turnId];
    return { open };
  }),
}));

// The reply's thumbs row is the kit Thread's own action bar; this adapter is
// the one piece Home owns: where a rating goes (the turn id on the message).
// A down rating also opens the reasons form for that reply (it never shows
// for a child, chatFeedbackDialog.ts); an up rating closes it.
export function createChatFeedbackAdapter(): FeedbackAdapter {
  return {
    submit: ({ message, type }) => {
      const turnId = message.metadata?.custom?.turnId as string | undefined;
      if (!turnId) return;
      const form = useFeedbackFormStore.getState();
      if (type === "negative") form.openFor(turnId);
      else form.close(turnId);
      void api.submitConversationFeedback(turnId, type === "positive" ? "up" : "down").catch(() => {
        toast.error("Couldn't save feedback - try again.");
      });
    },
  };
}

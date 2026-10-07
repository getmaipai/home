import { type ExportedMessageRepository, type FeedbackAdapter } from "@assistant-ui/react";
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
// for a child, chatFeedbackDialog.ts); an up rating closes it. FEEDBACK-CANCEL-01:
// the same thumb tapped again (it is already lit) takes the rating back, as
// ChatGPT and Claude do: the form closes, the stored rating is deleted, and
// `clearRating` un-lights the thumb (the runtime has no clear of its own).
export function createChatFeedbackAdapter(options: { clearRating?: (messageId: string) => void } = {}): FeedbackAdapter {
  return {
    submit: ({ message, type }) => {
      const turnId = message.metadata?.custom?.turnId as string | undefined;
      if (!turnId) return;
      const form = useFeedbackFormStore.getState();
      if (message.metadata?.submittedFeedback?.type === type) {
        form.close(turnId);
        void api.clearConversationFeedback(turnId).catch(() => {
          toast.error("Couldn't remove your rating - try again.");
        });
        // The runtime marks the thumb after this adapter returns.
        queueMicrotask(() => options.clearRating?.(message.id));
        return;
      }
      if (type === "negative") form.openFor(turnId);
      else form.close(turnId);
      void api.submitConversationFeedback(turnId, type === "positive" ? "up" : "down").catch(() => {
        toast.error("Couldn't save feedback - try again.");
      });
    },
  };
}

/** FEEDBACK-CANCEL-01: drop one reply's lit thumb from the thread. assistant-ui
 * has no "clear feedback" call, so this re-imports the thread's own exported
 * messages with that reply's submittedFeedback removed. */
export function clearSubmittedFeedback(
  thread: { export(): ExportedMessageRepository; import(data: ExportedMessageRepository): void },
  messageId: string,
) {
  const repository = thread.export();
  thread.import({
    ...repository,
    messages: repository.messages.map((entry) => {
      if (entry.message.id !== messageId || entry.message.role !== "assistant") return entry;
      const metadata = { ...entry.message.metadata };
      delete metadata.submittedFeedback;
      return { ...entry, message: { ...entry.message, metadata } };
    }),
  });
}

import { type FeedbackAdapter } from "@assistant-ui/react";
import { toast } from "sonner";
import { api } from "@/lib/api";

// The reply's thumbs row is the kit Thread's own action bar; this adapter is
// the one piece Home owns: where a rating goes (the turn id on the message).
export function createChatFeedbackAdapter(): FeedbackAdapter {
  return {
    submit: ({ message, type }) => {
      const turnId = message.metadata?.custom?.turnId as string | undefined;
      if (!turnId) return;
      void api.submitConversationFeedback(turnId, type === "positive" ? "up" : "down").catch(() => {
        toast.error("Couldn't save feedback - try again.");
      });
    },
  };
}

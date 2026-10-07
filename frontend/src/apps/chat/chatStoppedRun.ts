import { useContext } from "react";
import { useAui, useAuiState } from "@assistant-ui/react";
import { messageText } from "@/apps/chat/chatMessageText";
import { ChatAgeBandContext } from "@/apps/chat/chatThreadContexts";
import { setPendingContinuation } from "@/apps/chat/chatContinue";

const STOP_REASON: Record<"child" | "teen" | "adult", string> = {
  child: "You stopped it",
  teen: "You stopped this reply",
  adult: "You stopped this reply",
};

/** Props for the shipped StoppedRun Element after a user cancels a reply.
 * Other incomplete states, including length and output-gate stops, have
 * their own handling and never render this continuation affordance. */
export function useStoppedRun() {
  const band = useContext(ChatAgeBandContext);
  const message = useAuiState((state) => state.message);
  const status = message.status;
  const aui = useAui();

  if (status?.type !== "incomplete" || status.reason !== "cancelled") return null;

  const text = messageText(message);
  const turnId = message.metadata?.custom?.turnId;
  return {
    words: text.split(/\s+/).filter(Boolean),
    reason: STOP_REASON[band],
    onContinue: () => {
      setPendingContinuation({ assistantText: text, ...(typeof turnId === "string" ? { fromTurnId: turnId } : {}) });
      void aui.message().reload();
    },
  };
}

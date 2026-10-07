import { useContext, useEffect } from "react";
import { useAuiState } from "@assistant-ui/react";
import { toast } from "sonner";
import { api, type ReplyFeedback } from "@/lib/api";
import { useFeedbackFormStore } from "@/apps/chat/chatActionBar";
import { ChatAgeBandContext } from "@/apps/chat/chatThreadContexts";

type Reason = NonNullable<ReplyFeedback["reasons"]>[number];

// FEED-01's fixed five reasons, in the words the old reasons row used.
export const FEEDBACK_REASONS: ReadonlyArray<{ value: Reason; label: string }> = [
  { value: "wrong", label: "Wrong" },
  { value: "too_long", label: "Too long" },
  { value: "did_not_listen", label: "Didn't listen" },
  { value: "off", label: "Off topic" },
  { value: "unsafe", label: "Unsafe" },
];
const LABELS = FEEDBACK_REASONS.map((reason) => reason.label);
const THANKS_MS = 2500;

/** ELEMENTS-ADOPT-02: the data and handlers for the kit's feedback-dialog
 * under one reply after a thumbs-down, or null when it is closed. The
 * Element itself is rendered as it ships by the message footer slot
 * (chatThreadSlots.tsx). Adults and teens only: a child's rating stays one
 * tap (FEED-01), and the hub refuses a child's reasons or note anyway. A
 * teen's note is private to the teen (only its writer reads it back). */
export function useReplyFeedbackForm() {
  const band = useContext(ChatAgeBandContext);
  const turnId = useAuiState((s) => s.message.metadata?.custom?.turnId as string | undefined);
  const negative = useAuiState((s) => s.message.metadata?.submittedFeedback?.type === "negative");
  const form = useFeedbackFormStore((s) => (turnId ? s.open[turnId] : undefined));
  const update = useFeedbackFormStore((s) => s.update);
  const close = useFeedbackFormStore((s) => s.close);
  const sent = form?.sent === true;

  useEffect(() => {
    if (!sent || !turnId) return;
    const timer = setTimeout(() => close(turnId), THANKS_MS);
    return () => clearTimeout(timer);
  }, [sent, turnId, close]);

  if (band === "child" || !turnId || !form || !negative) return null;

  return {
    reasons: LABELS,
    selected: form.selected,
    note: form.note,
    sent: form.sent,
    onToggleReason: (label: string) =>
      update(turnId, { selected: form.selected.includes(label) ? form.selected.filter((item) => item !== label) : [...form.selected, label] }),
    onNoteChange: (value: string) => update(turnId, { note: value.slice(0, 1000) }),
    // FEEDBACK-CANCEL-01: closes the form and keeps the thumbs-down already
    // stored; tapping the lit thumb is what takes the rating back.
    onCancel: () => close(turnId),
    onSubmit: () => {
      const reasons = FEEDBACK_REASONS.filter((reason) => form.selected.includes(reason.label)).map((reason) => reason.value);
      const trimmed = form.note.trim();
      api
        .submitConversationFeedback(turnId, "down", reasons[0] ?? null, { reasons, note: trimmed ? trimmed : null })
        .then(() => update(turnId, { sent: true }))
        .catch(() => toast.error("Couldn't save feedback - try again."));
    },
  };
}

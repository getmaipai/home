"use client";

import { MessagePrimitive, useAui, useAuiState } from "@assistant-ui/react";
import { ErrorState } from "@maipai/ui/src/elements/error-state";
import { GuardrailNotice } from "@maipai/ui/src/elements/guardrail-notice";
import { useContext, useEffect, useRef, useState } from "react";
import { QueryClientContext } from "@tanstack/react-query";
import { ChatTurnError } from "@/apps/chat/chatTurnError";
import { ChatAvailabilityContext, engineDownReason } from "@/apps/chat/useChatAvailability";

type MessageErrorValue = {
  message: string;
  code?: string;
  turnId?: string;
};

export function ChatMessageError() {
  const status = useAuiState((s) => s.message.status);
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const aui = useAui();
  const availability = useContext(ChatAvailabilityContext);
  const queryClient = useContext(QueryClientContext);
  const [retrying, setRetrying] = useState(false);
  const previousStatus = useRef(status);

  useEffect(() => {
    if (!isRunning || previousStatus.current !== status) setRetrying(false);
    previousStatus.current = status;
  }, [isRunning, status]);

  const errorValue = status?.type === "incomplete" && status.reason === "error" ? status.error : undefined;
  const engineDown = typeof errorValue === "object" && errorValue !== null && "code" in errorValue && errorValue.code === "engine_unavailable";
  // An engine failure: read health now rather than on the next poll, so the
  // composer line takes over this cause straight away.
  useEffect(() => {
    if (engineDown) {
      void queryClient?.invalidateQueries({ queryKey: ["health"] });
      void queryClient?.invalidateQueries({ queryKey: ["status-apps"] });
    }
  }, [engineDown, queryClient]);
  if (!errorValue || typeof errorValue !== "object" || !("message" in errorValue) || typeof errorValue.message !== "string") {
    return null;
  }

  const error = errorValue as unknown as MessageErrorValue;
  // SAFETY-NOTICE-01: one message, never a title and a body saying the
  // same thing. With crisis resources the notice is the support block the
  // hub sent (a calm title, its text, call, text and chat links); without
  // them it is the hub's one plain sentence in the person's band. No
  // policy tag for anyone.
  if (error instanceof ChatTurnError && error.code === "safety_refused") {
    const support = error.crisisSupport;
    return (
      <MessagePrimitive.Error>
        {support ? (
          <GuardrailNotice tone="support" title={support.title} explanation={support.text} actions={support.actions} alternatives={[]} />
        ) : (
          <GuardrailNotice title={error.message} alternatives={[]} />
        )}
      </MessagePrimitive.Error>
    );
  }

  // CHAT-CALM-ERRORS-01d (design sections 2 and 8): one cause, one visual.
  // While the engine is down or starting the composer line owns the cause,
  // so this reply draws nothing inline (the partial text, if any, stays).
  if (error.code === "engine_unavailable" && availability !== "ready") return null;

  const retry = () => {
    setRetrying(true);
    void aui.message().reload();
  };

  // The person's line is the whole message (no title above it), muted, with
  // a text Retry: the kit ErrorState (ui-v0.5.103 calm colours), as wide as
  // the message column so one sentence stays on one line on a desktop.
  return (
    <MessagePrimitive.Error>
      <ErrorState title={error.message} detail="" retrying={retrying} onRetry={retry} retryDisabled={engineDownReason(availability)} className="max-w-none px-0 py-1" />
    </MessagePrimitive.Error>
  );
}

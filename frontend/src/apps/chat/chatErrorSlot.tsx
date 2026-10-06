"use client";

import { MessagePrimitive, useAui, useAuiState } from "@assistant-ui/react";
import { ErrorState } from "@maipai/ui/src/elements/error-state";
import { GuardrailNotice } from "@maipai/ui/src/elements/guardrail-notice";
import { useEffect, useRef, useState } from "react";
import { ChatTurnError } from "@/apps/chat/chatTurnError";

type MessageErrorValue = {
  message: string;
  code?: string;
  turnId?: string;
};

export function ChatMessageError() {
  const status = useAuiState((s) => s.message.status);
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const aui = useAui();
  const [retrying, setRetrying] = useState(false);
  const previousStatus = useRef(status);

  useEffect(() => {
    if (!isRunning || previousStatus.current !== status) setRetrying(false);
    previousStatus.current = status;
  }, [isRunning, status]);

  const errorValue = status?.type === "incomplete" && status.reason === "error" ? status.error : undefined;
  if (!errorValue || typeof errorValue !== "object" || !("message" in errorValue) || typeof errorValue.message !== "string") {
    return null;
  }

  const error = errorValue as unknown as MessageErrorValue;
  if (error instanceof ChatTurnError && error.code === "safety_refused") {
    return (
      <MessagePrimitive.Error>
        <GuardrailNotice title="I can't help with that" explanation={error.message} policy="safety" alternatives={[]} />
      </MessagePrimitive.Error>
    );
  }

  const retry = () => {
    setRetrying(true);
    void aui.message().reload();
  };

  return (
    <MessagePrimitive.Error>
      <ErrorState title="Couldn't finish that reply" detail={error.message} retrying={retrying} onRetry={retry} />
    </MessagePrimitive.Error>
  );
}

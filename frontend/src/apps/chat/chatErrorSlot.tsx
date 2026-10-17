"use client";

import { MessagePrimitive, useAui, useAuiState } from "@assistant-ui/react";
import { ErrorState } from "@maipai/ui/src/elements/error-state";
import { GuardrailNotice } from "@maipai/ui/src/elements/guardrail-notice";
import { useContext, useEffect, useRef, useState } from "react";
import { QueryClientContext } from "@tanstack/react-query";
import { useWhenHubBack } from "@/lib/hubReachability";
import { ChatTurnError } from "@/apps/chat/chatTurnError";
import { ChatAvailabilityContext, chatWasRecentlyNotReady, engineDownReason, RECENT_NOT_READY_MS } from "@/apps/chat/useChatAvailability";

type MessageErrorValue = {
  message: string;
  code?: string;
  turnId?: string;
};

/** CHAT-PAUSE-01: the replies already retried once on their own, so a reply
 * is never sent twice by the automatic path (a manual Retry is always the person's). */
const autoRetried = new Set<string>();
export function __resetAutoRetriedForTests(): void { autoRetried.clear(); }

/** The codes a dropped or refused answer carries when the engine restarting
 * is the likely cause; a coded refusal (safety, incognito, upload) is not. */
const RESTART_CODES = new Set(["engine_unavailable", "unavailable", "client_unreachable"]);
// hub_unreachable is the hub itself not answering; it has its own wait above.
export const RESTARTED_LINE = "The AI restarted while I was answering. Try again in a minute.";

export function ChatMessageError() {
  const status = useAuiState((s) => s.message.status);
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const aui = useAui();
  const availability = useContext(ChatAvailabilityContext);
  const queryClient = useContext(QueryClientContext);
  const messageId = useAuiState((s) => s.message.id);
  const isLast = useAuiState((s) => s.message.isLast);
  const [retrying, setRetrying] = useState(false);
  const armedAt = useRef<number | null>(null);
  const sawNotReady = useRef(false);
  const previousStatus = useRef(status);

  useEffect(() => {
    if (!isRunning || previousStatus.current !== status) setRetrying(false);
    previousStatus.current = status;
  }, [isRunning, status]);

  const errorValue = status?.type === "incomplete" && status.reason === "error" ? status.error : undefined;
  const engineDown = typeof errorValue === "object" && errorValue !== null && "code" in errorValue && errorValue.code === "engine_unavailable";
  // An engine failure: read health now rather than on the next poll, so the
  // composer line takes over this cause straight away.
  const errorCode = typeof errorValue === "object" && errorValue !== null && "code" in errorValue && typeof errorValue.code === "string" ? errorValue.code : "unavailable";
  const hubDown = errorCode === "hub_unreachable";
  // CHAT-PAUSE-01: the hub itself did not answer (a restart or an update).
  // Ask it every few seconds; when it answers, send that reply's request
  // again, once, with the same guard as above.
  useWhenHubBack(hubDown && isLast && !isRunning && !autoRetried.has(messageId), () => {
    if (autoRetried.has(messageId)) return;
    autoRetried.add(messageId);
    setRetrying(true);
    void Promise.resolve(aui.message().reload()).catch(() => {});
  });
  const restartLike = errorValue !== undefined && RESTART_CODES.has(errorCode);
  // A reply that failed: read health now, not on the next poll, so the
  // composer line takes over this cause straight away.
  useEffect(() => {
    if (restartLike) {
      armedAt.current ??= Date.now();
      void queryClient?.invalidateQueries({ queryKey: ["health"] });
    }
  }, [restartLike, queryClient]);
  // CHAT-PAUSE-01: when chat comes back within 90 s of a reply that failed
  // while it was not ready, send that same reply's request again, once.
  if (restartLike && availability !== "ready") sawNotReady.current = true;
  const failedWhileNotReady = restartLike && (sawNotReady.current || chatWasRecentlyNotReady(queryClient));
  useEffect(() => {
    if (!failedWhileNotReady || availability !== "ready" || !isLast || isRunning || autoRetried.has(messageId)) return;
    if (armedAt.current === null || Date.now() - armedAt.current > RECENT_NOT_READY_MS) return;
    autoRetried.add(messageId);
    setRetrying(true);
    void Promise.resolve(aui.message().reload()).catch(() => {});
  }, [failedWhileNotReady, availability, isLast, isRunning, messageId, aui]);
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
  // Chat is back but it was not ready a moment ago: this reply was cut off by
  // the restart, so say that instead of the generic failure line.
  const title = failedWhileNotReady ? RESTARTED_LINE : error.message;

  const retry = () => {
    setRetrying(true);
    void aui.message().reload();
  };

  // The person's line is the whole message (no title above it), muted, with
  // a text Retry, using the kit ErrorState as shipped.
  return (
    <MessagePrimitive.Error>
      <ErrorState title={title} detail="" retrying={retrying} onRetry={retry} retryDisabled={engineDownReason(availability)} />
    </MessagePrimitive.Error>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import type { StateId } from "@maipai/ui/src/elements/companion-avatar-machine";

export type CompanionWanted = { needs_you: boolean; speaking: boolean; working: boolean; thinking: boolean; listening: boolean; sleeping: boolean };
export type SignalMessage = { role: string; content?: Array<{ type?: string; text?: string; name?: string; toolName?: string; status?: string | { type?: string }; state?: string; error?: unknown }>; status?: string | { type?: string; reason?: string }; error?: unknown };
function partStatus(part: NonNullable<SignalMessage["content"]>[number]): string | undefined {
  return typeof part.status === "string" ? part.status : part.status?.type ?? part.state;
}
function messageStatus(message?: SignalMessage): string | undefined {
  return typeof message?.status === "string" ? message.status : message?.status?.type;
}
function messageFailureReason(message?: SignalMessage): string | undefined {
  return typeof message?.status === "object" ? message.status?.reason : undefined;
}
export function assistantText(message?: SignalMessage): string {
  return (message?.content ?? []).filter((part) => part.type === "text").map((part) => part.text ?? "").join("");
}
export function isThinking(running: boolean, lastAssistant?: SignalMessage): boolean {
  return running && lastAssistant?.role === "assistant" && assistantText(lastAssistant).length === 0;
}
export function isWorking(lastAssistant: SignalMessage | undefined, jobRunning: boolean): boolean {
  return jobRunning || (lastAssistant?.content ?? []).some((part) => (part.type === "tool-call" || part.type === "tool_call") && partStatus(part) === "running");
}
export function isNeedsYou(waiting: boolean, pendingApproval: boolean): boolean { return waiting || pendingApproval; }
export function isSpeaking(speaking: boolean): boolean { return speaking; }
export function isListening(recording: boolean): boolean { return recording; }
export function isOops(lastAssistant?: SignalMessage): boolean {
  return !!lastAssistant && (messageStatus(lastAssistant) === "error" || (messageStatus(lastAssistant) === "incomplete" && messageFailureReason(lastAssistant) === "error") || lastAssistant.error !== undefined || (lastAssistant.content ?? []).some((part) => part.type === "error" || part.error !== undefined));
}
export function isPendingApproval(lastAssistant?: SignalMessage): boolean {
  return (lastAssistant?.content ?? []).some((part) => (part.type === "tool-call" || part.type === "tool_call") && (part.name ?? part.toolName) === "confirm" && partStatus(part) === "running");
}
export function greetingForDay(personId: string, date: string, storage: Pick<Storage, "getItem" | "setItem"> | null): boolean {
  if (!storage) return true;
  const key = `maipai.companion.greeted.${personId}`;
  try {
    if (storage.getItem(key) === date) return false;
    storage.setItem(key, date);
  } catch { /* Storage can be disabled; greeting still works this mount. */ }
  return true;
}
export function jobFinished(previousRunning: ReadonlySet<string>, doneIds: ReadonlySet<string>): boolean {
  return [...previousRunning].some((id) => doneIds.has(id));
}

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
function greetFromBrowserStorage(personId: string): boolean {
  try { return greetingForDay(personId, today(), window.localStorage); }
  catch { return greetingForDay(personId, today(), null); }
}
export function useCompanionSignals(input: {
  personId: string;
  messages: SignalMessage[];
  running: boolean;
  jobRunning: boolean;
  jobWaiting: boolean;
  runningJobIds: ReadonlySet<string>;
  doneJobIds: ReadonlySet<string>;
  isSpeaking: boolean;
  listening: boolean;
}) {
  const assistants = input.messages.filter((message) => message.role === "assistant");
  const last = assistants.at(-1);
  const pendingApproval = isPendingApproval(last);
  const active = input.running || input.jobRunning || input.jobWaiting || input.isSpeaking || input.listening || pendingApproval;
  const activityKey = `${input.running}:${input.jobRunning}:${input.jobWaiting}:${input.isSpeaking}:${input.listening}:${input.messages.map((message) => `${message.role}:${messageStatus(message) ?? ""}:${assistantText(message)}`).join("|")}`;
  const [sleeping, setSleeping] = useState(false);
  useEffect(() => {
    setSleeping(false);
    if (active) return;
    const timer = window.setTimeout(() => setSleeping(true), 10 * 60_000);
    return () => window.clearTimeout(timer);
  }, [active, activityKey]);

  const nonce = useRef(0);
  const previousRunning = useRef<ReadonlySet<string>>(new Set());
  const greeted = useMemo(() => greetFromBrowserStorage(input.personId), [input.personId]);
  const [once, setOnce] = useState<{ state: StateId; nonce: number } | null>(() => greeted ? { state: "greeting", nonce: 1 } : null);
  useEffect(() => { if (greeted) { nonce.current = 1; setOnce({ state: "greeting", nonce: 1 }); } }, [greeted]);
  useEffect(() => {
    if (isOops(last)) { const next = ++nonce.current; setOnce({ state: "oops", nonce: next }); }
  }, [last]);
  useEffect(() => {
    if (jobFinished(previousRunning.current, input.doneJobIds)) { const next = ++nonce.current; setOnce({ state: "celebrate", nonce: next }); }
    previousRunning.current = input.runningJobIds;
  }, [input.doneJobIds, input.runningJobIds]);

  const wanted: CompanionWanted = {
    thinking: isThinking(input.running, last),
    working: isWorking(last, input.jobRunning),
    speaking: isSpeaking(input.isSpeaking),
    needs_you: isNeedsYou(input.jobWaiting, pendingApproval),
    listening: isListening(input.listening),
    sleeping: !active && sleeping,
  };
  return { wanted, once };
}

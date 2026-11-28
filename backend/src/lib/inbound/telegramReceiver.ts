import { sendTelegramMessage } from "@/lib/telegramChannel";
import { decideInbound, type Binding, type InboundDecision } from "./decide";
import { redeemInboundPairing } from "./pairing";

const TELEGRAM_API_BASE = "https://api.telegram.org";
const POLL_TIMEOUT_SECONDS = 25;
const REQUEST_TIMEOUT_MS = 35_000;
const MAX_RETRY_MS = 300_000;

type FetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

export interface ReceiverDeps {
  enabled: () => boolean;
  token: () => string | undefined;
  fetchFn: (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<FetchResponse>;
  bindings: () => readonly Binding[];
  redeem: typeof redeemInboundPairing;
  send: (chatId: string, text: string) => Promise<boolean>;
  onBinding: (binding: Binding) => void;
  offset: number;
}

export type ReceiverEvent =
  | { kind: "decision"; updateId: number; senderId: string; chatId: string; decision: InboundDecision; text: string }
  | { kind: "paired"; updateId: number; senderId: string; personId: string }
  | { kind: "pair-failed"; updateId: number; reason: string }
  | { kind: "ignored"; updateId: number; why: "no-message" | "no-sender" | "bot" | "not-text" };

type TelegramUpdate = {
  update_id?: unknown;
  message?: unknown;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function retryAfterFrom(value: unknown): number | null {
  const root = record(value);
  const parameters = record(root?.parameters);
  const seconds = parameters?.retry_after;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(seconds * 1000, MAX_RETRY_MS);
}

function pairCode(text: string): string | null {
  const match = /^(?:\/pair|\/start)\s+([A-Za-z0-9]{6})$/.exec(text);
  return match?.[1] ?? null;
}

async function sendQuietly(send: ReceiverDeps["send"], chatId: string, text: string): Promise<void> {
  try {
    await send(chatId, text);
  } catch {
    // Sending a reply is best effort and must not interrupt update processing.
  }
}

export async function pollOnce(deps: ReceiverDeps): Promise<{
  events: ReceiverEvent[];
  nextOffset: number;
  retryAfterMs: number | null;
  disabled: boolean;
}> {
  if (!deps.enabled()) return { events: [], nextOffset: deps.offset, retryAfterMs: null, disabled: true };

  let token: string | undefined;
  try {
    token = deps.token();
  } catch {
    return { events: [], nextOffset: deps.offset, retryAfterMs: null, disabled: true };
  }
  if (!token) return { events: [], nextOffset: deps.offset, retryAfterMs: null, disabled: true };

  let response: FetchResponse;
  let body: unknown;
  try {
    response = await deps.fetchFn(`${TELEGRAM_API_BASE}/bot${token}/getUpdates`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ offset: deps.offset, timeout: POLL_TIMEOUT_SECONDS, allowed_updates: ["message"] }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    body = await response.json();
  } catch {
    return { events: [], nextOffset: deps.offset, retryAfterMs: 5000, disabled: false };
  }

  const bodyRecord = record(body);
  const retryAfterMs = retryAfterFrom(body);
  if (response.status === 429 || (bodyRecord?.ok === false && retryAfterMs !== null)) {
    return { events: [], nextOffset: deps.offset, retryAfterMs: retryAfterMs ?? 5000, disabled: false };
  }
  if (!response.ok || bodyRecord?.ok !== true || !Array.isArray(bodyRecord.result)) {
    return { events: [], nextOffset: deps.offset, retryAfterMs: 5000, disabled: false };
  }

  const events: ReceiverEvent[] = [];
  let nextOffset = deps.offset;
  const refusedSenders = new Set<string>();
  for (const rawUpdate of bodyRecord.result as TelegramUpdate[]) {
    const updateRecord = record(rawUpdate);
    const updateId = updateRecord?.update_id;
    if (!updateRecord || typeof updateId !== "number" || !Number.isInteger(updateId)) continue;
    nextOffset = Math.max(nextOffset, updateId + 1);

    const message = record(updateRecord.message);
    if (!message) {
      events.push({ kind: "ignored", updateId, why: "no-message" });
      continue;
    }
    const from = record(message.from);
    if (!from || typeof from.id !== "number" || !Number.isFinite(from.id)) {
      events.push({ kind: "ignored", updateId, why: "no-sender" });
      continue;
    }
    const senderId = String(from.id);
    if (from.is_bot === true) {
      events.push({ kind: "ignored", updateId, why: "bot" });
      continue;
    }
    if (typeof message.text !== "string") {
      events.push({ kind: "ignored", updateId, why: "not-text" });
      continue;
    }

    const chat = record(message.chat);
    const chatId = typeof chat?.id === "number" || typeof chat?.id === "string" ? String(chat.id) : "";
    const isGroup = chat?.type !== "private";
    const code = isGroup ? null : pairCode(message.text);
    if (code && chatId) {
      try {
        const result = await deps.redeem({ code, externalId: senderId, source: `telegram:${senderId}` });
        if (result.ok) {
          deps.onBinding(result.binding);
          events.push({ kind: "paired", updateId, senderId, personId: result.binding.personId });
          await sendQuietly(deps.send, chatId, "Connected. You can now message the companion here.");
        } else {
          events.push({ kind: "pair-failed", updateId, reason: result.reason });
          await sendQuietly(deps.send, chatId, "That code did not work. Ask for a new pairing code.");
        }
      } catch {
        events.push({ kind: "pair-failed", updateId, reason: "invalid" });
        await sendQuietly(deps.send, chatId, "That code did not work. Ask for a new pairing code.");
      }
      continue;
    }

    let decision: InboundDecision;
    try {
      decision = decideInbound(deps.bindings(), { senderId, isGroup });
    } catch {
      decision = decideInbound([], { senderId, isGroup });
    }
    events.push({ kind: "decision", updateId, senderId, chatId, decision, text: message.text });
    if (decision.speaker === "unknown" && !isGroup && chatId && !refusedSenders.has(senderId)) {
      refusedSenders.add(senderId);
      await sendQuietly(deps.send, chatId, "This chat is not connected to a household member. Ask them for a pairing code, then send: /pair CODE");
    }
  }

  return { events, nextOffset, retryAfterMs: null, disabled: false };
}

export const defaultTelegramReceiverSend = sendTelegramMessage;

export interface TurnMessageRef { id: string; role: string; turnId?: string }

export function chatTurnHref(conversationId: string, turnId: string, role: "user" | "assistant" = "assistant"): string {
  const query = new URLSearchParams({ conversation: conversationId, turn: turnId, ...(role === "user" ? { message: role } : {}) });
  return `/chat?${query.toString()}`;
}

export function messageForTurn(messages: readonly TurnMessageRef[], turnId: string, role: "user" | "assistant"): string | null {
  return messages.find((message) => message.role === role && message.turnId === turnId)?.id ?? null;
}

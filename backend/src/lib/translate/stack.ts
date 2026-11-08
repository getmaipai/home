import type { Completer } from "./core";

// The Stack-only pieces, free of the hub's "@/" imports so repo scripts can use them.
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** A fetch that refuses every host but the Stack. */
export function stackOnlyFetch(stackUrl: string, inner: Fetch = fetch): Fetch {
  const host = new URL(stackUrl).host;
  return (url, init) => {
    if (new URL(url).host !== host) throw new Error(`Refusing a request to ${new URL(url).host}: only the Stack is allowed.`);
    return inner(url, init);
  };
}

export async function chatReady(stack: string, doFetch: Fetch): Promise<boolean> {
  try {
    const res = await doFetch(`${stack}/stack/v1/roles`);
    if (!res.ok) return false;
    const body = (await res.json()) as { roles?: Array<{ id: string; state?: { state?: string } }> };
    return body.roles?.find((role) => role.id === "chat")?.state?.state === "ready";
  } catch { return false; }
}

export class StackNotReadyError extends Error {
  constructor() { super("Stack chat is not ready; nothing more was translated. Try again when chat is ready."); this.name = "StackNotReadyError"; }
}

export function stackCompleter(stack: string, doFetch: Fetch): Completer {
  return async (messages) => {
    if (!(await chatReady(stack, doFetch))) throw new StackNotReadyError();
    const res = await doFetch(`${stack}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "chat", stream: false, messages }) });
    if (!res.ok) throw new Error(`Stack chat answered ${res.status}`);
    const content = ((await res.json()) as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content ?? "";
    return { ok: true, text: content };
  };
}

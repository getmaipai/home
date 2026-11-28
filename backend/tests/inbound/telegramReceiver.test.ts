import { describe, expect, test } from "bun:test";
import { pollOnce, type ReceiverDeps } from "@/lib/inbound/telegramReceiver";
import type { Binding } from "@/lib/inbound/decide";

const TOKEN = "123456:super-secret-token";
const strangerReply = "This chat is not connected to a household member. Ask them for a pairing code, then send: /pair CODE";

type Update = { update_id: number; message?: Record<string, unknown> };

function update(updateId: number, message: Record<string, unknown> | undefined): Update {
  return { update_id: updateId, ...(message ? { message } : {}) };
}

function msg(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    from: { id: 42, is_bot: false },
    chat: { id: 42, type: "private" },
    text: "hello",
    ...overrides,
  };
}

function harness(updates: Update[] = [], overrides: Partial<ReceiverDeps> = {}) {
  const fetchCalls: Array<{ url: string; init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal } }> = [];
  const replies: Array<{ chatId: string; text: string }> = [];
  const bound: Binding[] = [];
  let decideBindingsCalls = 0;
  const deps: ReceiverDeps = {
    enabled: () => true,
    token: () => TOKEN,
    fetchFn: async (url, init) => {
      fetchCalls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ ok: true, result: updates }) };
    },
    bindings: () => {
      decideBindingsCalls++;
      return [];
    },
    redeem: () => ({ ok: false, reason: "invalid" }),
    send: async (chatId, text) => {
      replies.push({ chatId, text });
      return true;
    },
    onBinding: (binding) => bound.push(binding),
    offset: 10,
    ...overrides,
  };
  return { deps, fetchCalls, replies, bound, get decideBindingsCalls() { return decideBindingsCalls; } };
}

describe("Telegram inbound receiver", () => {
  test("disabled and no-token states make no fetch calls", async () => {
    const disabled = harness([], { enabled: () => false });
    expect(await pollOnce(disabled.deps)).toEqual({ events: [], nextOffset: 10, retryAfterMs: null, disabled: true });
    expect(disabled.fetchCalls).toHaveLength(0);

    const noToken = harness([], { token: () => undefined });
    expect(await pollOnce(noToken.deps)).toEqual({ events: [], nextOffset: 10, retryAfterMs: null, disabled: true });
    expect(noToken.fetchCalls).toHaveLength(0);
  });

  test("429 honors retry_after and preserves offset", async () => {
    const h = harness([], { fetchFn: async () => ({ ok: false, status: 429, json: async () => ({ ok: false, parameters: { retry_after: 7 } }) }) });
    expect(await pollOnce(h.deps)).toEqual({ events: [], nextOffset: 10, retryAfterMs: 7000, disabled: false });
  });

  test("body retry_after is honored and capped", async () => {
    const h = harness([], { fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ ok: false, parameters: { retry_after: 900 } }) }) });
    expect(await pollOnce(h.deps)).toEqual({ events: [], nextOffset: 10, retryAfterMs: 300000, disabled: false });
  });

  test("thrown fetch returns retry and does not throw", async () => {
    const h = harness([], { fetchFn: async () => { throw new Error(`failed ${TOKEN}`); } });
    await expect(pollOnce(h.deps)).resolves.toEqual({ events: [], nextOffset: 10, retryAfterMs: 5000, disabled: false });
  });

  test("uses long-poll request with timeout signal", async () => {
    const h = harness();
    await pollOnce(h.deps);
    expect(h.fetchCalls).toHaveLength(1);
    expect(h.fetchCalls[0]?.url).toBe(`https://api.telegram.org/bot${TOKEN}/getUpdates`);
    expect(h.fetchCalls[0]?.init.method).toBe("POST");
    expect(JSON.parse(h.fetchCalls[0]!.init.body)).toEqual({ offset: 10, timeout: 25, allowed_updates: ["message"] });
    expect(h.fetchCalls[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  test("extracts numeric sender ids and ignores string ids", async () => {
    const h = harness([update(11, msg()), update(12, msg({ from: { id: "42", is_bot: false } }))]);
    const result = await pollOnce(h.deps);
    expect(result.events).toHaveLength(2);
    expect(result.events[0]).toMatchObject({ kind: "decision", senderId: "42", decision: { reason: "no-binding" } });
    expect(result.events[1]).toEqual({ kind: "ignored", updateId: 12, why: "no-sender" });
  });

  test("ignores bots, non-text messages, and messages without a sender", async () => {
    const h = harness([
      update(11, msg({ from: { id: 7, is_bot: true } })),
      update(12, msg({ text: undefined })),
      update(13, msg({ from: undefined })),
    ]);
    const result = await pollOnce(h.deps);
    expect(result.events).toEqual([
      { kind: "ignored", updateId: 11, why: "bot" },
      { kind: "ignored", updateId: 12, why: "not-text" },
      { kind: "ignored", updateId: 13, why: "no-sender" },
    ]);
  });

  test("group message is an unknown group decision and gets no reply", async () => {
    const h = harness([update(11, msg({ chat: { id: -2, type: "supergroup" } }))]);
    const result = await pollOnce(h.deps);
    expect(result.events[0]).toMatchObject({ kind: "decision", decision: { speaker: "unknown", reason: "group" } });
    expect(h.replies).toHaveLength(0);
  });

  test("private stranger gets one plain refusal reply per sender", async () => {
    const h = harness([update(11, msg()), update(12, msg({ text: "again" }))]);
    const result = await pollOnce(h.deps);
    expect(result.events.filter((event) => event.kind === "decision")).toHaveLength(2);
    expect(h.replies).toEqual([{ chatId: "42", text: strangerReply }]);
  });

  test("successful private pairing binds numeric sender and skips decision", async () => {
    const paired: Binding = { externalId: "42", personId: "person-1", band: "adult", capabilities: ["search"] };
    const h = harness([update(11, msg({ text: "/pair ABC123" }))], {
      redeem: (input) => {
        expect(input).toEqual({ code: "ABC123", externalId: "42", source: "telegram:42" });
        return { ok: true, binding: paired };
      },
    });
    const result = await pollOnce(h.deps);
    expect(result.events).toEqual([{ kind: "paired", updateId: 11, senderId: "42", personId: "person-1" }]);
    expect(h.bound).toEqual([paired]);
    expect(h.decideBindingsCalls).toBe(0);
    expect(h.replies).toEqual([{ chatId: "42", text: "Connected. You can now message the companion here." }]);
  });

  test("pair command in a group is an ordinary decision", async () => {
    const h = harness([update(11, msg({ chat: { id: -2, type: "group" }, text: "/pair ABC123" }))]);
    const result = await pollOnce(h.deps);
    expect(result.events[0]).toMatchObject({ kind: "decision", decision: { reason: "group" } });
    expect(h.replies).toHaveLength(0);
  });

  test("failed pairing emits reason and plain refusal", async () => {
    const h = harness([update(11, msg({ text: "/start ABC123" }))], {
      redeem: () => ({ ok: false, reason: "expired" }),
    });
    expect((await pollOnce(h.deps)).events).toEqual([{ kind: "pair-failed", updateId: 11, reason: "expired" }]);
    expect(h.replies).toEqual([{ chatId: "42", text: "That code did not work. Ask for a new pairing code." }]);
  });

  test("advances offset past the highest update including ignored updates", async () => {
    const h = harness([update(16, undefined), update(19, msg({ from: { id: "bad" } })), update(14, msg())]);
    expect((await pollOnce(h.deps)).nextOffset).toBe(20);
  });

  test("never exposes token in events or errors", async () => {
    const h = harness([update(11, msg({ text: "hello" }))]);
    const result = await pollOnce(h.deps);
    expect(JSON.stringify(result.events)).not.toContain(TOKEN);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });
});

import { completeBackground, completeViaStackRequest, type BackgroundResult, type LlmCompleteOptions, type LlmMessage } from "@/lib/llm";

export type JudgeFallbackResult = { ok: true; text: string; via: "judge" | "chat" } | { ok: false; unavailable: true; failureKind: string; tried: ["judge", "chat"] };
export type JudgeCompleter = (messages: LlmMessage[], options?: LlmCompleteOptions) => Promise<BackgroundResult>;

function failureKind(error: unknown): string {
  return error && typeof error === "object" && "failureKind" in error && typeof error.failureKind === "string" ? error.failureKind : "unavailable";
}
async function bounded<T>(work: Promise<T>, ms: number, onTimeout: () => void): Promise<{ value: T } | { timeout: true }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work.then((value) => ({ value } as const), () => ({ timeout: true as const })), new Promise<{ timeout: true }>((resolve) => { timer = setTimeout(() => { onTimeout(); resolve({ timeout: true }); }, ms); })]);
  } finally { if (timer) clearTimeout(timer); }
}

/** Try the low-priority judge, then the existing chat-role Stack path once. */
export async function completeWithFallback(messages: LlmMessage[], options: LlmCompleteOptions = {}, opts: { completeJudge?: JudgeCompleter; completeChat?: typeof completeViaStackRequest; judgeTimeoutMs?: number; chatTimeoutMs?: number } = {}): Promise<JudgeFallbackResult> {
  let kind = "unavailable";
  const judgeController = new AbortController();
  const judgeTimeout = opts.judgeTimeoutMs ?? 25_000;
  const judgeWork = Promise.resolve().then(() => (opts.completeJudge ?? completeBackground)(messages, { ...options, timeoutMs: judgeTimeout, signal: judgeController.signal }));
  const judge = await bounded(judgeWork, judgeTimeout, () => judgeController.abort());
  if ("value" in judge && judge.value?.ok) return { ok: true, text: judge.value.text, via: "judge" };
  if ("value" in judge) kind = failureKind(judge.value);
  else kind = "timeout";

  console.log(`judge.fallback via=chat reason=${kind}`);
  const chatController = new AbortController();
  const chatTimeout = opts.chatTimeoutMs ?? 30_000;
  try {
    const work = (opts.completeChat ?? completeViaStackRequest)("chat", { model: "chat", messages, ...options, thinking: false, dropReasoning: true }, chatController.signal, { exactCeiling: options.exactCeiling });
    const chat = await bounded(work, chatTimeout, () => chatController.abort());
    if ("value" in chat && chat.value.ok) {
      const body = chat.value.data as { choices?: Array<{ message?: { content?: unknown } }> };
      const text = body.choices?.[0]?.message?.content;
      if (typeof text === "string") return { ok: true, text, via: "chat" };
      kind = "no_content";
    } else if ("timeout" in chat) kind = "timeout";
    else if (!chat.value.ok) kind = chat.value.failure.reason ?? chat.value.failure.failureKind ?? "unavailable";
  } catch (error) { kind = failureKind(error); }
  return { ok: false, unavailable: true, failureKind: kind, tried: ["judge", "chat"] };
}

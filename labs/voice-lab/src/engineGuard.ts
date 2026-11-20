// Makes sure the chat engine (llama-server on 9921) is up and warm before a baseline run, so a guard-stopped engine is "waiting: memory", never a check failure.
export interface ChatDeps { health(): Promise<boolean>; start(): Promise<void>; warm(): Promise<void>; sleep(ms: number): Promise<void>; nice?(): Promise<number>; log(o: object): void; waitMs?: number }
export async function ensureChat(d: ChatDeps): Promise<"ready" | "waiting-memory" | "bad-priority"> {
  if (!(await d.health())) {
    // an engine started from a process at nice 5 (a zsh background job) inherits it and cannot be raised back: refuse, never start a slow engine
    const n = d.nice ? await d.nice() : 0; if (n !== 0) { d.log({ event: "bad-priority", nice: n }); return "bad-priority"; }
    d.log({ event: "chat-down" }); await d.start();
    const until = (d.waitMs ?? 240_000) / 2000; let ok = false;
    for (let i = 0; i < until; i++) { if (await d.health()) { ok = true; break; } await d.sleep(2000); }
    if (!ok) { d.log({ event: "waiting: memory" }); return "waiting-memory"; }
    d.log({ event: "chat-started" });
  }
  try { await d.warm(); } catch { d.log({ event: "warmup-failed" }); }
  return (await d.health()) ? "ready" : (d.log({ event: "waiting: memory" }), "waiting-memory");
}

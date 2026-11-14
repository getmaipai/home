/** Volatile one-shot voice-match results. Neither audio nor match details leave process memory. */
export type VoiceMatchVerdict = "agree" | "disagree";
type Entry = { expiresAt: number; pending: Promise<VoiceMatchVerdict | null>; consumed: boolean };
const entries = new Map<string, Entry>();
const TTL_MS = 30_000;

export function voiceMatchSessionKey(sessionId: string, personId: string): string { return `${sessionId}:${personId}`; }

export function setVoiceMatchVerdict(sessionKey: string, result: Promise<VoiceMatchVerdict | null>, now = Date.now()): void {
  entries.set(sessionKey, { expiresAt: now + TTL_MS, pending: result, consumed: false });
  void result.finally(() => {
    const current = entries.get(sessionKey);
    if (current?.expiresAt === now + TTL_MS && current.consumed) entries.delete(sessionKey);
  });
}

/** Consume once, allowing a bounded wait for an embedding already in flight. */
export async function consumeVoiceMatchVerdict(sessionKey: string, waitMs = 500, now = Date.now()): Promise<VoiceMatchVerdict | null> {
  const entry = entries.get(sessionKey);
  if (!entry || entry.expiresAt <= now || entry.consumed) {
    if (entry?.expiresAt && entry.expiresAt <= now) entries.delete(sessionKey);
    return null;
  }
  entry.consumed = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), waitMs); });
  const result = await Promise.race([entry.pending, timeout]);
  if (timer) clearTimeout(timer);
  if (entries.get(sessionKey) === entry) entries.delete(sessionKey);
  return result;
}

export function clearVoiceMatchVerdictsForTests(): void { entries.clear(); }

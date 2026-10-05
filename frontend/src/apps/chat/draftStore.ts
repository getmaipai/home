export type ChatDraft = { text: string; savedAt: string };
export const DRAFT_DELAY_MS = 400;
const key = (id: string) => `maipai:chat-draft:${id}`;

export function readDraft(id: string | undefined): ChatDraft | null {
  if (!id) return null;
  try {
    const raw = window.localStorage.getItem(key(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ChatDraft>;
    return typeof parsed.text === "string" && parsed.text.length > 0
      ? { text: parsed.text, savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : new Date().toISOString() }
      : null;
  } catch { return null; }
}

export function saveDraft(id: string | undefined, text: string): void {
  if (!id) return;
  try {
    if (text.trim()) window.localStorage.setItem(key(id), JSON.stringify({ text, savedAt: new Date().toISOString() }));
    else window.localStorage.removeItem(key(id));
  } catch { /* Blocked storage must not interrupt typing. */ }
}

export function discardDraft(id: string | undefined): void {
  if (!id) return;
  try { window.localStorage.removeItem(key(id)); } catch { /* Storage is optional. */ }
}

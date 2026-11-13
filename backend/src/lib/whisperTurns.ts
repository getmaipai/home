// WHISPER-01: which replies the model marked as whispered. The turn machine notes the turn when it hides the tag from the written reply;
// the speech route asks per sentence. Kept in memory and bounded: a restart only means a reply in flight is spoken normally.
const MAX_TURNS = 200;
const TTL_MS = 60 * 60_000;
const turns = new Map<string, number>();

export function markWhisperTurn(turnId: string | undefined): void {
  if (!turnId) return;
  turns.delete(turnId);
  turns.set(turnId, Date.now());
  while (turns.size > MAX_TURNS) turns.delete(turns.keys().next().value as string);
}

export function isWhisperTurn(turnId: string | undefined): boolean {
  if (!turnId) return false;
  const at = turns.get(turnId);
  if (at === undefined) return false;
  if (Date.now() - at > TTL_MS) { turns.delete(turnId); return false; }
  return true;
}

export function __resetWhisperTurnsForTests(): void {
  turns.clear();
  modes.clear();
}

// The mode: "whisper from now on" holds for the rest of the conversation. The model cannot be trusted to remember a tag (its earlier replies are
// stored without it), so Home keeps the state: a whispered reply turns it on, `[normal voice]` turns it off, and two quiet hours end it.
const MODE_TTL_MS = 2 * 60 * 60_000;
const MAX_MODES = 200;
const modes = new Map<string, number>();
const modeKey = (ownerId: string, conversationId: string) => `${ownerId}:${conversationId}`;

export function setWhisperMode(ownerId: string | undefined, conversationId: string | undefined, on: boolean): void {
  if (!ownerId || !conversationId) return;
  const key = modeKey(ownerId, conversationId);
  modes.delete(key);
  if (!on) return;
  modes.set(key, Date.now());
  while (modes.size > MAX_MODES) modes.delete(modes.keys().next().value as string);
}

export function isWhisperMode(ownerId: string | undefined, conversationId: string | undefined): boolean {
  if (!ownerId || !conversationId) return false;
  const key = modeKey(ownerId, conversationId);
  const at = modes.get(key);
  if (at === undefined) return false;
  if (Date.now() - at > MODE_TTL_MS) { modes.delete(key); return false; }
  return true;
}

/** A reply carried the whisper tag, or the end-whisper tag: note it for this turn and for the conversation. */
export function noteWhisperTag(kind: "whisper" | "normal", turnId: string | undefined, ownerId: string | undefined, conversationId: string | undefined): void {
  if (kind === "whisper") { markWhisperTurn(turnId); setWhisperMode(ownerId, conversationId, true); return; }
  if (turnId) turns.delete(turnId);
  setWhisperMode(ownerId, conversationId, false);
}

const TAG = /\[\s*(whisper|whispers|whispering|whispered|normal voice|speaking normally|stop whispering)\s*\]/i;
const MAY_BECOME_TAG = /\[[A-Za-z ]{0,18}$/;

/** WHISPER-01: the streamed reply must never show the tag, and the first sentence is spoken before the turn finishes, so the tag is noted and
 * hidden here, as the text streams. A tag split across two chunks ("[whis" then "pering]") is held until it is whole. */
export function createWhisperDeltaFilter(onTag: (kind: "whisper" | "normal") => void): { feed(text: string): string; flush(): string } {
  let pending = "";
  let emitted = false;
  const clean = (text: string): string => {
    let out = text;
    for (;;) {
      const m = TAG.exec(out);
      if (!m) return out;
      onTag(/^(?:whisper|whispers|whispering|whispered)$/i.test(m[1]!) ? "whisper" : "normal");
      const before = out.slice(0, m.index), after = out.slice(m.index + m[0].length);
      // Drop the space after the tag, and the space before it when nothing has been shown yet.
      out = (emitted || before ? before : "") + after.replace(/^ /, "");
      if (!emitted && !before) out = out.replace(/^\s+/, "");
    }
  };
  return {
    feed(text) {
      const joined = pending + text;
      const held = MAY_BECOME_TAG.exec(joined);
      pending = held ? held[0] : "";
      const out = clean(held ? joined.slice(0, held.index) : joined);
      if (out) emitted = true;
      return out;
    },
    flush() {
      const rest = clean(pending);
      pending = "";
      if (rest) emitted = true;
      return rest;
    },
  };
}

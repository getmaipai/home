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
}

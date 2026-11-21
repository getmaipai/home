const MAX_VOICE_INTERRUPTED_TURNS = 50;
const voiceInterruptedTurns = new Set<string>();

export function markVoiceInterrupted(turnId: string): void {
  voiceInterruptedTurns.delete(turnId);
  voiceInterruptedTurns.add(turnId);
  if (voiceInterruptedTurns.size > MAX_VOICE_INTERRUPTED_TURNS) {
    const oldestTurnId = voiceInterruptedTurns.values().next().value;
    if (oldestTurnId !== undefined) voiceInterruptedTurns.delete(oldestTurnId);
  }
}

export function wasVoiceInterrupted(turnId: string): boolean {
  return voiceInterruptedTurns.has(turnId);
}

export function resetVoiceInterruptedTurns(): void {
  voiceInterruptedTurns.clear();
}

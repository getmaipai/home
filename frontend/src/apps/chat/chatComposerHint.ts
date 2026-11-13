// ONE-COMPOSER-2026-11-13 (COMPOSER-04): what the person picked in the chat composer (a mode and its chip values), kept for the one send that
// follows. A plain module-scope store, the shape chatEditSupersedes.ts uses: the composer (ChatThread) writes it as the person picks, the model
// adapter reads it once per send with `consumeComposerHint()`, and the read puts the composer back on plain chat (single shot; the mode is a
// hint for one message, never a route and never kept). The hub checks every value again against the person's band; nothing here is logged.
import type { TurnComposer } from "@maipai/spec/gen/ts/turn-composer.js";

export const ASK_MODE = "ask";

let mode = ASK_MODE;
let hint: TurnComposer | null = null;
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };

export function subscribeComposerMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function pickedComposerMode(): string { return mode; }

/** The composer reports its current pick. `ask` carries no hint. */
export function setComposerPick(nextMode: string, settings: Record<string, string | number>): void {
  const changed = nextMode !== mode;
  mode = nextMode;
  hint = nextMode === ASK_MODE ? null : { mode: nextMode, settings };
  if (changed) notify();
}

/** The mode alone, set from outside the composer (back to chat after a send). */
export function resetComposerMode(): void {
  const changed = mode !== ASK_MODE;
  mode = ASK_MODE;
  hint = null;
  if (changed) notify();
}

/** Read once by the model adapter on the first attempt of a send; puts the composer back on chat. */
export function consumeComposerHint(): TurnComposer | undefined {
  const value = hint ?? undefined;
  resetComposerMode();
  return value;
}

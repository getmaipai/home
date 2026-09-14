import { useAuiState } from "@assistant-ui/react";

/** backend/src/wire.ts's `TurnStreamEvent` doesn't have a `status` member
 * yet (CHAT-16, Session A: a typed source, then websearch through the
 * household's SearXNG, before the engine answers) - forward-compatible
 * narrow cast, the same shape lane 10 used for `sources` on `TurnValue`
 * (chatCitations.ts's own `TurnWithSources`), gone the moment the real
 * member lands on `TurnStreamEvent` itself. */
export type TurnStatusEvent = { type: "status"; text: string; stage: "lookup" | "thinking" | "tool" };

/** Lane 11 item 1's own design decision (docs/dev/session-b.md): a
 * `status` event and a `spoken_cue` event both drive this SAME transient
 * line, not two separate ones - the comment chatModelAdapter.ts already
 * carried on `spoken_cue` says a visible indicator matters most for
 * someone without audio, which is exactly the person a silent `status`
 * event alone would otherwise miss too. Read by thread.aui.tsx off a
 * live message's `metadata.custom`, the same bag `TurnWithSources`
 * reads; never present on a reloaded row (chatHistoryAdapter.ts has no
 * source for it - `status`/`spoken_cue` are stream-only events, never
 * part of a persisted turn), so a message that has finished streaming
 * or was loaded from history never carries this field at all. */
export type TurnActivity = { activity?: string };

/** Rendered per assistant message (thread.aui.tsx's "indicator" case -
 * the kit's own existing pending affordance, no new spinner invented):
 * `undefined` for every message except one currently mid-stream with a
 * `status`/`spoken_cue` shown and no delta or terminal event since. */
export function useTurnActivity(): string | undefined {
  return useAuiState((s) => (s.message.metadata?.custom as TurnActivity | undefined)?.activity);
}

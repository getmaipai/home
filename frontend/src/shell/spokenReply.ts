import { useEffect, useRef, useState } from "react";
import type { SentenceSpeechScheduler } from "@/lib/sentenceSpeechScheduler";
import { assistantText } from "@/apps/chat/useCompanionSignals";

const TICK_MS = 120;

export { heardText } from "@/lib/speechReveal";
import { heardText } from "@/lib/speechReveal";

type SpokenMessage = { id?: unknown; role?: unknown };

/**
 * What the pane shows for each companion reply that is or was spoken: only the words said so far while the voice is still going, and the
 * words said plus an ellipsis whenever the voice is paused or the person cut in. Replies that were not spoken, or that played to the end, are not listed (full text).
 * `speaking` is whether replies are read aloud right now (a call, or read-aloud with working voice output).
 */
export function useSpokenReply(messages: SpokenMessage[], scheduler: SentenceSpeechScheduler | null, speaking: boolean): Map<string, string> {
  const [, setTick] = useState(0);
  const cutRef = useRef(new Map<string, number>());
  const trackedRef = useRef<{ scheduler: SentenceSpeechScheduler; id: string } | null>(null);

  const tracked = trackedRef.current;
  if (tracked && tracked.scheduler !== scheduler && tracked.scheduler.wasCutOff()) cutRef.current.set(tracked.id, tracked.scheduler.heardVisibleEndFine());
  const currentId = scheduler?.messageId;
  trackedRef.current = scheduler && currentId ? { scheduler, id: currentId } : null;
  if (scheduler && currentId && scheduler.wasCutOff()) cutRef.current.set(currentId, scheduler.heardVisibleEndFine());

  const live = Boolean(speaking && scheduler && currentId && !scheduler.wasCutOff() && !scheduler.hasEndedNaturally());
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => clearInterval(timer);
  }, [live]);

  const result = new Map<string, string>();
  for (const message of messages) {
    const id = String(message.id);
    const full = assistantText(message as never);
    if (message.role !== "assistant" || !full) continue;
    const heard = cutRef.current.get(id);
    if (heard !== undefined) result.set(id, heardText(full, heard, true));
    else if (live && id === currentId && scheduler) result.set(id, heardText(full, scheduler.heardVisibleEndFine(), scheduler.isPaused()));
  }
  return result;
}

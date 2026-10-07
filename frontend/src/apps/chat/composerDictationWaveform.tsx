"use client";

// VOICE-LIVE-04: while dictation records, the composer's own text field
// gives way to the shipped ComposerVoiceLevels Element, fed by the live
// microphone analyser. Mounted as ChatPage.tsx's own
// `ComposerInputOverride` (VOICE-LIVE-04b, ui-v0.5.40 - the vendored
// kit's own slot cut for exactly this, `elements/thread.aui.tsx`'s own
// Composer; /chat's real composer lives there, never in this
// repo's own apps/chat/thread.aui.tsx).
//
// The row's own first plan named `react-audio-visualize`'s
// `LiveAudioVisualizer` for this - verified broken instead (docs/dev.md,
// VOICE-LIVE-04): a bare import crashes under this stack's React 19 (its
// bundled dev-mode `react-jsx-runtime` shim reads an internals shape
// React 19 removed), and the package has had no release since 2024-09 to
// fix it. Named as a gap, this uses the platform standard's own fallback
// instead: `sttDictationAdapter.ts` builds the meter over the exact stream
// its own real capture pipeline already opened, and this slot reads it on
// the same 60ms interval as before. There is no second getUserMedia call.
import { createContext, useContext, useEffect, useState } from "react";
import { useAuiState } from "@assistant-ui/react";
import { ComposerInputField } from "@maipai/ui/src/elements/thread.aui";
import { ComposerVoiceLevels } from "@maipai/ui/src/elements/composer-voice.aui";
import { DraftRestore } from "@maipai/ui/src/elements/draft-restore";
import type { LevelMeter } from "@/lib/voice/audioLevelMeter";
import { ChatAvailabilityContext } from "@/apps/chat/useChatAvailability";
import { useComposerDraftRestore } from "@/apps/chat/composerDraftRestore";
import { PageContext } from "@/shell/pages/chatProjectPageContext";

const DictationLevelMeterContext = createContext<LevelMeter | null>(null);

export const DictationLevelMeterProvider = DictationLevelMeterContext.Provider;

const POLL_MS = 60;
const LEVEL_COUNT = 24;

/** Mounted as the vendored kit's own `ComposerInputOverride` slot
 * (`@maipai/ui/src/elements/thread.aui`, ui-v0.5.40) - that slot, once
 * set, fully replaces `ComposerPrimitive.Input` and never falls back to
 * one on its own (found live: VOICE-LIVE-04b's own first draft of this
 * component rendered only the waveform, unconditionally, which broke
 * ordinary typing everywhere the override was wired, since nothing was
 * left to render a real text field once dictation ended). So this
 * component owns BOTH states itself: `s.composer.dictation != null` (the
 * same condition the kit's own Composer already uses to swap the mic
 * button to Stop) picks the waveform or a real `ComposerPrimitive.Input`,
 * styled identically to the kit's own default so normal typing looks
 * unchanged. The kit's ComposerVoiceLevels owns the recording presentation;
 * analyser readings appear once `sttDictationAdapter.ts`'s `onLevelMeter`
 * hands this slot a real meter (the brief socket handshake before the
 * server's own "ready"). */
export function ComposerDictationWaveform() {
  const dictating = useAuiState((s) => s.composer.dictation != null);
  const projectPage = useContext(PageContext);
  const meter = useContext(DictationLevelMeterContext);
  const held = useContext(ChatAvailabilityContext) !== "ready";
  const draftRestore = useComposerDraftRestore();
  const [levels, setLevels] = useState<number[]>(() => Array(LEVEL_COUNT).fill(0));
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!dictating) {
      setSeconds(0);
      return;
    }
    const startedAt = Date.now();
    setSeconds(0);
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1_000)), 1_000);
    return () => clearInterval(timer);
  }, [dictating]);

  useEffect(() => {
    // Gated on `dictating` too, not just `meter` - a review caught this:
    // the real Input branch below never reads `levels` at all, so
    // polling on regardless just did pointless work (and state updates)
    // on a component currently showing plain text, every time dictation
    // ended but the previous meter reference hadn't changed identity yet.
    if (!dictating || !meter) {
      setLevels(Array(LEVEL_COUNT).fill(0));
      return;
    }
    const timer = setInterval(() => {
      setLevels((prev) => [...prev.slice(1), meter.read()]);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [dictating, meter]);

  // The kit's compact composer (Thread `composerDensity`) owns the single-row
  // versus wrapped layout and marks its own shell when the text wraps.
  const input = !dictating ? (
    <ComposerInputField
      // CHAT-CALM-ERRORS-01d (design section 7): the field stays usable
      // while chat is paused or starting so a thought is not lost; the kit
      // holds Send (Thread `sendHeld`, ChatThread.tsx) and Enter sends
      // nothing here. Why it waits is the composer line's job, so the
      // placeholder stays the plain one.
      placeholder={projectPage ? `New chat in ${projectPage.folderName ?? "this project"}` : "Send a message..."}
      submitMode={held ? "none" : undefined}
      onKeyDown={held ? (event) => { if (event.key === "Enter" && !event.shiftKey) event.preventDefault(); } : undefined}
    />
  ) : <ComposerVoiceLevels levels={levels} recording={dictating} seconds={seconds} role="status" aria-label="Listening" />;
  return (
    <>
      {draftRestore ? <DraftRestore {...draftRestore} /> : null}
      {input}
    </>
  );
}

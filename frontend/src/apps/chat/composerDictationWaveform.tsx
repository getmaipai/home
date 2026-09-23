"use client";

// VOICE-LIVE-04: while dictation records, the composer's own text field
// gives way to a live bar waveform of the microphone (ChatGPT's own
// dictation look). Mounted as NextChatPage.tsx's own
// `ComposerInputOverride` (VOICE-LIVE-04b, ui-v0.5.40 - the vendored
// kit's own slot cut for exactly this, `elements/thread.aui.tsx`'s own
// Composer; /next/chat's real composer lives there, never in this
// repo's own apps/chat/thread.aui.tsx).
//
// The row's own first plan named `react-audio-visualize`'s
// `LiveAudioVisualizer` for this - verified broken instead (docs/dev.md,
// VOICE-LIVE-04): a bare import crashes under this stack's React 19 (its
// bundled dev-mode `react-jsx-runtime` shim reads an internals shape
// React 19 removed), and the package has had no release since 2024-09 to
// fix it. Named as a gap, this uses the platform standard's own fallback
// instead: the smallest composition of already-shipped parts - the
// native `AnalyserNode`, through `audioLevelMeter.ts`, the identical
// mechanism VOICE-LIVE-02's live voice session already proved, polled on
// the same 60ms interval that file already uses, into a short rolling
// window of recent levels drawn as bars. Never a second `getUserMedia`
// call: `sttDictationAdapter.ts` builds the meter over the exact stream
// its own real capture pipeline already opened.
import { createContext, useContext, useEffect, useState } from "react";
import { ComposerPrimitive, useAuiState } from "@assistant-ui/react";
import type { LevelMeter } from "@/lib/voice/audioLevelMeter";

const DictationLevelMeterContext = createContext<LevelMeter | null>(null);

export const DictationLevelMeterProvider = DictationLevelMeterContext.Provider;

/** Read once per mount, not watched live - `tokens.css`'s dark mode is a
 * synchronous `.dark` class swap, not a media query, so whatever is on
 * `documentElement` when a dictation session actually starts recording
 * (this component's own mount, gated by a real `LevelMeter` existing) is
 * already the real value; a theme flip mid-dictation is not a case
 * worth a MutationObserver for. */
function readColorToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const BAR_COUNT = 24;
const POLL_MS = 60;

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
 * unchanged. The bars: a sized wrapper renders immediately at the text
 * field's own height, so the swap never collapses the composer's layout;
 * the bars themselves appear a beat later, once `sttDictationAdapter.ts`'s
 * `onLevelMeter` hands this a real meter (the brief socket handshake
 * before the server's own "ready"). */
export function ComposerDictationWaveform() {
  const dictating = useAuiState((s) => s.composer.dictation != null);
  const meter = useContext(DictationLevelMeterContext);
  const [colors] = useState(() => ({ bar: readColorToken("--color-primary") || "rgb(160, 198, 255)" }));
  // A rolling window of recent levels, oldest first - each render tick
  // shifts one out and pushes the meter's current read in, the classic
  // "recent history" bar look (RECALL each bar is a time-slice, not a
  // frequency bin - a real spectrum needs its own AnalyserNode reads,
  // which is exactly what this already is, one bin at a time).
  const [levels, setLevels] = useState<number[]>(() => Array(BAR_COUNT).fill(0));
  useEffect(() => {
    // Gated on `dictating` too, not just `meter` - a review caught this:
    // the real Input branch below never reads `levels` at all, so
    // polling on regardless just did pointless work (and state updates)
    // on a component currently showing plain text, every time dictation
    // ended but the previous meter reference hadn't changed identity yet.
    if (!dictating || !meter) {
      setLevels(Array(BAR_COUNT).fill(0));
      return;
    }
    const timer = setInterval(() => {
      setLevels((prev) => [...prev.slice(1), meter.read()]);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [dictating, meter]);
  if (!dictating) {
    // The kit's own default Input, verbatim (elements/thread.aui.tsx's
    // Composer) - `autoFocus` isn't part of this zero-prop slot's own
    // shape (`ComponentType`, the same as every other ThreadComponents
    // override), so a page load's own autofocus is the one behavior this
    // trades away; every other prop matches exactly.
    return (
      <ComposerPrimitive.Input
        placeholder="Send a message..."
        // Same Tailwind utilities as the kit's own default Input - not
        // its "aui-composer-input" marker class, which has no real CSS
        // rule anywhere and only the kit's own thread.aui.tsx carries an
        // eslint exemption for that non-Tailwind naming convention.
        className="caret-primary placeholder:text-muted-foreground/60 max-h-48 min-h-10 w-full resize-none bg-transparent px-2.5 py-1 text-base leading-6 outline-none"
        rows={1}
        enterKeyHint="send"
        aria-label="Message input"
      />
    );
  }
  return (
    // w-full, not flex-1: the kit's own composer-shell is flex-col (the
    // attachments row, this input row, the action row stacked
    // vertically), so flex-1's own flex-basis: 0% fights `h-12` for the
    // vertical dimension and wins - found live, the bars' real DOM
    // values (getBoundingClientRect, not just the inline style) showed
    // this whole wrapper computing to a genuine 0px height. `w-full`
    // is the same horizontal-growth approach the kit's own Input
    // already uses in this exact spot.
    <div className="flex h-12 w-full items-center px-1">
      <span className="sr-only">Listening</span>
      <div aria-hidden="true" className="flex h-full min-w-0 flex-1 items-center gap-[2px] overflow-hidden">
        {levels.map((level, index) => (
          <div key={index} data-testid="dictation-bar" className="min-w-[3px] flex-1 rounded-full transition-[height] duration-75" style={{ height: `${Math.max(8, level * 100)}%`, backgroundColor: colors.bar }} />
        ))}
      </div>
    </div>
  );
}

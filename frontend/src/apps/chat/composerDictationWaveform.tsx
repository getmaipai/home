"use client";

// VOICE-LIVE-04: while dictation records, the composer's own text field
// gives way to a live bar waveform of the microphone (ChatGPT's own
// dictation look). The row's own first plan named `react-audio-
// visualize`'s `LiveAudioVisualizer` for this - verified broken instead
// (docs/dev.md, VOICE-LIVE-04): a bare import crashes under this
// stack's React 19 (its bundled dev-mode `react-jsx-runtime` shim reads
// an internals shape React 19 removed), and the package has had no
// release since 2024-09 to fix it. Named as a gap, this uses the
// platform standard's own fallback instead: the smallest composition of
// already-shipped parts - the native `AnalyserNode`, through
// `audioLevelMeter.ts`, the identical mechanism VOICE-LIVE-02's live
// voice session already proved, polled on the same 60ms interval that
// file already uses, into a short rolling window of recent levels drawn
// as bars. Never a second `getUserMedia` call: `sttDictationAdapter.ts`
// builds the meter over the exact stream its own real capture pipeline
// already opened.
import { createContext, useContext, useEffect, useState } from "react";
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

/** `thread.aui.tsx`'s own `Composer` swaps this in for
 * `ComposerPrimitive.Input` the moment `s.composer.dictation != null`
 * (the same condition that already swaps the mic button to Stop) - the
 * sized wrapper renders immediately, at the text field's own height, so
 * the swap never collapses the composer's layout; the bars themselves
 * appear a beat later, once `sttDictationAdapter.ts`'s `onLevelMeter`
 * hands this a real meter (the brief socket handshake before the
 * server's own "ready"). */
export function ComposerDictationWaveform() {
  const meter = useContext(DictationLevelMeterContext);
  const [colors] = useState(() => ({ bar: readColorToken("--color-primary") || "rgb(160, 198, 255)" }));
  // A rolling window of recent levels, oldest first - each render tick
  // shifts one out and pushes the meter's current read in, the classic
  // "recent history" bar look (RECALL each bar is a time-slice, not a
  // frequency bin - a real spectrum needs its own AnalyserNode reads,
  // which is exactly what this already is, one bin at a time).
  const [levels, setLevels] = useState<number[]>(() => Array(BAR_COUNT).fill(0));
  useEffect(() => {
    if (!meter) {
      setLevels(Array(BAR_COUNT).fill(0));
      return;
    }
    const timer = setInterval(() => {
      setLevels((prev) => [...prev.slice(1), meter.read()]);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [meter]);
  return (
    <div className="flex h-12 min-w-0 flex-1 items-center px-1">
      <span className="sr-only">Listening</span>
      <div aria-hidden="true" className="flex h-full min-w-0 flex-1 items-center gap-[2px] overflow-hidden">
        {levels.map((level, index) => (
          <div key={index} data-testid="dictation-bar" className="min-w-[3px] flex-1 rounded-full transition-[height] duration-75" style={{ height: `${Math.max(8, level * 100)}%`, backgroundColor: colors.bar }} />
        ))}
      </div>
    </div>
  );
}

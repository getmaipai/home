import { useCallback, useEffect, useRef, useState } from "react";
import { analyserFor } from "@/lib/media/audioGraph";

/** A getter for the live analyser of `el`, tapped when the element starts playing. The getter is polled by the visualizer each frame. */
export function useMediaAnalyser(el: HTMLMediaElement | null, enabled: boolean): () => AnalyserNode | null {
  const analyser = useRef<AnalyserNode | null>(null);
  useEffect(() => {
    analyser.current = null;
    if (!el || !enabled) return;
    const tap = () => { analyser.current ??= analyserFor(el); };
    // `timeupdate` retries a tap that was skipped because the person had not yet tapped or clicked anything (the audio context starts then).
    el.addEventListener("play", tap);
    el.addEventListener("playing", tap);
    el.addEventListener("timeupdate", tap);
    if (!el.paused) tap();
    return () => {
      el.removeEventListener("play", tap);
      el.removeEventListener("playing", tap);
      el.removeEventListener("timeupdate", tap);
      analyser.current = null;
    };
  }, [el, enabled]);
  return useCallback(() => analyser.current, []);
}

/** Whether `el` is playing right now, following its own events. */
export function useIsPlaying(el: HTMLMediaElement | null): boolean {
  const [playing, setPlaying] = useState(el ? !el.paused : false);
  useEffect(() => {
    if (!el) { setPlaying(false); return; }
    const sync = () => setPlaying(!el.paused && !el.ended);
    const events = ["play", "pause", "ended", "emptied"] as const;
    events.forEach((name) => el.addEventListener(name, sync));
    sync();
    return () => events.forEach((name) => el.removeEventListener(name, sync));
  }, [el]);
  return playing;
}

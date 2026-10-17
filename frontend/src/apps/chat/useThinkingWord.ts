import { useEffect, useState } from "react";
import { STATIC_THINKING_WORD, nextRotationDelay, pickThinkingWord } from "@/apps/chat/thinkingWords";

// The last word any turn showed, so the next turn starts on a different one.
let lastShown: string | null = null;

/** Test hook: forget the last word shown. */
export function resetThinkingWordForTests() {
  lastShown = null;
}

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
  } catch {
    return false;
  }
}

/**
 * The status word for a reasoning group. While `running` it rotates every 2.5
 * to 4 seconds, never repeating the word before it, and each turn starts on a
 * different word from the last. Under `prefers-reduced-motion` it stays on
 * "Thinking" with no timer.
 */
export function useThinkingWord(running: boolean): string {
  const [word, setWord] = useState<string>(STATIC_THINKING_WORD);
  useEffect(() => {
    if (!running) return;
    if (prefersReducedMotion()) {
      setWord(STATIC_THINKING_WORD);
      return;
    }
    let current = pickThinkingWord(lastShown);
    lastShown = current;
    setWord(current);
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        current = pickThinkingWord(current);
        lastShown = current;
        setWord(current);
        schedule();
      }, nextRotationDelay());
    };
    schedule();
    return () => clearTimeout(timer);
  }, [running]);
  return word;
}

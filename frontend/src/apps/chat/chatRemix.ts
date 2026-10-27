// Remix: change a picture or video by describing the changes, the way Sora does; the box starts empty. The tool cards are not a
// place for a dialog, so they await askRemix() and the one dialog in ChatPage answers it. The result is the original words plus
// the changes, ready for the generator. Resolves null when cancelled or when no dialog is mounted.
import { useEffect, useState } from "react";

export type RemixKind = "picture" | "video";
type Ask = { kind: RemixKind; initial: string; resolve: (words: string | null) => void };
let show: ((ask: Ask) => void) | null = null;

export function askRemix(kind: RemixKind, initial: string): Promise<string | null> {
  return new Promise((resolve) => { if (show) show({ kind, initial, resolve }); else resolve(null); });
}

export function useRemixAsk() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const [words, setWords] = useState("");
  useEffect(() => { show = (next) => { setWords(""); setAsk(next); }; return () => { show = null; }; }, []);
  const answer = (changes: string | null) => { ask?.resolve(changes ? `${ask.initial.trim()}\n\nChanges: ${changes}` : null); setAsk(null); };
  return { ask, words, setWords, answer };
}

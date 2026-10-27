// Remix: change a picture or video by editing the words that made it. The tool cards are not a place for a dialog, so they
// await askRemix() and the one dialog in ChatPage answers it. Resolves null when cancelled or when no dialog is mounted.
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
  useEffect(() => { show = (next) => { setWords(next.initial); setAsk(next); }; return () => { show = null; }; }, []);
  const answer = (result: string | null) => { ask?.resolve(result); setAsk(null); };
  return { ask, words, setWords, answer };
}

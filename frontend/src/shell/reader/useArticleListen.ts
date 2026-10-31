// READER-LISTEN: Listen on a Wikipedia article. The article is read paragraph by paragraph through the local voice route the chat uses
// (POST /api/tts, nothing leaves the home), the next paragraph fetched while the current one plays. The kit reader shows the state
// through ArticleSpeechContext: which article, whether the voice is starting, playing or paused, and how far through the text it is.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizeForSpeech } from "@maipai/spec/voice/ts/normalizeForSpeech.js";
import type { ArticleSpeech } from "@maipai/ui/src/primitives/ArticleView";
import { api, type ReferenceArticleView } from "@/lib/api";

const IDLE: ArticleSpeech = { storyId: null, phase: null, progress: 0 };
const MAX_CHARS = 6000;

/** What is read aloud: the title, the lead, then the paragraphs in order, stopping at a size a person would sit through. */
export function speakableParagraphs(article: ReferenceArticleView): string[] {
  const lines: string[] = [article.title];
  if (article.description) lines.push(`${article.title}, ${article.description}.`);
  let size = 0;
  for (const block of article.blocks) {
    if (block.type !== "paragraph") continue;
    const text = block.inlines.map((inline) => (typeof inline === "string" ? inline : inline.text)).join("").replace(/\[\d+\]/g, "").trim();
    if (text.length < 20) continue;
    lines.push(text);
    size += text.length;
    if (size >= MAX_CHARS) break;
  }
  return lines;
}

export function useArticleListen() {
  const [speech, setSpeech] = useState<ArticleSpeech>(IDLE);
  const runRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlsRef = useRef<string[]>([]);

  const stop = useCallback(() => {
    runRef.current += 1;
    abortRef.current?.abort();
    audioRef.current?.pause();
    audioRef.current = null;
    urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    urlsRef.current = [];
    setSpeech(IDLE);
  }, []);
  useEffect(() => stop, [stop]);

  const listen = useCallback((storyId: string, paragraphs: string[]) => {
    // Pressing Listen on the article already being read pauses it, and again resumes it.
    const audio = audioRef.current;
    if (audio && speech.storyId === storyId) {
      if (audio.paused) { void audio.play(); setSpeech((now) => ({ ...now, phase: "playing" })); } else { audio.pause(); setSpeech((now) => ({ ...now, phase: "paused" })); }
      return;
    }
    stop();
    const token = ++runRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    const total = Math.max(1, paragraphs.reduce((sum, line) => sum + line.length, 0));
    setSpeech({ storyId, phase: "loading", progress: 0 });
    const fetchUrl = async (line: string): Promise<string | null> => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const response = await api.streamSpeech(normalizeForSpeech(line), controller.signal);
          const url = URL.createObjectURL(await response.blob());
          urlsRef.current.push(url);
          return url;
        } catch { if (controller.signal.aborted) return null; }
      }
      return null;
    };
    void (async () => {
      let spoken = 0;
      let next = fetchUrl(paragraphs[0] ?? "");
      for (let i = 0; i < paragraphs.length; i++) {
        const url = await next;
        if (token !== runRef.current) return;
        next = i + 1 < paragraphs.length ? fetchUrl(paragraphs[i + 1]!) : Promise.resolve(null);
        const line = paragraphs[i]!;
        if (url) {
          const el = new Audio(url);
          audioRef.current = el;
          await new Promise<void>((resolve) => {
            el.onended = () => resolve();
            el.onerror = () => resolve();
            el.ontimeupdate = () => { if (token === runRef.current && el.duration > 0) setSpeech({ storyId, phase: el.paused ? "paused" : "playing", progress: Math.min(1, (spoken + line.length * (el.currentTime / el.duration)) / total) }); };
            void el.play().then(() => { if (token === runRef.current) setSpeech({ storyId, phase: "playing", progress: spoken / total }); }).catch(() => resolve());
          });
        }
        spoken += line.length;
        if (token !== runRef.current) return;
      }
      if (token === runRef.current) stop();
    })();
  }, [speech.storyId, stop]);

  return useMemo(() => ({ speech, listen, stop }), [speech, listen, stop]);
}

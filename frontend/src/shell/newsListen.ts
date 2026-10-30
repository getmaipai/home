// NEWS-04: Listen on an open article. The news-story page's `listen` action (a schema `play` with media_id "story") reaches
// MediaHostProvider.onPlay, which hands the story id here. The story is read paragraph by paragraph through the same local voice
// route the chat uses (POST /api/tts), so nothing leaves the home. The sound plays in the media host's one element, so the shell's
// mini player (GlobalMiniPlayer) shows it with play, pause, speed and close, and the audio session sees it like any other audio.
import { normalizeForSpeech } from "@maipai/spec/voice/ts/normalizeForSpeech.js";
import { api } from "@/lib/api";
import { blockText, type DiscussStory } from "@/shell/pages/NewsDiscussPage";

/** The part of the media store Listen needs. */
export interface ListenStore {
  elementFor(ref: { id: string; src: string; kind: "audio"; title: string; subtitle?: string; poster?: string }, appId: string): HTMLMediaElement;
  retarget(el: HTMLMediaElement, patch: { src?: string; subtitle?: string; title?: string; poster?: string; started?: boolean }): void;
  get(): { el: HTMLMediaElement } | null;
  clear(): void;
}

/** What the reader shows while a story is read aloud (kit `ArticleSpeechContext`): which story, whether the voice is still starting,
 * and how far through the body it has spoken (0 to 1, by characters, so the reader can light the words as they are said). */
export interface ListenStatus { storyId: string | null; phase: "loading" | "playing" | "paused" | null; progress: number }
const IDLE: ListenStatus = { storyId: null, phase: null, progress: 0 };
export function createListenStatus() {
  let value: ListenStatus = IDLE;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set(next: ListenStatus) {
      if (next.storyId === value.storyId && next.phase === value.phase && Math.abs(next.progress - value.progress) < 0.002) return;
      value = next;
      listeners.forEach((listener) => listener());
    },
    clear() { if (value !== IDLE) { value = IDLE; listeners.forEach((listener) => listener()); } },
  };
}
export type ListenStatusStore = ReturnType<typeof createListenStatus>;

export const LISTEN_APP = "news";
const STORY_PREFIX = "story:";
/** The host id a story being read aloud is held under, and the story id back out of it (null for anything else the host holds). */
export const listenIdOf = (storyId: string) => `${STORY_PREFIX}${storyId}`;
export const storyIdOfListen = (appId: string, hostId: string): string | null => (appId === LISTEN_APP && hostId.startsWith(STORY_PREFIX) ? hostId.slice(STORY_PREFIX.length) : null);
const EMPTY_AUDIO = "data:audio/wav;base64,";
export const NOTHING_TO_READ = "There is nothing to read aloud for this story yet. Open it again in a moment.";
export const LISTEN_FAILED = "Could not read this story aloud. Check the voice under Settings, then try Listen again.";

/** The speakable paragraphs of an article: the hub's own `speech` lines (already worded for the ear and gated for the viewer's age),
 * else its title and every block with words. */
export function listenParagraphs(story: DiscussStory & { speech?: string[] }): string[] {
  const spoken = (story.speech ?? []).map((line) => line.trim()).filter((line) => line.length > 0);
  if (spoken.length > 0) return spoken;
  return [story.title, ...story.blocks.map((block) => blockText(block).trim())].filter((text) => text.length > 0);
}

export const paragraphLine = (index: number, total: number) => `Paragraph ${index + 1} of ${total}`;

async function speak(text: string, signal: AbortSignal): Promise<string> {
  const response = await api.streamSpeech(normalizeForSpeech(text), signal);
  return URL.createObjectURL(await response.blob());
}

type ListenStory = DiscussStory & { speech?: string[]; sourceIconUrl?: string };

/** Reads a story in the store's element, fetching the next chunk while the current one plays. A new call replaces the old one.
 * The mini bar opens the moment Listen is pressed (title, source icon and "getting ready") and stays while the voice starts. */
export function createStoryListener(store: ListenStore, onFail: (line: string) => void, status: ListenStatusStore = createListenStatus()) {
  let run = 0;
  let abort: AbortController | null = null;
  let urls: string[] = [];
  const release = () => { urls.forEach((url) => URL.revokeObjectURL(url)); urls = []; };

  async function read(story: { id: string; title: string; paragraphs: string[] }, el: HTMLMediaElement, token: number, controller: AbortController) {
    const total = story.paragraphs.length;
    const live = () => token === run && store.get()?.el === el;
    // The first line carries the headline: the words the reader lights start after it.
    const lengths = story.paragraphs.map((line) => line.length);
    const headline = Math.min(lengths[0] ?? 0, story.title.length + 2);
    const bodyChars = Math.max(1, lengths.reduce((sum, n) => sum + n, 0) - headline);
    // One chunk that cannot be made is retried once and then skipped, so a single failure never ends the reading half way.
    const chunkUrl = async (i: number): Promise<string | null> => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try { return await speak(story.paragraphs[i]!, controller.signal); } catch { if (controller.signal.aborted) return null; }
      }
      return null;
    };
    let spoken = 0;
    let played = 0;
    try {
      let next = chunkUrl(0);
      for (let i = 0; i < total; i++) {
        const url = await next;
        if (url) urls.push(url);
        if (!live()) return;
        next = i + 1 < total ? chunkUrl(i + 1) : Promise.resolve(null);
        next.catch(() => {});
        if (!url) { spoken += lengths[i]!; continue; }
        played += 1;
        store.retarget(el, { src: url, subtitle: paragraphLine(i, total) });
        const before = spoken;
        await new Promise<void>((resolve, reject) => {
          const progress = () => {
            const length = Number.isFinite(el.duration) && el.duration > 0 ? el.currentTime / el.duration : 0;
            status.set({ storyId: story.id, phase: el.paused ? "paused" : "playing", progress: Math.min(1, Math.max(0, (before + length * lengths[i]! - headline) / bodyChars)) });
          };
          const onPlaying = () => progress();
          const onPause = () => { if (!el.ended) status.set({ storyId: story.id, phase: "paused", progress: status.get().progress }); };
          const done = () => { cleanup(); resolve(); };
          const failed = () => { cleanup(); reject(new Error("playback")); };
          const cleanup = () => {
            el.removeEventListener("ended", done);
            el.removeEventListener("error", failed);
            el.removeEventListener("timeupdate", progress);
            el.removeEventListener("playing", onPlaying);
            el.removeEventListener("pause", onPause);
          };
          el.addEventListener("ended", done);
          el.addEventListener("error", failed);
          el.addEventListener("timeupdate", progress);
          el.addEventListener("playing", onPlaying);
          el.addEventListener("pause", onPause);
          el.play().catch(failed);
        });
        spoken += lengths[i]!;
        if (!live()) return;
      }
      if (played === 0) throw new Error("nothing could be spoken");
      // The story is finished: the bar goes away like a track list that ran out.
      status.clear();
      store.clear();
    } catch {
      if (live()) { status.clear(); onFail(LISTEN_FAILED); }
    }
  }

  return {
    /** Never throws: a failure is a toast over the page (like every other media line), so the article does not move. */
    async listen(storyId: string): Promise<void> {
      const token = ++run;
      abort?.abort();
      release();
      const controller = new AbortController();
      abort = controller;
      // Shown before anything is fetched, so the press is answered at once.
      const el = store.elementFor({ id: listenIdOf(storyId), src: EMPTY_AUDIO, kind: "audio", title: "Opening the story…", subtitle: "Getting ready to read" }, LISTEN_APP);
      // The bar waits for a first sound by default; for Listen it shows now, while the voice is being made.
      store.retarget(el, { started: true });
      status.set({ storyId, phase: "loading", progress: 0 });
      const fail = (line: string) => { if (token === run) { status.clear(); store.clear(); onFail(line); } };
      try {
        const body = await api.appData<Array<{ props?: ListenStory }> | { blocks?: Array<{ props?: ListenStory }> }>("news", "story", { id: storyId });
        if (token !== run) return;
        const story = (Array.isArray(body) ? body : body.blocks ?? [])[0]?.props;
        const paragraphs = story ? listenParagraphs(story) : [];
        if (!story || paragraphs.length < 1) return fail(NOTHING_TO_READ);
        store.retarget(el, { title: story.title, subtitle: "Starting to read", ...(story.sourceIconUrl ? { poster: story.sourceIconUrl } : {}) });
        void read({ id: storyId, title: story.title, paragraphs }, el, token, controller);
      } catch {
        fail(LISTEN_FAILED);
      }
    },
    stop() { run += 1; abort?.abort(); release(); status.clear(); },
  };
}

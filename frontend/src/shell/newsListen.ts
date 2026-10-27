// NEWS-04: Listen on an open article. The news-story page's `listen` action (a schema `play` with media_id "story") reaches
// MediaHostProvider.onPlay, which hands the story id here. The story is read paragraph by paragraph through the same local voice
// route the chat uses (POST /api/tts), so nothing leaves the home. The sound plays in the media host's one element, so the shell's
// mini player (GlobalMiniPlayer) shows it with play, pause, speed and close, and the audio session sees it like any other audio.
import { normalizeForSpeech } from "@maipai/spec/voice/ts/normalizeForSpeech.js";
import { api } from "@/lib/api";
import { blockText, type DiscussStory } from "@/shell/pages/NewsDiscussPage";

/** The part of the media store Listen needs. */
export interface ListenStore {
  elementFor(ref: { id: string; src: string; kind: "audio"; title: string; subtitle?: string }, appId: string): HTMLMediaElement;
  retarget(el: HTMLMediaElement, patch: { src: string; subtitle?: string }): void;
  get(): { el: HTMLMediaElement } | null;
  clear(): void;
}

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

/** Reads `paragraphs` in the store's element, fetching the next one while the current one plays. A new call replaces the old one. */
export function createStoryListener(store: ListenStore, onFail: (line: string) => void) {
  let run = 0;
  let abort: AbortController | null = null;
  let urls: string[] = [];
  const release = () => { urls.forEach((url) => URL.revokeObjectURL(url)); urls = []; };

  async function read(story: { id: string; title: string; paragraphs: string[] }) {
    const token = ++run;
    abort?.abort();
    release();
    const controller = new AbortController();
    abort = controller;
    const total = story.paragraphs.length;
    const el = store.elementFor({ id: listenIdOf(story.id), src: EMPTY_AUDIO, kind: "audio", title: story.title, subtitle: "Starting to read" }, LISTEN_APP);
    const fetchAt = (i: number) => speak(story.paragraphs[i]!, controller.signal);
    const live = () => token === run && store.get()?.el === el;
    try {
      let next = fetchAt(0);
      for (let i = 0; i < total; i++) {
        const url = await next;
        urls.push(url);
        if (!live()) return;
        next = i + 1 < total ? fetchAt(i + 1) : Promise.resolve("");
        next.catch(() => {});
        store.retarget(el, { src: url, subtitle: paragraphLine(i, total) });
        await new Promise<void>((resolve, reject) => {
          const done = () => { cleanup(); resolve(); };
          const failed = () => { cleanup(); reject(new Error("playback")); };
          const cleanup = () => { el.removeEventListener("ended", done); el.removeEventListener("error", failed); };
          el.addEventListener("ended", done);
          el.addEventListener("error", failed);
          el.play().catch(failed);
        });
        if (!live()) return;
      }
      // The story is finished: the bar goes away like a track list that ran out.
      store.clear();
    } catch {
      if (live()) onFail(LISTEN_FAILED);
    }
  }

  return {
    async listen(storyId: string): Promise<void> {
      const body = await api.appData<Array<{ props?: DiscussStory & { speech?: string[] } }> | { blocks?: Array<{ props?: DiscussStory & { speech?: string[] } }> }>("news", "story", { id: storyId });
      const story = (Array.isArray(body) ? body : body.blocks ?? [])[0]?.props;
      const paragraphs = story ? listenParagraphs(story) : [];
      if (!story || paragraphs.length < 2) throw new Error(NOTHING_TO_READ);
      void read({ id: storyId, title: story.title, paragraphs });
    },
    stop() { run += 1; abort?.abort(); release(); },
  };
}

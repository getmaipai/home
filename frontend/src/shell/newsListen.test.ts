import { describe, expect, test } from "bun:test";
import { listenParagraphs, paragraphLine, createStoryListener, createListenStatus, NOTHING_TO_READ, LISTEN_FAILED, type ListenStore } from "@/shell/newsListen";
import { createMediaStore } from "@/shell/mediaHost";
import { api } from "@/lib/api";
import type { DiscussStory } from "@/shell/pages/NewsDiscussPage";

const paragraph = (text: string) => ({ type: "paragraph" as const, inlines: [{ type: "text" as const, text }] });
const story: DiscussStory = {
  title: "Barn fire",
  blocks: [paragraph("First."), { type: "figure", src: "/x.png", alt: "barn", caption: "A barn" }, paragraph("Second.")],
};

describe("News Listen", () => {
  test("reads the title, then every block that has words, and skips pictures", () => {
    expect(listenParagraphs(story)).toEqual(["Barn fire", "First.", "Second."]);
    expect(listenParagraphs({ ...story, speech: ["Barn fire. From Example Times.", "First."] })).toEqual(["Barn fire. From Example Times.", "First."]);
    expect(paragraphLine(0, 3)).toBe("Paragraph 1 of 3");
  });

  test("a story with no words says so instead of playing", async () => {
    const original = api.appData;
    (api as { appData: unknown }).appData = async () => [{ props: { title: "", blocks: [] } }];
    try {
      const lines: string[] = [];
      const listener = createStoryListener(createMediaStore() as never, (line) => lines.push(line));
      await listener.listen("s1");
      expect(lines).toEqual([NOTHING_TO_READ]);
    } finally {
      (api as { appData: unknown }).appData = original;
    }
  });

  test("a story with one paragraph is read, and a failed fetch is a line, never a throw", async () => {
    const original = api.appData;
    const lines: string[] = [];
    try {
      (api as { appData: unknown }).appData = async () => { throw new Error("down"); };
      await createStoryListener(createMediaStore() as never, (line) => lines.push(line)).listen("s1");
      expect(lines).toEqual([LISTEN_FAILED]);
    } finally {
      (api as { appData: unknown }).appData = original;
    }
    expect(listenParagraphs({ title: "Short", blocks: [] , speech: ["Only line."] })).toEqual(["Only line."]);
  });

  test("retarget moves the held element to the next paragraph without a new element", () => {
    const store = createMediaStore();
    const el = store.elementFor({ id: "story:s1", src: "data:audio/wav;base64,", kind: "audio", title: "Barn fire" }, "news");
    store.retarget(el, { src: "blob:one", subtitle: paragraphLine(0, 2) });
    expect(store.get()?.el).toBe(el);
    expect(store.get()?.src).toBe("blob:one");
    expect(store.get()?.subtitle).toBe("Paragraph 1 of 2");
  });

  // A fake held element: `play()` "speaks" for a moment and then ends, the way a chunk of audio does.
  function fakeStore() {
    const el = Object.assign(new EventTarget(), {
      paused: true, ended: false, currentTime: 0, duration: 4, src: "",
      setAttribute(_name: string, value: string) { el.src = value; },
      play() { el.paused = false; queueMicrotask(() => { el.dispatchEvent(new Event("playing")); el.currentTime = 4; el.dispatchEvent(new Event("timeupdate")); el.ended = true; el.paused = true; el.dispatchEvent(new Event("ended")); }); return Promise.resolve(); },
    });
    let held: { el: HTMLMediaElement } | null = null;
    const log = { refs: [] as Array<{ title: string; subtitle?: string }>, srcs: [] as string[], patches: [] as Array<Record<string, unknown>>, cleared: 0 };
    const store: ListenStore = {
      elementFor(ref) { log.refs.push({ title: ref.title, subtitle: ref.subtitle }); held = { el: el as unknown as HTMLMediaElement }; return el as unknown as HTMLMediaElement; },
      retarget(_el, patch) { log.patches.push(patch); if (patch.src) { log.srcs.push(patch.src); el.ended = false; } },
      get: () => held,
      clear() { held = null; log.cleared += 1; },
    };
    return { store, log };
  }
  const finished = async (log: { cleared: number }) => { for (let i = 0; i < 200 && log.cleared === 0; i++) await new Promise((resolve) => setTimeout(resolve, 5)); };

  test("pressing Listen opens the bar and says loading before anything is fetched", async () => {
    const original = api.appData;
    (api as { appData: unknown }).appData = () => new Promise(() => {});
    try {
      const { store, log } = fakeStore();
      const status = createListenStatus();
      void createStoryListener(store, () => {}, status).listen("s1");
      expect(log.refs[0]?.title).toBe("Opening the story…");
      expect(status.get()).toEqual({ storyId: "s1", phase: "loading", progress: 0 });
    } finally {
      (api as { appData: unknown }).appData = original;
    }
  });

  test("every chunk of the story is spoken in order, the bar carries the title and the source icon, and progress reaches the end", async () => {
    const originalData = api.appData;
    const originalSpeech = api.streamSpeech;
    const originalUrl = URL.createObjectURL;
    const spoken: string[] = [];
    (api as { appData: unknown }).appData = async () => [{ props: { title: "Barn fire", sourceIconUrl: "/api/favicon?domain=example.com", blocks: [], speech: ["Barn fire. Lead.", "Second chunk.", "Third chunk."] } }];
    (api as { streamSpeech: unknown }).streamSpeech = async (text: string) => { spoken.push(text); return new Response(new Blob(["x"])); };
    URL.createObjectURL = () => `blob:${spoken.length}`;
    try {
      const { store, log } = fakeStore();
      const status = createListenStatus();
      const seen: number[] = [];
      status.subscribe(() => seen.push(status.get().progress));
      await createStoryListener(store, () => {}, status).listen("s1");
      await finished(log);
      expect(spoken).toEqual(["Barn fire. Lead.", "Second chunk.", "Third chunk."]);
      expect(log.srcs).toHaveLength(3);
      expect(log.patches.some((patch) => patch.title === "Barn fire" && patch.poster === "/api/favicon?domain=example.com")).toBe(true);
      expect(Math.max(...seen)).toBeGreaterThan(0.9);
      expect(status.get().phase).toBeNull();
    } finally {
      (api as { appData: unknown }).appData = originalData;
      (api as { streamSpeech: unknown }).streamSpeech = originalSpeech;
      URL.createObjectURL = originalUrl;
    }
  });

  test("a chunk that cannot be made is skipped after one retry and the rest is still read", async () => {
    const originalData = api.appData;
    const originalSpeech = api.streamSpeech;
    const originalUrl = URL.createObjectURL;
    const asked: string[] = [];
    (api as { appData: unknown }).appData = async () => [{ props: { title: "Barn fire", blocks: [], speech: ["One.", "Two.", "Three."] } }];
    (api as { streamSpeech: unknown }).streamSpeech = async (text: string) => { asked.push(text); if (text === "Two.") throw new Error("voice busy"); return new Response(new Blob(["x"])); };
    URL.createObjectURL = () => "blob:x";
    const lines: string[] = [];
    try {
      const { store, log } = fakeStore();
      await createStoryListener(store, (line) => lines.push(line), createListenStatus()).listen("s1");
      await finished(log);
      expect(asked.filter((text) => text === "Two.")).toHaveLength(2);
      expect(log.srcs).toHaveLength(2);
      expect(lines).toEqual([]);
    } finally {
      (api as { appData: unknown }).appData = originalData;
      (api as { streamSpeech: unknown }).streamSpeech = originalSpeech;
      URL.createObjectURL = originalUrl;
    }
  });
});

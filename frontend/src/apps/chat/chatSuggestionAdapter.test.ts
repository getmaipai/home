import { describe, expect, test, mock } from "bun:test";
import { createChatSuggestionAdapter } from "@/apps/chat/chatSuggestionAdapter";
import type { PackageManifest } from "@/lib/api";

function manifest(id: string, examples?: string[]): PackageManifest {
  return {
    id,
    version: "1.0.0",
    kind: "plugin",
    category: "Utilities",
    display: id,
    description: id,
    author: "MaiPai",
    license: "AGPL-3.0",
    platforms: ["home"],
    min_role: "guest",
    consequential: false,
    offline: "unavailable",
    min_app: "0.1.0",
    tier: 0,
    ...(examples ? { routing: { examples } } : {}),
  } as PackageManifest;
}

function stubPlugins(manifests: PackageManifest[]): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/plugins")) return Promise.resolve(new Response(JSON.stringify(manifests), { status: 200 }));
    throw new Error(`unstubbed fetch: ${url}`);
  }) as unknown as typeof fetch;
  return () => (globalThis.fetch = original);
}

describe("createChatSuggestionAdapter", () => {
  test("takes the first routing example from up to three installed packages", async () => {
    const restore = stubPlugins([
      manifest("weather", ["What's the weather tomorrow?", "Will it rain today?"]),
      manifest("calendar", ["What's on my calendar?"]),
      manifest("recipes", ["Suggest a dinner recipe"]),
      manifest("timers", ["Set a 10 minute timer"]),
    ]);
    try {
      const suggestions = await createChatSuggestionAdapter().generate({ messages: [], signal: undefined });
      expect(suggestions).toEqual([
        { prompt: "What's the weather tomorrow?" },
        { prompt: "What's on my calendar?" },
        { prompt: "Suggest a dinner recipe" },
      ]);
    } finally {
      restore();
    }
  });

  test("skips a package that declares no routing examples", async () => {
    const restore = stubPlugins([manifest("no-examples"), manifest("weather", ["What's the weather?"])]);
    try {
      const suggestions = await createChatSuggestionAdapter().generate({ messages: [], signal: undefined });
      expect(suggestions).toEqual([{ prompt: "What's the weather?" }]);
    } finally {
      restore();
    }
  });

  test("returns no suggestions rather than throwing when the plugins list fails to load", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mock(() => Promise.reject(new Error("network error"))) as unknown as typeof fetch;
    try {
      const suggestions = await createChatSuggestionAdapter().generate({ messages: [], signal: undefined });
      expect(suggestions).toEqual([]);
    } finally {
      globalThis.fetch = original;
    }
  });
});

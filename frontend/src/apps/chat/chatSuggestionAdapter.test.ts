import { afterEach, describe, expect, test, mock, spyOn } from "bun:test";
import { createChatSuggestionAdapter } from "@/apps/chat/chatSuggestionAdapter";
import { api, type PackageManifest } from "@/lib/api";

afterEach(() => mock.restore());

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

function stubPlugins(manifests: PackageManifest[]) {
  return spyOn(api, "plugins").mockResolvedValue(manifests as never);
}

describe("createChatSuggestionAdapter", () => {
  test("takes the first routing example from up to three installed packages", async () => {
    stubPlugins([
      manifest("weather", ["What's the weather tomorrow?", "Will it rain today?"]),
      manifest("calendar", ["What's on my calendar?"]),
      manifest("recipes", ["Suggest a dinner recipe"]),
      manifest("timers", ["Set a 10 minute timer"]),
    ]);
    const suggestions = await createChatSuggestionAdapter().generate({ messages: [], signal: undefined });
    expect(suggestions).toEqual([
      { prompt: "What's the weather tomorrow?" },
      { prompt: "What's on my calendar?" },
      { prompt: "Suggest a dinner recipe" },
    ]);
  });

  test("skips a package that declares no routing examples", async () => {
    stubPlugins([manifest("no-examples"), manifest("weather", ["What's the weather?"])]);
    const suggestions = await createChatSuggestionAdapter().generate({ messages: [], signal: undefined });
    expect(suggestions).toEqual([{ prompt: "What's the weather?" }]);
  });

  test("returns no suggestions rather than throwing when the plugins list fails to load", async () => {
    spyOn(api, "plugins").mockRejectedValue(new Error("network error"));
    const suggestions = await createChatSuggestionAdapter().generate({ messages: [], signal: undefined });
    expect(suggestions).toEqual([]);
  });
});

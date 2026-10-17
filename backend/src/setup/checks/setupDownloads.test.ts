import { expect, test } from "bun:test";
import { startSetupDownloads, type SetupDownloadClient } from "./setupDownloads";

test("setup downloads start four jobs concurrently, chat first, and keep going after a failure", async () => {
  const starts: string[] = [];
  let active = 0;
  let maximum = 0;
  const pins = ["chat-starter", "stt-a", "stt-b", "tts-a", "embed"].map((id, index) => ({
    id, role: index === 0 ? "chat" : id.startsWith("stt") ? "stt" : id.startsWith("tts") ? "tts" : "embed", repo: "org/model", license: "Apache-2.0", revision: `rev-${index}`, engine: "engine",
    download: { url: `https://example.invalid/${id}`, sha256: "a".repeat(64), approx_bytes: 1 },
  }));
  const gates: Array<() => void> = [];
  const client: SetupDownloadClient = {
    modelCatalog: async () => ({ models: pins }),
    pullModel: async ({ id }) => {
      starts.push(id);
      active++;
      maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => gates.push(resolve));
      active--;
      if (id === "stt-a") throw new Error("one failure");
      return { job: id };
    },
  };
  const running = startSetupDownloads(client);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(starts).toEqual(["chat-starter", "stt-a", "stt-b", "tts-a"]);
  expect(maximum).toBe(4);
  gates.splice(0).forEach((release) => release());
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(starts).toContain("embed");
  gates.splice(0).forEach((release) => release());
  await running;
  expect(starts).toHaveLength(5);
});


test("setup downloads install each named engine build before pulling models", async () => {
  const order: string[] = [];
  const client: SetupDownloadClient = {
    modelCatalog: async () => ({ models: [
      { id: "a", role: "chat", revision: "r", engine: "llama-server", download: { url: "https://example.invalid/a", sha256: "a".repeat(64) } },
      { id: "b", role: "embed", revision: "r", engine: "llama-server", download: { url: "https://example.invalid/b", sha256: "a".repeat(64) } },
    ] }),
    engineAction: async (name, action) => { order.push(`${action}:${name}`); return {}; },
    pullModel: async ({ id }) => { order.push(`pull:${id}`); return {}; },
  };
  await startSetupDownloads(client);
  expect(order).toEqual(["install:llama-server", "pull:a", "pull:b"]);
});

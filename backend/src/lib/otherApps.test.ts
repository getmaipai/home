import { describe, expect, test } from "bun:test";
import { readOtherApps } from "@/lib/otherApps";

const GB = 1024 ** 3;
describe("readOtherApps", () => {
  test("with the helper installed it reads only the helper, drops small, MaiPai and system apps, and names the biggest first", async () => {
    let stackAsked = false;
    const result = await readOtherApps({
      helper: async () => ({ installed: true, apps: [
        { bundleId: "com.apple.Safari", name: "Safari", bytes: 9 * GB, frontmost: false }, { bundleId: "org.mozilla.firefox", name: "Firefox", bytes: 3 * GB, frontmost: false },
        { bundleId: "com.apple.Notes", name: "Notes", bytes: 0.2 * GB, frontmost: false }, { bundleId: "ai.maipai.home", name: "MaiPai", bytes: 20 * GB, frontmost: false }, { bundleId: "com.apple.finder", name: "Finder", bytes: 2 * GB, frontmost: true },
      ] }),
      stack: async () => { stackAsked = true; return undefined; },
    });
    expect(result).toEqual({ source: "helper", apps: [{ name: "Safari", bytes: 9 * GB }, { name: "Firefox", bytes: 3 * GB }] });
    expect(stackAsked).toBe(false);
  });
  test("without the helper it uses the Stack's dev-load reading", async () => {
    const result = await readOtherApps({ helper: async () => ({ installed: false, apps: [] }), stack: async () => ({ others_bytes: 12 * GB, processes: [{ name: "node", bytes: 12 * GB }] }) });
    expect(result).toEqual({ source: "stack", apps: [{ name: "node", bytes: 12 * GB }] });
  });
  test("no helper and no Stack reading is none, never an error", async () => {
    expect(await readOtherApps({ helper: async () => ({ installed: false, apps: [] }), stack: async () => { throw new Error("down"); } })).toEqual({ source: "none", apps: [] });
  });
});

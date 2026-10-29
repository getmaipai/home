import { afterEach, describe, expect, test } from "bun:test";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import { runImageTool } from "./tools";
const png = new Uint8Array([1, 2, 3]);
afterEach(() => __resetStackEngineForTests());
function install(client: Record<string, unknown>) { __setStackClientForTests(client as never); }
describe("runImageTool", () => {
  test("returns a done reply", async () => {
    install({ imageEdit: async () => ({ kind: "done", job: "j", item: { b64_json: Buffer.from(png).toString("base64"), width: 2, height: 3 } }) });
    const result = await runImageTool("upscale", png, { mediaType: "image/png" });
    expect([...result.png]).toEqual([...png]); expect(result.width).toBe(2); expect(result.height).toBe(3);
  });
  test("polls a running reply and fetches its result", async () => {
    const calls: string[] = [];
    install({ imageEdit: async () => ({ kind: "running", job: "j" }), job: async () => { calls.push("job"); return { state: "done" }; }, imageEditResult: async () => png });
    const result = await runImageTool("remove_background", png, { mediaType: "image/png", pollEveryMs: 0 });
    expect(calls).toEqual(["job"]); expect([...result.png]).toEqual([...png]);
  });
  test("reports failed and cancelled jobs", async () => {
    install({ imageEdit: async () => ({ kind: "running", job: "j" }), job: async () => ({ state: "failed", reason: "No subject." }) });
    await expect(runImageTool("remove_background", png, { mediaType: "image/png", pollEveryMs: 0 })).rejects.toThrow("No subject.");
    install({ imageEdit: async () => ({ kind: "running", job: "j" }), job: async () => ({ state: "cancelled" }) });
    await expect(runImageTool("remove_background", png, { mediaType: "image/png", pollEveryMs: 0 })).rejects.toThrow("The background removal was cancelled.");
  });
});

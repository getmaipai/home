import { afterEach, describe, expect, test } from "bun:test";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import { fetchImageToolResult, runImageTool, submitImageTool } from "./tools";
const png = new Uint8Array([1, 2, 3]);
afterEach(() => __resetStackEngineForTests());
function install(client: Record<string, unknown>) { __setStackClientForTests(client as never); }
describe("runImageTool", () => {
  test("shared submission returns done bytes and forwards every parameter", async () => {
    let sent: FormData | undefined;
    install({ imageEdit: async (form: FormData) => { sent = form; return { kind: "done", job: "j", item: { b64_json: Buffer.from(png).toString("base64"), width: 2, height: 3 } }; } });
    const result = await submitImageTool("erase", png, { factor: 4, scale: 2, width: 30, height: 40, mask: png }, { mediaType: "image/png", timeoutMs: 2500 });
    expect(result.kind).toBe("done");
    if (result.kind === "done") { expect([...result.png]).toEqual([...png]); expect(result.item.width).toBe(2); }
    expect(sent?.get("factor")).toBe("4"); expect(sent?.get("scale")).toBe("2"); expect(sent?.get("width")).toBe("30"); expect(sent?.get("height")).toBe("40");
    expect((sent?.get("mask") as File)?.name).toBe("mask.png"); expect(sent?.get("timeout_ms")).toBe("2500");
  });
  test("shared submission returns a job and result primitive fetches its PNG", async () => {
    let fetched = "";
    install({ imageEdit: async () => ({ kind: "running", job: "job-1" }), imageEditResult: async (job: string) => { fetched = job; return png; } });
    expect(await submitImageTool("upscale", png, { scale: 2 })).toEqual({ kind: "job", job: "job-1" });
    expect([...await fetchImageToolResult("job-1")]).toEqual([...png]); expect(fetched).toBe("job-1");
  });
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

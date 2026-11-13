import { afterEach, describe, expect, test } from "bun:test";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import { evaluateClipSeries, clipWeight, keepBetter, shouldRetake } from "@/lib/videos/frameCheck";
import { checkClipFile } from "@/lib/videos/stackClipCheck";

afterEach(() => __resetStackEngineForTests());

const series = (patch: Record<string, unknown> = {}) => ({ fps: 12, duration_s: 2, luma: Array(24).fill(60), diff: Array(24).fill(2), sharpness: Array(24).fill(100), ...patch });
const codes = (s: ReturnType<typeof series>, opts: Parameters<typeof evaluateClipSeries>[1] = {}) => evaluateClipSeries(s as never, opts).findings;

describe("whole clip rules", () => {
  test("black and frozen use consecutive sample durations", () => {
    expect(codes(series({ luma: [1, 1, 1, 1, ...Array(20).fill(60)] })).map(x => x.code)).toContain("black");
    expect(codes(series({ luma: [1, 1, 1, ...Array(21).fill(60)] })).map(x => x.code)).not.toContain("black");
    expect(codes(series({ diff: [...Array(12).fill(0.1), ...Array(12).fill(2)] })).map(x => x.code)).toContain("frozen");
    expect(codes(series({ diff: [...Array(11).fill(0.1), ...Array(13).fill(2)] })).map(x => x.code)).not.toContain("frozen");
  });
  test("jump and soft severity", () => {
    expect(codes(series({ diff: [...Array(23).fill(2), 30] })).map(x => x.code)).toContain("jump");
    expect(codes(series({ sharpness: [...Array(6).fill(20), ...Array(18).fill(100)] })).find(x => x.code === "soft")?.level).toBe("warning");
    expect(codes(series({ duration_s: 4, sharpness: [...Array(18).fill(20), ...Array(30).fill(100)] })).find(x => x.code === "soft")?.level).toBe("serious");
  });
  test("camera move and loop seam are opt-in", () => {
    expect(codes(series({ flow: [{ at_s: 0, dx: 0, dy: 0, zoom: 0 }] }), { cameraMove: "move" }).map(x => x.code)).toContain("camera_not_seen");
    expect(codes(series({ flow: [] })).map(x => x.code)).not.toContain("camera_not_seen");
    expect(codes(series(), { loop: true, seamSsim: 0.85 }).map(x => x.code)).toContain("loop_seam");
    expect(codes(series(), { loop: true, seamSsim: 0.95 }).map(x => x.code)).not.toContain("loop_seam");
  });
  test("weights, ties and retake rule", () => {
    const a = [{ code: "soft", level: "warning", message: "x" }] as const;
    const b = [{ code: "black", level: "serious", message: "x" }] as const;
    expect(clipWeight(a as never)).toBe(1);
    expect(keepBetter(a as never, a as never)).toBe("second");
    expect(keepBetter(a as never, b as never)).toBe("first");
    expect(shouldRetake({ findings: b as never, isRetake: false })).toBe(true);
    expect(shouldRetake({ findings: b as never, isRetake: true })).toBe(false);
  });
});

describe("Stack clip check", () => {
  test("returns unchecked on job failure and evaluates a successful result", async () => {
    __setStackClientForTests({ submitJob: async () => ({ id: "x", state: "failed" }) } as never);
    expect(await checkClipFile("/tmp/a.mp4", {})).toEqual({ checked: false, frames: 0, findings: [] });
    __setStackClientForTests({ submitJob: async () => ({ id: "x", state: "done", result: series({ luma: [1, 1, 1, 1, ...Array(20).fill(60)] }) }) } as never);
    expect((await checkClipFile("/tmp/a.mp4", {})).findings.map(x => x.code)).toContain("black");
  });
});

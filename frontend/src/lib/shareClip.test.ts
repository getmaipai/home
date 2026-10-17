import { describe, expect, test } from "bun:test";
import { fileNameFrom, shareClip, type PreparedClip } from "@/lib/shareClip";

const prepared: PreparedClip = { blob: new Blob([new Uint8Array(10)], { type: "video/mp4" }), name: "paper-boat.mp4" };

describe("shareClip", () => {
  test("shares the real file with the system share sheet, calling share synchronously in the click", async () => {
    const seen: Array<{ files?: File[]; title?: string }> = [];
    let fell = 0;
    const promise = shareClip({ prepared, title: "a paper boat", nav: { canShare: () => true, share: async (data) => { seen.push(data); } }, fallback: () => { fell += 1; } });
    // Synchronous: the share call has already happened before any await.
    expect(seen).toHaveLength(1);
    expect(seen[0]!.files![0]!.name).toBe("paper-boat.mp4");
    expect(seen[0]!.files![0]!.type).toBe("video/mp4");
    expect(seen[0]!.title).toBe("a paper boat");
    expect(await promise).toBe("shared");
    expect(fell).toBe(0);
  });

  test("falls back to the share link when the browser cannot share files, or the file is not ready", async () => {
    let fell = 0;
    expect(await shareClip({ prepared, title: "t", nav: { canShare: () => false, share: async () => {} }, fallback: () => { fell += 1; } })).toBe("fallback");
    expect(await shareClip({ prepared, title: "t", nav: {}, fallback: () => { fell += 1; } })).toBe("fallback");
    expect(await shareClip({ prepared: undefined, title: "t", nav: { canShare: () => true, share: async () => {} }, fallback: () => { fell += 1; } })).toBe("fallback");
    expect(fell).toBe(3);
  });

  test("closing the sheet is not a failure; any other error falls back", async () => {
    let fell = 0;
    const abort = Object.assign(new Error("closed"), { name: "AbortError" });
    expect(await shareClip({ prepared, title: "t", nav: { canShare: () => true, share: async () => { throw abort; } }, fallback: () => { fell += 1; } })).toBe("cancelled");
    expect(fell).toBe(0);
    expect(await shareClip({ prepared, title: "t", nav: { canShare: () => true, share: async () => { throw new Error("NotAllowedError"); } }, fallback: () => { fell += 1; } })).toBe("fallback");
    expect(fell).toBe(1);
  });
});

describe("fileNameFrom", () => {
  test("reads the download name", () => {
    expect(fileNameFrom('attachment; filename="paper-boat.mp4"', "video.mp4")).toBe("paper-boat.mp4");
    expect(fileNameFrom(null, "video.mp4")).toBe("video.mp4");
  });
});

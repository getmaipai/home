import { describe, expect, test } from "bun:test";
import { installLabel, installWords, plainSize, timeLeft } from "./installWords";

const label = (id: string, bytes?: number, role?: string) => installLabel(installWords({ id, role }), bytes).replace(/\u00a0/g, " ");

describe("installWords", () => {
  test("each component reads as what it does, never as a file name or a product name Home kept by hand", () => {
    expect(label("flux3-image-klein", 21_000_000_000)).toBe("Downloading the picture maker (21 GB)");
    expect(label("ltx-2-5-q8-distilled-mlx", 38_000_000_000, "video")).toBe("Getting the video model ready (38 GB)");
    expect(label("chatterbox-turbo-fp16")).toBe("Installing voice");
    expect(label("ddgs")).toBe("Setting up web search");
    expect(label("image-tools-rmbg")).toBe("Installing editing tools");
  });
  test("no rule names a product: names come from the Stack", () => {
    for (const id of ["flux3-image-klein", "wan2.2-ti2v", "chatterbox-turbo-fp16", "qwen3-vl-4b", "ace-step-1-5-turbo"]) expect(installWords({ id }).product).toBeUndefined();
  });
  test("an unknown id falls back to its role, then to a plain generic line", () => {
    expect(label("some-new-thing", 5e8, "tts")).toBe("Installing voice");
    expect(label("some-new-thing")).toBe("Downloading a part of your AI");
    for (const id of ["flux3-image-klein", "wan2.2-ti2v"]) expect(label(id)).not.toContain(id);
  });
  test("sizes and time left", () => {
    expect(plainSize(19_443_246_692)).toBe("19.4 GB");
    expect(plainSize(44_800_000)).toBe("44.8 MB");
    expect(timeLeft(420)).toBe("about 7 min left");
    expect(timeLeft(30)).toBe("less than a minute left");
    expect(timeLeft(null)).toBeNull();
  });
});

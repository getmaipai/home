import { describe, expect, test } from "bun:test";
import { installLabel, installWords, plainSize, timeLeft } from "./installWords";

const label = (id: string, bytes?: number, role?: string) => installLabel(installWords({ id, role }), bytes).replace(/\u00a0/g, " ");

describe("installWords", () => {
  test("each component reads as what it does, never as a file name", () => {
    expect(label("muse-glimmer-30b-mlx-4bit", 19_443_246_692)).toBe("Installing a faster chat engine for Muse Glimmer (19.4 GB)");
    expect(label("flux2-klein", 16_000_000_000)).toBe("Downloading the picture maker (FLUX.2 Klein, 16 GB)");
    expect(label("wan2.2-ti2v", 41_000_000_000)).toBe("Getting the video model ready (Wan2.2, 41 GB)");
    expect(label("chatterbox-turbo-mlx")).toBe("Installing voice (Chatterbox)");
    expect(label("ddgs")).toBe("Setting up web search");
    expect(label("image-tools-rmbg")).toBe("Installing editing tools");
    expect(label("qwen3-1.7b-q8-0", 1_834_426_016)).toBe("Downloading the starter chat model (Qwen3 1.7B, 1.8 GB)");
  });
  test("an unknown id falls back to its role, then to a plain generic line", () => {
    expect(label("some-new-thing", 5e8, "tts")).toBe("Installing voice");
    expect(label("some-new-thing")).toBe("Downloading a part of your AI");
    for (const id of ["muse-glimmer-30b-mlx-4bit", "flux2-klein", "wan2.2-ti2v"]) expect(label(id)).not.toContain(id);
  });
  test("sizes and time left", () => {
    expect(plainSize(19_443_246_692)).toBe("19.4 GB");
    expect(plainSize(44_800_000)).toBe("44.8 MB");
    expect(timeLeft(420)).toBe("about 7 min left");
    expect(timeLeft(30)).toBe("less than a minute left");
    expect(timeLeft(null)).toBeNull();
  });
});

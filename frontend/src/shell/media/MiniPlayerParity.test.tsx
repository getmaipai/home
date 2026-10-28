// MEDIA-VIZ-03: the pieces added to bring the mini player and the Music page up to the pre-rebuild hub's.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { getVisualizerEnabled, setVisualizerEnabled } from "@/shell/media/AudioVisualizer";
import { MinimizeButton } from "@/shell/media/MinimizeButton";
import { defaultPalette } from "@/lib/media/artPalette";

beforeEach(() => { try { localStorage.clear(); } catch { /* none */ } });
afterEach(cleanup);

describe("visualizer on/off", () => {
  test("is on until the person picks None, and remembers it", () => {
    expect(getVisualizerEnabled()).toBe(true);
    setVisualizerEnabled(false);
    expect(getVisualizerEnabled()).toBe(false);
    setVisualizerEnabled(true);
    expect(getVisualizerEnabled()).toBe(true);
  });
});

describe("MinimizeButton", () => {
  test("is a labelled button on a play page", () => {
    const view = render(<MemoryRouter><MinimizeButton appHome="/apps/music" /></MemoryRouter>);
    const button = view.getByRole("button", { name: "Minimize to the mini player" });
    expect(button.textContent).toContain("Minimize");
    expect(() => fireEvent.click(button)).not.toThrow();
  });
});

describe("defaultPalette", () => {
  test("has six-digit hex colors a canvas can read, never empty", () => {
    const palette = defaultPalette();
    for (const color of [palette.dominant, palette.vibrant, palette.dark, palette.light, ...palette.corners]) expect(color).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe("VisualizerMenu icon", () => {
  test("is not the waveform, which chat uses for voice", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("./VisualizerMenu.tsx", import.meta.url), "utf8");
    expect(source).not.toContain("audio-waveform");
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { LevelMeter } from "@/lib/voice/audioLevelMeter";
import { ComposerDictationWaveform, DictationLevelMeterProvider } from "@/apps/chat/composerDictationWaveform";

function fakeLevelMeter(read: () => number): LevelMeter {
  return { read, stop: () => {} };
}

describe("ComposerDictationWaveform", () => {
  afterEach(() => {
    cleanup();
    document.documentElement.style.removeProperty("--color-primary");
  });

  test("renders a fixed row of bars even before a meter exists, at their resting height", () => {
    const { getAllByTestId } = render(
      <DictationLevelMeterProvider value={null}>
        <ComposerDictationWaveform />
      </DictationLevelMeterProvider>,
    );
    const bars = getAllByTestId("dictation-bar");
    expect(bars).toHaveLength(24);
    for (const bar of bars) expect(bar.style.height).toBe("8%");
  });

  test("the accessible text is present even before the bars have anything to show", () => {
    const { getByText } = render(
      <DictationLevelMeterProvider value={null}>
        <ComposerDictationWaveform />
      </DictationLevelMeterProvider>,
    );
    expect(getByText("Listening")).toBeDefined();
  });

  test("colors the bars from the design token", () => {
    document.documentElement.style.setProperty("--color-primary", "rgb(1, 2, 3)");
    const { getAllByTestId } = render(
      <DictationLevelMeterProvider value={null}>
        <ComposerDictationWaveform />
      </DictationLevelMeterProvider>,
    );
    for (const bar of getAllByTestId("dictation-bar")) expect(bar.style.backgroundColor).toBe("rgb(1, 2, 3)");
  });

  test("falls back to a real color when the token isn't resolvable (never an empty barColor)", () => {
    const { getAllByTestId } = render(
      <DictationLevelMeterProvider value={null}>
        <ComposerDictationWaveform />
      </DictationLevelMeterProvider>,
    );
    for (const bar of getAllByTestId("dictation-bar")) expect(bar.style.backgroundColor).toBeTruthy();
  });

  test("bars animate from the live meter's own read() once one is in context", async () => {
    const meter = fakeLevelMeter(() => 0.5);
    const { getAllByTestId } = render(
      <DictationLevelMeterProvider value={meter}>
        <ComposerDictationWaveform />
      </DictationLevelMeterProvider>,
    );
    // The poll interval is 60ms - wait past a few ticks so the rolling
    // window has shifted the fake meter's own 0.5 reading all the way in.
    await waitFor(() => expect(getAllByTestId("dictation-bar").some((bar) => bar.style.height === "50%")).toBe(true), { timeout: 1000 });
  });

  test("a meter that goes away (dictation ends) settles the bars back to resting height on the next poll", async () => {
    const meter = fakeLevelMeter(() => 0.5);
    const { getAllByTestId, rerender } = render(
      <DictationLevelMeterProvider value={meter}>
        <ComposerDictationWaveform />
      </DictationLevelMeterProvider>,
    );
    await waitFor(() => expect(getAllByTestId("dictation-bar").some((bar) => bar.style.height === "50%")).toBe(true), { timeout: 1000 });
    rerender(
      <DictationLevelMeterProvider value={null}>
        <ComposerDictationWaveform />
      </DictationLevelMeterProvider>,
    );
    await waitFor(() => expect(getAllByTestId("dictation-bar").every((bar) => bar.style.height === "8%")).toBe(true));
  });
});

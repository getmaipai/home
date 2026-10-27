// MEDIA-VIZ-02: the Music page's visualizer draws only while the media host holds that song.
import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { MusicVisualizerSection } from "@/shell/media/MusicVisualizerSection";

afterEach(cleanup);

describe("MusicVisualizerSection", () => {
  test("draws nothing when the host holds no song, so a page that is not playing shows no visualizer", () => {
    const view = render(<MusicVisualizerSection id="media-a" />);
    expect(view.container.querySelector('[data-testid="music-visualizer-section"]')).toBeNull();
  });
});

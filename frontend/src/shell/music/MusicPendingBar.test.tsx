import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { MusicPendingBar } from "./MusicPendingBar";

afterEach(cleanup);

describe("the mini player while the clicked song loads", () => {
  test("shows the clicked song's title, artist line and artwork with a loading status", () => {
    const view = render(<MusicPendingBar pending={{ key: "m1", title: "Pancakes", subtitle: "Sage", artworkUrl: "/thumb" }} />);
    const bar = view.container.querySelector('[data-testid="music-player-pending"]')!;
    expect(bar).not.toBeNull();
    expect(bar.textContent).toContain("Pancakes");
    expect(bar.textContent).toContain("Sage");
    expect(bar.querySelector("img")?.getAttribute("src")).toBe("/thumb");
    expect(view.getByRole("status").textContent).toMatch(/loading/i);
  });

  test("draws without artwork or an artist line", () => {
    const view = render(<MusicPendingBar pending={{ key: "m2", title: "Quiet", artworkUrl: null }} />);
    expect(view.container.querySelector("img")).toBeNull();
    expect(view.container.textContent).toContain("Quiet");
  });
});

import { afterEach, expect, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { StackedAlphaPreview, STACKED_ALPHA_FRAGMENT_SHADER, unpremultiply } from "@/shell/pages/StackedAlphaPreview";

afterEach(cleanup);
test("unpremultiply restores straight colour", () => { expect(unpremultiply(0.2, 0.1, 0.05, 0.5)).toEqual([0.4, 0.2, 0.1, 0.5]); });
test("fragment shader reads stacked colour and alpha halves", () => { expect(STACKED_ALPHA_FRAGMENT_SHADER).toContain("(1.0 - uv.y) * 0.5"); expect(STACKED_ALPHA_FRAGMENT_SHADER).toContain("0.5 + (1.0 - uv.y) * 0.5"); });
test("selects AV1 only when the browser says probably", async () => {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
  Object.defineProperty(HTMLMediaElement.prototype, "canPlayType", { configurable: true, value: () => "probably" });
  const old = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = class { constructor(private callback: IntersectionObserverCallback) {} observe(target: Element) { this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver); } disconnect() {} unobserve() {} } as unknown as typeof IntersectionObserver;
  const view = render(<StackedAlphaPreview urls={{ h264: "h264.mp4", av1: "av1.mp4", still: "still.png" }} label="Idle" />);
  await waitFor(() => expect((view.container.querySelector("video") as HTMLVideoElement).getAttribute("src")).toBe("av1.mp4"));
  globalThis.IntersectionObserver = old;
});
test("falls back to still when WebGL is missing and offers Play for reduced motion", async () => {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) });
  const oldContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
  const old = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = class { constructor(private callback: IntersectionObserverCallback) {} observe(target: Element) { this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver); } disconnect() {} unobserve() {} } as unknown as typeof IntersectionObserver;
  const view = render(<StackedAlphaPreview urls={{ h264: "h264.mp4", av1: "av1.mp4", still: "still.png" }} label="Idle" />);
  expect(view.getByAltText("Idle clip still")).toBeTruthy(); expect(view.getByRole("button", { name: "Play" })).toBeTruthy();
  HTMLCanvasElement.prototype.getContext = oldContext; globalThis.IntersectionObserver = old;
});

test("falls back to the still when WebGL cannot create a context", async () => {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
  const oldContext = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
  const old = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = class { constructor(private callback: IntersectionObserverCallback) {} observe(target: Element) { this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver); } disconnect() {} unobserve() {} } as unknown as typeof IntersectionObserver;
  const view = render(<StackedAlphaPreview urls={{ h264: "h264.mp4", av1: "av1.mp4", still: "still.png" }} label="Idle" priority />);
  expect(await view.findByText("Preview not available in this browser.")).toBeTruthy(); expect(view.getByAltText("Idle clip still")).toBeTruthy();
  HTMLCanvasElement.prototype.getContext = oldContext; globalThis.IntersectionObserver = old;
});

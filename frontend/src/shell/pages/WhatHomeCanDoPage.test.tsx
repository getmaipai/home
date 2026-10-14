import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { WhatHomeCanDoPage } from "./WhatHomeCanDoPage";

let reducedMotion = false;

beforeEach(() => {
  reducedMotion = false;
  window.matchMedia = ((query: string) => ({
    matches: query === "(prefers-reduced-motion: reduce)" && reducedMotion,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
});

afterEach(cleanup);

describe("WhatHomeCanDoPage", () => {
  test("renders the ordered slide list and excludes hero.bot without package availability", () => {
    const view = render(<WhatHomeCanDoPage />);
    const slides = view.getAllByRole("group", { name: /.+/ });
    expect(slides.map((slide) => slide.getAttribute("aria-label"))).toEqual([
      "Your own AI at home", "Nothing leaves your house", "Ask it anything", "Safe for the whole family", "Add apps when you want them", "Works when the internet doesn't",
    ]);
    expect(view.queryByText("A robot friend"))?.toBeNull();
    expect(view.getByRole("region", { name: "What Home can do" })).toBeTruthy();
  });

  test("pause and play controls update their accessible label", () => {
    const view = render(<WhatHomeCanDoPage />);
    fireEvent.click(view.getByRole("button", { name: "Pause slides" }));
    expect(view.getByRole("button", { name: "Play slides" })).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Play slides" }));
    expect(view.getByRole("button", { name: "Pause slides" })).toBeTruthy();
  });

  test("starts paused when reduced motion is preferred", () => {
    reducedMotion = true;
    const view = render(<WhatHomeCanDoPage />);
    expect(view.getByRole("button", { name: "Play slides" })).toBeTruthy();
  });

  test("dots expose slide position labels", () => {
    const view = render(<WhatHomeCanDoPage />);
    expect(view.getByRole("button", { name: "Slide 1 of 6" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Slide 6 of 6" })).toBeTruthy();
  });
});

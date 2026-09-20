import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ThemeToggle } from "@/shell/ThemeToggle";

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("dark", "light");
});

test("shows a moon and switches to dark from a light page", () => {
  document.documentElement.classList.add("light");
  let seen: string | undefined;
  render(<ThemeToggle setAppearance={(value) => { seen = value; }} />);
  const button = document.querySelector("button")!;
  expect(button.getAttribute("aria-label")).toBe("Switch to dark appearance");
  fireEvent.click(button);
  expect(seen).toBe("dark");
});

test("shows a sun and switches to light from a dark page", () => {
  document.documentElement.classList.add("dark");
  let seen: string | undefined;
  render(<ThemeToggle setAppearance={(value) => { seen = value; }} />);
  const button = document.querySelector("button")!;
  expect(button.getAttribute("aria-label")).toBe("Switch to light appearance");
  fireEvent.click(button);
  expect(seen).toBe("light");
});

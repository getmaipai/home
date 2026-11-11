import { afterEach, expect, test } from "bun:test";
import { cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AskBox, composerHref } from "@/shell/pages/dashboard/AskBox";
import { renderWithQueryClient } from "../../../../tests/renderWithQueryClient";

afterEach(cleanup);

test("composer modes choose their destination and preserve the prompt", () => {
  expect(composerHref("ask", "  hello world ")).toBe("/chat?ask=hello%20world");
  expect(composerHref("picture", "a red fox")).toBe("/chat?ask=a%20red%20fox&mode=picture");
  expect(composerHref("video", "a red fox")).toBe("/apps/videos/create?prompt=a%20red%20fox");
  expect(composerHref("song", "a red fox")).toBe("/apps/music/create?prompt=a%20red%20fox");
});

test("the Home ask box has focus on arrival", async () => {
  const view = renderWithQueryClient(<MemoryRouter><AskBox /></MemoryRouter>);
  await waitFor(() => expect(document.activeElement).toBe(view.getByLabelText("Ask")));
});

test("starter suggestions wrap in a centered row", async () => {
  const view = renderWithQueryClient(<MemoryRouter><AskBox /></MemoryRouter>);
  await waitFor(() => expect(view.getByTestId("home-suggestions").querySelectorAll("[role=button]").length).toBeGreaterThan(0));
  const rail = view.getByTestId("home-suggestions");
  expect(rail.className).toContain("justify-center");
  for (const chip of rail.querySelectorAll("[role=button]")) expect(chip.className).toContain("h-10");
  expect(view.container.querySelector('[data-slot="prompt-bar"]')?.getAttribute("data-layout")).toBe("chat");
  expect(view.getByLabelText("Ask").tagName).toBe("TEXTAREA");
});

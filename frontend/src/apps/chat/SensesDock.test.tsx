import { afterEach, expect, test } from "bun:test";
import { cleanup, render, fireEvent } from "@testing-library/react";
import { SensesDock } from "./SensesDock";
afterEach(cleanup);
const props = { reply: "idle" as const, speaking: false, speechError: false, ears: "idle" as const, earError: null };
test("status details are available from a single control", () => {
  const screen = render(<SensesDock {...props} health={{ brain: "stopped", voice: "none" }} />);
  expect(screen.getAllByRole("button")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Chat status: Stopped" }));
  expect(screen.getByText(/Restart it in Settings/)).toBeTruthy();
  for (const name of ["Brain", "Mouth", "Ears", "Eyes"]) expect(screen.getByText(name)).toBeTruthy();
});
test("loading and failure states remain visible without opening diagnostics", () => {
  const screen = render(<SensesDock {...props} health={{ brain: "starting", voice: "none" }} />);
  expect(screen.getByRole("button", { name: "Chat status: Starting" }).textContent).toContain("Starting");
  screen.rerender(<SensesDock {...props} health={{ brain: "llama-server", voice: "pocket" }} reply="error" />);
  expect(screen.getByRole("button", { name: "Chat status: Reply failed" }).textContent).toContain("Reply failed");
});

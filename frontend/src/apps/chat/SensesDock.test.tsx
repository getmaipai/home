import { afterEach, expect, test } from "bun:test";
import { cleanup, render, fireEvent } from "@testing-library/react";
import { SensesDock } from "./SensesDock";
afterEach(cleanup);
const props = { reply: "idle" as const, speaking: false, speechError: false, ears: "idle" as const, earError: null };
test("shows unavailable capabilities and opens details on tap", () => {
  const screen = render(<SensesDock {...props} health={{ brain: "stopped", voice: "none" }} />);
  expect(screen.getByRole("button", { name: "Brain: Stopped" })).toBeTruthy();
  const eyes = screen.getByRole("button", { name: "Eyes: Coming soon" });
  fireEvent.focus(eyes);
  fireEvent.click(eyes);
  expect(screen.getByText(/Vision is not available yet/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Ears: Mic off" })).toBeTruthy();
});
test("shows the model loading", () => {
  const screen = render(<SensesDock {...props} health={{ brain: "starting", voice: "none" }} />);
  const brain = screen.getByRole("button", { name: "Brain: Starting" });
  fireEvent.focus(brain);
  expect(screen.getByText(/The model is loading/)).toBeTruthy();
});
test("reply and audio failures override a loaded service", () => {
  const screen = render(<SensesDock {...props} health={{ brain: "llama-server", voice: "pocket" }} reply="error" speechError />);
  expect(screen.getByRole("button", { name: "Brain: Reply failed" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Voice: Playback failed" })).toBeTruthy();
});
test("a health check that never resolved does not leave a green status", () => {
  const screen = render(<SensesDock {...props} health={{ brain: "unreachable", voice: "unreachable" }} />);
  expect(screen.getByRole("button", { name: "Brain: Unreachable" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Voice: Unreachable" })).toBeTruthy();
});

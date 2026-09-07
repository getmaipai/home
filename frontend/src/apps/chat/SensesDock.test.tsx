import { afterEach, expect, test } from "bun:test";
import { cleanup, render, fireEvent, waitFor } from "@testing-library/react";
import { api } from "@/lib/api";
import { SensesDock } from "./SensesDock";
const original = api.senses;
afterEach(() => { cleanup(); api.senses = original; });
const props = { reply: "idle" as const, speaking: false, speechError: false, ears: "idle" as const, earError: null };
test("shows unavailable capabilities and opens details on tap", async () => {
  api.senses = async () => ({ brain: "stopped", voice: "none" });
  const screen = render(<SensesDock {...props} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Brain: Stopped" })).toBeTruthy());
  const eyes = screen.getByRole("button", { name: "Eyes: Coming soon" });
  fireEvent.focus(eyes);
  fireEvent.click(eyes);
  expect(screen.getByText(/Vision is not available yet/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Ears: Mic off" })).toBeTruthy();
});
test("reply and audio failures override a loaded service", async () => {
  api.senses = async () => ({ brain: "llama-server", voice: "pocket" });
  const screen = render(<SensesDock {...props} reply="error" speechError />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Brain: Reply failed" })).toBeTruthy());
  expect(screen.getByRole("button", { name: "Voice: Playback failed" })).toBeTruthy();
});
test("failed health checks do not leave a green status", async () => {
  api.senses = async () => { throw new Error("offline"); };
  const screen = render(<SensesDock {...props} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Brain: Unreachable" })).toBeTruthy());
  expect(screen.getByRole("button", { name: "Voice: Unreachable" })).toBeTruthy();
});

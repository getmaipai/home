import { afterEach, expect, jest, test } from "bun:test";
import { createElement } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { isNeedsYou, isOops, isPendingApproval, isSpeaking, isListening, isThinking, isWorking, jobFinished, greetingForDay, useCompanionSignals, type SignalMessage } from "@/apps/chat/useCompanionSignals";

afterEach(() => { cleanup(); jest.useRealTimers(); });
const empty: SignalMessage = { role: "assistant", content: [] };

test("thinking requires a running thread and no assistant text", () => {
  expect(isThinking(true, empty)).toBe(true);
  expect(isThinking(false, empty)).toBe(false);
  expect(isThinking(true, { role: "assistant", content: [{ type: "text", text: "Hi" }] })).toBe(false);
});
test("working follows running tool calls or jobs", () => {
  expect(isWorking({ role: "assistant", content: [{ type: "tool-call", status: "running" }] }, false)).toBe(true);
  expect(isWorking(empty, true)).toBe(true);
  expect(isWorking(empty, false)).toBe(false);
});
test("speaking and needs-you map their direct inputs", () => {
  expect(isSpeaking(true)).toBe(true);
  expect(isSpeaking(false)).toBe(false);
  expect(isListening(true)).toBe(true);
  expect(isNeedsYou(true, false)).toBe(true);
  expect(isNeedsYou(false, true)).toBe(true);
  expect(isNeedsYou(false, false)).toBe(false);
});
test("approval cards are pending only while confirm is running", () => {
  expect(isPendingApproval({ role: "assistant", content: [{ type: "tool-call", toolName: "confirm", status: "running" }] })).toBe(true);
  expect(isPendingApproval(empty)).toBe(false);
});
test("sleeping starts after ten quiet minutes and resets on activity", async () => {
  jest.useFakeTimers();
  function Probe({ speaking = false }: { speaking?: boolean }) {
    const value = useCompanionSignals({ personId: "p", messages: [], running: false, jobRunning: false, jobWaiting: false, runningJobIds: new Set(), doneJobIds: new Set(), isSpeaking: speaking, listening: false });
    return createElement("output", null, String(value.wanted.sleeping));
  }
  const view = render(createElement(Probe));
  await act(async () => { jest.advanceTimersByTime(10 * 60_000); });
  await waitFor(() => expect(view.getByText("true")).toBeTruthy());
  view.rerender(createElement(Probe, { speaking: true }));
  expect(view.getByText("false")).toBeTruthy();
});
test("greeting is once per person per calendar day and tolerates storage failures", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  expect(greetingForDay("p1", "2026-10-21", storage)).toBe(true);
  expect(greetingForDay("p1", "2026-10-21", storage)).toBe(false);
  expect(greetingForDay("p1", "2026-10-22", storage)).toBe(true);
  expect(greetingForDay("p2", "2026-10-21", storage)).toBe(true);
  expect(greetingForDay("p3", "2026-10-21", { getItem: () => { throw Error(); }, setItem: () => { throw Error(); } })).toBe(true);
});
test("oops and celebrate recognize a failed reply and running-to-done transition", () => {
  expect(isOops({ role: "assistant", status: "error" })).toBe(true);
  expect(isOops(empty)).toBe(false);
  expect(jobFinished(new Set(["j1"]), new Set(["j1"]))).toBe(true);
  expect(jobFinished(new Set(["j1"]), new Set())).toBe(false);
});

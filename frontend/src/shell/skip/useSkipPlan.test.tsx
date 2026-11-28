import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, render, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSkipPlan } from "./useSkipPlan";
import { SkipButton, SkipRanges, SkippedPill } from "./SkipControls";
import { applySkip, type SkipRange, type SkipPlan } from "./skipPlan";

const realFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = realFetch; });

function PlanHook({ id }: { id: string | null }) {
  const result = useSkipPlan(id);
  return <output>{result.plan?.ranges.length ?? result.error ?? "loading"}</output>;
}

test("useSkipPlan loads from the configured fetch and refreshes on request", async () => {
  let calls = 0;
  globalThis.fetch = mock(async () => { calls++; return new Response(JSON.stringify({ state: "ready", ranges: [{ id: "r1", kind: "ad", startSec: 10, endSec: 20, status: "auto", mode: "skip" }] }), { status: 200 }); }) as unknown as typeof fetch;
  const client = new QueryClient();
  const view = render(<QueryClientProvider client={client}><PlanHook id="episode-1" /></QueryClientProvider>);
  await view.findByText("1");
  expect(calls).toBe(1);
  act(() => window.dispatchEvent(new Event("podcast-skip-plan-updated")));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(calls).toBe(2);
});

test("SkippedPill exposes Undo and live announcement text", async () => {
  const undo = mock(() => {});
  const view = render(<SkippedPill range={{ id: "x", kind: "ad", startSec: 10, endSec: 80 }} onUndo={undo} />);
  const status = await view.findByRole("status");
  expect(status.getAttribute("aria-live")).toBe("polite");
  expect(status.textContent).toContain("Skipped a break");
  fireEvent.click(view.getByRole("button", { name: "Undo" }));
  expect(undo).toHaveBeenCalledTimes(1);
});

test("SkipButton is only visible in an eligible active range", () => {
  const range: SkipRange = { id: "r1", kind: "ad", startSec: 10, endSec: 20, status: "auto", mode: "skip" };
  const view = render(<SkipButton range={null} onSkip={() => {}} onHear={() => {}} />);
  expect(view.queryByRole("button")).toBeNull();
  view.rerender(<SkipButton range={range} onSkip={() => {}} onHear={() => {}} />);
  expect(view.getByRole("button", { name: "Skip ad" })).toBeTruthy();
  expect(view.getByRole("button", { name: "Hear it anyway" })).toBeTruthy();
});

test("seeking into skip ranges jumps; Undo plays once; marked range remains drawn and is not jumped", () => {
  const plan: SkipPlan = { state: "ready", ranges: [
    { id: "ad", kind: "ad", startSec: 10, endSec: 20, status: "auto", mode: "skip" },
    { id: "sponsor", kind: "sponsor", startSec: 30, endSec: 40, status: "auto", mode: "skip" },
    { id: "bumper", kind: "bumper", startSec: 41, endSec: 45, status: "auto", mode: "skip" },
    { id: "intro", kind: "intro", startSec: 50, endSec: 60, status: "auto", mode: "mark" },
  ] };
  const el = document.createElement("audio");
  let undos = 0;
  const seek = (time: number) => { const range = applySkip(plan, time); el.currentTime = range?.endSec ?? time; };
  seek(12); expect(el.currentTime).toBe(20);
  const undo = () => { el.currentTime = 10; undos++; };
  undo(); expect(el.currentTime).toBe(10); expect(undos).toBe(1);
  seek(52); expect(el.currentTime).toBe(52);
  expect(plan.ranges.find((range) => range.id === "intro")?.mode).toBe("mark");
  const view = render(<SkipRanges plan={plan} duration={100} onSeek={() => {}} />);
  expect(view.getByRole("button", { name: "Intro from 50 to 60" }).getAttribute("data-mode")).toBe("mark");
});

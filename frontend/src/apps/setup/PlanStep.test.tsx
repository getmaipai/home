import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { PlanStep } from "./PlanStep";
import type { PlanWording } from "@/lib/api";

afterEach(cleanup);

const wording = (over: Partial<PlanWording> = {}): PlanWording => ({
  level: "moderate", headline: "Moderate setup for this computer", detail: "Fits.", gets: ["Chat with Home"],
  needsMemoryAnswer: false, sizeLine: "Download: 9 GB", diskLine: null, ...over,
});

describe("PlanStep", () => {
  test("shows the plan and installs on the button", async () => {
    const start = mock(async () => ({}));
    const done = mock(() => {});
    const view = render(<PlanStep readPlan={async () => ({ wording: wording() })} start={start} onInstalled={done} />);
    await view.findByText("Moderate setup for this computer");
    fireEvent.click(view.getByRole("button", { name: "Install and continue" }));
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
    expect(start).toHaveBeenCalledWith(undefined);
  });

  test("asks for graphics memory when it cannot be read, then re-reads the plan", async () => {
    const read = mock(async (gb?: number) => ({ wording: gb ? wording() : wording({ level: "unknown", headline: "How much graphics memory?", needsMemoryAnswer: true }) }));
    const view = render(<PlanStep readPlan={read} start={async () => ({})} onInstalled={() => {}} />);
    await view.findByText("How much graphics memory?");
    expect(view.queryByRole("button", { name: "Install and continue" })).toBeNull();
    fireEvent.click(view.getByRole("radio", { name: "24 GB" }));
    await view.findByText("Moderate setup for this computer");
    expect(read).toHaveBeenLastCalledWith(24);
  });

  test("a full disk blocks the button and says so", async () => {
    const view = render(<PlanStep readPlan={async () => ({ wording: wording({ diskLine: "Not enough room." }) })} start={async () => ({})} onInstalled={() => {}} />);
    await view.findByText("Not enough room.");
    expect(view.queryByRole("button", { name: "Install and continue" })).toBeNull();
  });

  test("a failed start shows the message and stays", async () => {
    const done = mock(() => {});
    const view = render(<PlanStep readPlan={async () => ({ wording: wording() })} start={async () => { throw new Error("The AI engine isn't answering yet."); }} onInstalled={done} />);
    await view.findByText("Moderate setup for this computer");
    fireEvent.click(view.getByRole("button", { name: "Install and continue" }));
    await view.findByText("The AI engine isn't answering yet.");
    expect(done).not.toHaveBeenCalled();
  });
});

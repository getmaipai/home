import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { InstallStrip } from "./InstallStrip";
import { ApiError, type InstallStatusView } from "@/lib/api";

afterEach(cleanup);
const status = (over: Partial<InstallStatusView>): InstallStatusView => ({
  state: "downloading", chatReady: false, complete: false, percent: 40, completedBytes: 4, totalBytes: 10,
  bytesPerSecond: null, etaSeconds: null, problem: null, items: [], ...over,
});
const show = (s: InstallStatusView) => render(<MemoryRouter><InstallStrip read={async () => s} /></MemoryRouter>);

describe("InstallStrip", () => {
  test("shows progress while downloading", async () => {
    const view = show(status({}));
    await view.findByTestId("install-strip");
    view.getByText("Downloading your AI");
  });
  test("shows the AI engine install step by step, with no byte counts", async () => {
    const view = show(status({ state: "installing_engine", stage: "building", stageLabel: "Building the AI engine", percent: 0, completedBytes: 0, totalBytes: 0 }));
    await view.findByText("Building the AI engine");
    expect(view.container.textContent).not.toContain(" of ");
  });
  test("a failed engine install shows its plain-words problem and Try again", async () => {
    const calls: string[] = [];
    const view = render(<MemoryRouter><InstallStrip read={async () => status({ state: "engine_failed", problem: "No network. Check the connection, then press Try again." })} retry={async () => { calls.push("retry"); }} /></MemoryRouter>);
    await view.findAllByText(/No network/);
    fireEvent.click(await view.findByRole("button", { name: /try again|retry/i }));
    await waitFor(() => expect(calls).toEqual(["retry"]));
  });
  test("says chat works when the starter has landed", async () => {
    const view = show(status({ state: "starter_ready", chatReady: true }));
    await view.findByText("Home can chat now. Better AI is still downloading");
  });
  test("shows the problem in plain words", async () => {
    const view = show(status({ state: "out_of_space", problem: "This computer ran out of room for the AI models. Free some space, then try again." }));
    await view.findAllByText(/ran out of room/);
  });
  test("renders nothing when nothing is installing or all has landed", async () => {
    for (const state of ["none", "ready"] as const) {
      const view = show(status({ state }));
      await new Promise((r) => setTimeout(r, 20));
      await waitFor(() => expect(view.queryByTestId("install-strip")).toBeNull());
      cleanup();
    }
  });

  test("Details is a link by default and hidden where it would dead-end", async () => {
    const withLink = show(status({}));
    await withLink.findByRole("link", { name: "Details" });
    cleanup();
    const view = render(<MemoryRouter><InstallStrip detailsHref={null} read={async () => status({})} /></MemoryRouter>);
    await view.findByTestId("install-strip");
    expect(view.queryByRole("link", { name: "Details" })).toBeNull();
  });

  test("a failed download's retry runs the given retry, and a refusal says what to do", async () => {
    const calls: string[] = [];
    const retry = async () => { calls.push("retry"); throw new ApiError("The AI engine isn't answering yet.", 409, undefined, "Wait a minute and press Check again."); };
    const view = render(<MemoryRouter><InstallStrip read={async () => status({ state: "failed", problem: "A download did not finish." })} retry={retry} /></MemoryRouter>);
    await view.findByTestId("install-strip");
    fireEvent.click(await view.findByRole("button", { name: /try again|retry/i }));
    await view.findByText("The AI engine isn't answering yet. Wait a minute and press Check again.");
    expect(calls).toEqual(["retry"]);
  });
});

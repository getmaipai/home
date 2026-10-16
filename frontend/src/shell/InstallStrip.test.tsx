import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { InstallStrip } from "./InstallStrip";
import type { InstallStatusView } from "@/lib/api";

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
});

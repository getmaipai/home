import { toastError, spyOnToast } from "../../tests/toastSpy";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api";
import { HUB_DOWN_LINE } from "@/lib/hubReachability";
import { useHubMutation } from "@/lib/useHubMutation";
import { renderWithQueryClient } from "../../tests/renderWithQueryClient";

spyOnToast();
afterEach(cleanup);
beforeEach(() => toastError.mockClear());

function Probe({ action, onDone }: { action: () => Promise<string>; onDone?: () => void }) {
  const mutation = useHubMutation({ verb: "save the thing", mutationFn: action, onSuccess: onDone });
  return <button disabled={mutation.busy} onClick={() => void mutation.run()}>Go</button>;
}

describe("useHubMutation", () => {
  test("a rejected action toasts the hub's words plus the next step, re-enables the control and skips onSuccess", async () => {
    let done = 0;
    const view = renderWithQueryClient(<Probe action={() => Promise.reject(new ApiError("That name is taken.", 409))} onDone={() => { done += 1; }} />);
    fireEvent.click(view.getByRole("button", { name: "Go" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("That name is taken. Check your connection and try again."));
    await waitFor(() => expect((view.getByRole("button", { name: "Go" }) as HTMLButtonElement).disabled).toBe(false));
    expect(done).toBe(0);
  });

  test("an unknown failure uses the verb fallback and an unreachable hub uses the restarting line", async () => {
    let mode: "odd" | "down" = "odd";
    const view = renderWithQueryClient(<Probe action={() => Promise.reject(mode === "odd" ? new Error("boom") : new TypeError("Failed to fetch"))} />);
    fireEvent.click(view.getByRole("button", { name: "Go" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Could not save the thing. Check your connection and try again."));
    mode = "down";
    fireEvent.click(view.getByRole("button", { name: "Go" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(`${HUB_DOWN_LINE} Check your connection and try again.`));
  });

  test("run never rethrows, and a second click while pending does not start a second call", async () => {
    let calls = 0;
    let release: () => void = () => {};
    const view = renderWithQueryClient(<Probe action={() => { calls += 1; return new Promise<string>((resolve) => { release = () => resolve("ok"); }); }} />);
    fireEvent.click(view.getByRole("button", { name: "Go" }));
    await waitFor(() => expect((view.getByRole("button", { name: "Go" }) as HTMLButtonElement).disabled).toBe(true));
    fireEvent.click(view.getByRole("button", { name: "Go" }));
    expect(calls).toBe(1);
    await act(async () => { release(); });
    await waitFor(() => expect((view.getByRole("button", { name: "Go" }) as HTMLButtonElement).disabled).toBe(false));
    expect(toastError).not.toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { api, ApiError, type AutoLocksSnapshot, type Roster } from "@/lib/api";
import { AutoLocksSection } from "@/apps/settings/AutoLocksSection";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";

afterEach(cleanup);
const owner = { id: "p1", display_name: "Sage", role: "owner" } as Roster;
const admin = { ...owner, role: "admin" } as Roster;
const snapshot = (candidates: number, last_run: AutoLocksSnapshot["last_run"] = null): AutoLocksSnapshot => ({ candidates, left_alone: { notLocked: 0, otherKind: 0, minorOwner: 0, personSet: 0, adultStyle: 0, labelledSource: 0, notSure: 0 }, last_run });

describe("AutoLocksSection", () => {
  test("shows the count and clear button", async () => {
    const originals = { autoLocks: api.autoLocks, clear: api.clearAutoLocks };
    api.autoLocks = mock(async () => snapshot(3)); api.clearAutoLocks = mock(async () => ({ run_id: "cleanup-00000000-0000-4000-8000-000000000000", changed: 3 }));
    try {
      const ui = renderWithQueryClient(<AutoLocksSection person={owner} />);
      expect(await ui.findByText("3 pictures were locked automatically.")).toBeTruthy();
      expect(ui.getByRole("button", { name: "Clear 3 locks" })).toBeTruthy();
    } finally { api.autoLocks = originals.autoLocks; api.clearAutoLocks = originals.clear; }
  });
  test("shows the zero line", async () => {
    const original = api.autoLocks; api.autoLocks = mock(async () => snapshot(0));
    try { const ui = renderWithQueryClient(<AutoLocksSection person={owner} />); expect(await ui.findByText("Nothing needs clearing. No picture was locked by Home on its own.")).toBeTruthy(); expect(ui.getByRole("button", { name: "Clear 0 locks" }).hasAttribute("disabled")).toBe(true); }
    finally { api.autoLocks = original; }
  });
  test("confirms, clears, and undoes", async () => {
    const originals = { autoLocks: api.autoLocks, clear: api.clearAutoLocks, undo: api.undoAutoLocks };
    api.autoLocks = mock(async () => snapshot(2)); api.clearAutoLocks = mock(async () => ({ run_id: "cleanup-00000000-0000-4000-8000-000000000000", changed: 2 })); api.undoAutoLocks = mock(async () => ({ restored: 2, changed_since: 1 }));
    try {
      const ui = renderWithQueryClient(<AutoLocksSection person={owner} />);
      fireEvent.click(await ui.findByRole("button", { name: "Clear 2 locks" }));
      expect(await ui.findByText("Clear 2 automatic locks? You can undo this right after.")).toBeTruthy();
      fireEvent.click(ui.getByRole("button", { name: "Clear locks" }));
      expect(await ui.findByText("Done. 2 pictures are visible again.")).toBeTruthy();
      fireEvent.click(ui.getByRole("button", { name: "Undo" }));
      expect(await ui.findByText("Undone. 2 pictures are locked again. 1 picture changed since.")).toBeTruthy();
    } finally { api.autoLocks = originals.autoLocks; api.clearAutoLocks = originals.clear; api.undoAutoLocks = originals.undo; }
  });
  test("a 409 refreshes the count", async () => {
    const originals = { autoLocks: api.autoLocks, clear: api.clearAutoLocks };
    let calls = 0; api.autoLocks = mock(async () => snapshot(++calls === 1 ? 3 : 1)); api.clearAutoLocks = mock(async () => { throw new ApiError("The number changed. Look again and confirm.", 409, "count_changed"); });
    try { const ui = renderWithQueryClient(<AutoLocksSection person={owner} />); fireEvent.click(await ui.findByRole("button", { name: "Clear 3 locks" })); fireEvent.click(ui.getByRole("button", { name: "Clear locks" })); expect(await ui.findByText("The number changed. Look again and confirm.")).toBeTruthy(); expect(await ui.findByText("1 picture was locked automatically.")).toBeTruthy(); }
    finally { api.autoLocks = originals.autoLocks; api.clearAutoLocks = originals.clear; }
  });
  test("shows failure with Try again", async () => {
    const originals = { autoLocks: api.autoLocks, clear: api.clearAutoLocks };
    api.autoLocks = mock(async () => snapshot(2)); api.clearAutoLocks = mock(async () => { throw new ApiError("The cleanup could not be saved. Look again and try once more.", 500, "cleanup_failed"); });
    try { const ui = renderWithQueryClient(<AutoLocksSection person={owner} />); fireEvent.click(await ui.findByRole("button", { name: "Clear 2 locks" })); fireEvent.click(ui.getByRole("button", { name: "Clear locks" })); expect(await ui.findByText("The cleanup could not be saved. Look again and try once more.")).toBeTruthy(); expect(ui.getByRole("button", { name: "Try again" })).toBeTruthy(); }
    finally { api.autoLocks = originals.autoLocks; api.clearAutoLocks = originals.clear; }
  });
  test("is not rendered for a non-owner", async () => {
    const original = api.autoLocks; api.autoLocks = mock(async () => snapshot(2));
    try { const ui = renderWithQueryClient(<AutoLocksSection person={admin} />); await waitFor(() => expect(ui.queryByText("Clear automatic locks")).toBeNull()); expect(api.autoLocks).not.toHaveBeenCalled(); }
    finally { api.autoLocks = original; }
  });
});

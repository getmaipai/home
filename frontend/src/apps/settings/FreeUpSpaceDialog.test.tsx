// AIMODELS-CLEAN-01: Free up space. List, select all, confirm, partial result, empty state.
import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { FreeUpSpaceDialog } from "@/apps/settings/FreeUpSpaceDialog";
import { aiChoicesApi, type CleanupResult, type UnusedList } from "@/lib/aiChoicesApi";
import { ApiError } from "@/lib/api";

afterEach(cleanup);

const GB = 1_000_000_000;
const list = (): UnusedList => ({
  total_bytes: 107 * GB,
  items: [
    { id: "ltx", name: "Detailed videos", bytes: 74 * GB, reason: "You use Quick videos and no saved style needs this.", lastUsedAt: null },
    { id: "zimage", name: "Detailed pictures", bytes: 33 * GB, reason: "Not used since August.", lastUsedAt: "2026-08-02T00:00:00Z" },
  ],
});

function mount(data: UnusedList | Error, cleanupAnswer?: CleanupResult | Error) {
  const original = { ...aiChoicesApi };
  aiChoicesApi.unused = mock(async () => { if (data instanceof Error) throw data; return data; });
  aiChoicesApi.cleanup = mock(async (ids: string[]) => { if (cleanupAnswer instanceof Error) throw cleanupAnswer; return cleanupAnswer ?? { results: ids.map((id) => ({ id, status: "removed" as const, freed_bytes: 1, message: "" })), freed_bytes: 1, kept: 0, failed: 0 }; });
  const onChanged = mock(() => {});
  const view = renderWithQueryClient(<FreeUpSpaceDialog open onOpenChange={() => {}} onChanged={onChanged} />);
  return { ...view, onChanged, restore: () => Object.assign(aiChoicesApi, original) };
}

describe("Free up space", () => {
  test("lists each unused part with its plain name, size and reason, nothing preselected", async () => {
    const v = mount(list());
    expect(await v.findByText("You can free 107 GB. Nothing is removed until you pick it and confirm.")).toBeTruthy();
    const row = v.getByTestId("unused-zimage");
    expect(within(row).getByText("Detailed pictures")).toBeTruthy();
    expect(within(row).getByText(/33 GB\. Not used since August\./)).toBeTruthy();
    expect(v.getAllByRole("checkbox").every((box) => box.getAttribute("aria-checked") === "false")).toBe(true);
    expect((v.getByRole("button", { name: "Pick what to remove" }) as HTMLButtonElement).disabled).toBe(true);
    v.restore();
  });

  test("Select all ticks every row and the button says how many and how much", async () => {
    const v = mount(list());
    await v.findByText(/You can free/);
    fireEvent.click(v.getByRole("button", { name: "Select all" }));
    expect(await v.findByRole("button", { name: "Remove 2 and free 107 GB" })).toBeTruthy();
    fireEvent.click(v.getByRole("button", { name: "Clear all" }));
    expect(await v.findByRole("button", { name: "Pick what to remove" })).toBeTruthy();
    v.restore();
  });

  test("picking one row totals only that row, and the confirm names it, its size and the backup line", async () => {
    const v = mount(list());
    await v.findByText(/You can free/);
    fireEvent.click(within(v.getByTestId("unused-zimage")).getByRole("checkbox"));
    fireEvent.click(await v.findByRole("button", { name: "Remove 1 and free 33 GB" }));
    expect(await v.findByText("Remove Detailed pictures?")).toBeTruthy();
    expect(v.getByText(/Backups are not affected/)).toBeTruthy();
    expect(v.getByText(/same size, 33 GB, and your settings stay/)).toBeTruthy();
    v.restore();
  });

  test("confirming removes the picked ids once, reports the freed space and tells the page", async () => {
    const v = mount(list(), { results: [{ id: "zimage", status: "removed", freed_bytes: 33 * GB, message: "" }], freed_bytes: 33 * GB, kept: 0, failed: 0 });
    await v.findByText(/You can free/);
    fireEvent.click(within(v.getByTestId("unused-zimage")).getByRole("checkbox"));
    fireEvent.click(await v.findByRole("button", { name: /^Remove 1 and free/ }));
    fireEvent.click(await v.findByRole("button", { name: "Remove" }));
    expect(await v.findByText("Freed 33 GB.")).toBeTruthy();
    expect((aiChoicesApi.cleanup as ReturnType<typeof mock>).mock.calls[0]).toEqual([["zimage"]]);
    await waitFor(() => expect(v.onChanged).toHaveBeenCalledTimes(1));
    v.restore();
  });

  test("a press on the confirm (outside the first dialog) does not dismiss it, so Remove and Keep them work", async () => {
    const onOpenChange = mock(() => {});
    const original = { ...aiChoicesApi };
    aiChoicesApi.unused = mock(async () => list());
    aiChoicesApi.cleanup = mock(async (ids: string[]) => ({ results: ids.map((id) => ({ id, status: "removed" as const, freed_bytes: 1, message: "" })), freed_bytes: 1, kept: 0, failed: 0 }));
    const v = renderWithQueryClient(<FreeUpSpaceDialog open onOpenChange={onOpenChange} />);
    await v.findByText(/You can free/);
    fireEvent.click(within(v.getByTestId("unused-zimage")).getByRole("checkbox"));
    fireEvent.click(await v.findByRole("button", { name: /^Remove 1 and free/ }));
    const remove = await v.findByRole("button", { name: "Remove" });
    fireEvent.pointerDown(remove);
    fireEvent.click(remove);
    expect(await v.findByText(/Freed/)).toBeTruthy();
    expect((aiChoicesApi.cleanup as ReturnType<typeof mock>).mock.calls.length).toBe(1);
    expect(onOpenChange).not.toHaveBeenCalled();
    Object.assign(aiChoicesApi, original);
  });

  test("a partial result says what was kept because it is in use now, and what did not finish", async () => {
    const v = mount(list(), { results: [{ id: "ltx", status: "kept", freed_bytes: 0, message: "Detailed videos is in use now, so it was kept." }, { id: "zimage", status: "failed", freed_bytes: 0, message: "x" }], freed_bytes: 0, kept: 1, failed: 1 });
    await v.findByText(/You can free/);
    fireEvent.click(v.getByRole("button", { name: "Select all" }));
    fireEvent.click(await v.findByRole("button", { name: /^Remove 2 and free/ }));
    fireEvent.click(await v.findByRole("button", { name: "Remove" }));
    expect(await v.findByText("Nothing was removed.")).toBeTruthy();
    expect(v.getByText(/1 kept because it is in use\./)).toBeTruthy();
    expect(v.getByText(/1 did not finish\. Try again\./)).toBeTruthy();
    expect(v.getByText(/Detailed videos is in use now, so it was kept\./)).toBeTruthy();
    v.restore();
  });

  test("nothing unused is said plainly, with no remove button", async () => {
    const v = mount({ items: [], total_bytes: 0 });
    expect(await v.findByText("Everything installed is in use.")).toBeTruthy();
    expect(v.queryByRole("button", { name: /^Remove/ })).toBeNull();
    expect(v.queryByRole("button", { name: "Select all" })).toBeNull();
    v.restore();
  });

  test("a list that fails to load shows the destructive Alert with the next step", async () => {
    const v = mount(new ApiError("The engine isn't answering. Check that the engine is running, then try again.", 503));
    expect(await v.findByText("The list did not load")).toBeTruthy();
    expect(v.getByText(/engine isn't answering/)).toBeTruthy();
    v.restore();
  });
});

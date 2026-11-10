import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { DropdownMenu, DropdownMenuTrigger } from "@maipai/ui/src/ui/dropdown-menu";
import { itemMenu } from "@/shell/library/LibraryItems";
import type { LibraryItem, Roster } from "@/lib/api";

afterEach(cleanup);
const base = {
  id: "video-1", name: "Home video", kind: "video", media_type: "video/mp4", size_bytes: 128, created_at: "2026-11-01T00:00:00Z",
  owner: { id: "owner-1", display_name: "Owner" }, shared_with: { count: 0, household: false }, retention: "kept", origin: "made",
} as unknown as LibraryItem;
const me = { id: "owner-1", role: "owner", age_band: "adult" } as unknown as Roster;
const adult = (can_mark: boolean, can_clear: boolean) => ({ ...base, adult: { made_audience: "all-ages", lock: "off", can_clear, can_mark, line: null, history: [] } }) as LibraryItem;

function open(item: LibraryItem, viewer: Roster, adultMark = () => {}, adultUnmark = () => {}) {
  const actions = { open: () => {}, rename: () => {}, keep: () => {}, share: () => {}, trash: () => {}, recheck: () => {}, adultMark, adultUnmark };
  return render(<DropdownMenu open><DropdownMenuTrigger>menu</DropdownMenuTrigger>{itemMenu(item, viewer, actions)}</DropdownMenu>);
}

describe("Library item menu: adult lock", () => {
  test("an all-ages video the owner can mark offers Mark as NSFW, and picking it calls adultMark", () => {
    const marked = mock(() => {});
    const view = open(adult(true, false), me, marked);
    expect(view.queryByText("Unmark as NSFW")).toBeNull();
    view.getByText("Mark as NSFW").click();
    expect(marked).toHaveBeenCalledTimes(1);
  });
  test("a locked video offers Unmark as NSFW only", () => {
    const view = open(adult(false, true), me);
    expect(view.queryByText("Mark as NSFW")).toBeNull();
    expect(view.queryByText("Unmark as NSFW")).toBeTruthy();
  });
  test("someone else's video and an item with no lock state offer neither", () => {
    const other = open(adult(true, true), { ...me, id: "person-2" } as Roster);
    expect(other.queryByText("Mark as NSFW")).toBeNull();
    cleanup();
    const none = open(base, me);
    expect(none.queryByText("Mark as NSFW")).toBeNull();
    expect(none.queryByText("Unmark as NSFW")).toBeNull();
  });
});

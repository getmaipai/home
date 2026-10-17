import { describe, expect, test, mock } from "bun:test";
import { createDragTracker, dragHasFiles } from "./composerFileDrop";

describe("chat file drop", () => {
  test("only a drag that carries files counts", () => {
    expect(dragHasFiles({ types: ["Files"] } as unknown as DataTransfer)).toBe(true);
    expect(dragHasFiles({ types: ["text/plain", "text/uri-list"] } as unknown as DataTransfer)).toBe(false);
    expect(dragHasFiles(null)).toBe(false);
  });

  test("child enter/leave does not flicker the hint", () => {
    const show = mock(() => {});
    const hide = mock(() => {});
    const t = createDragTracker(show, hide);
    t.enter(); t.enter(); t.leave(false);
    expect(show).toHaveBeenCalledTimes(1);
    expect(hide).not.toHaveBeenCalled();
    t.leave(false);
    expect(hide).toHaveBeenCalledTimes(1);
  });

  test("leaving the window or dropping hides it at once", () => {
    const show = mock(() => {});
    const hide = mock(() => {});
    const t = createDragTracker(show, hide);
    t.enter(); t.enter(); t.leave(true);
    expect(hide).toHaveBeenCalledTimes(1);
    t.enter(); t.reset();
    expect(hide).toHaveBeenCalledTimes(2);
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import { readAmbientPaneState } from "@/shell/AmbientCompanionPane";

afterEach(() => localStorage.removeItem("maipai.ambient.pane"));

describe("ambient pane persistence", () => {
  test("restores an open and pinned pane", () => {
    localStorage.setItem("maipai.ambient.pane", JSON.stringify({ open: true, pinned: true }));
    expect(readAmbientPaneState()).toEqual({ open: true, pinned: true });
  });

  test("uses the closed default for invalid stored data", () => {
    localStorage.setItem("maipai.ambient.pane", "not-json");
    expect(readAmbientPaneState()).toEqual({ open: false, pinned: false });
  });
});

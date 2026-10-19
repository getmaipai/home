import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { NameCell } from "@/shell/library/LibraryItems";
import type { LibraryItem } from "@/lib/api";

const item = (kind: string, thumb_url: string): LibraryItem => ({ id: "i1", name: "Holiday", kind, thumb_url } as unknown as LibraryItem);

afterEach(() => cleanup());

describe("library name cell thumbnail", () => {
  test("a thumbnail that loads is shown as the picture", () => {
    const view = render(<NameCell item={item("image", "/thumb/1.jpg")} />);
    expect(view.container.querySelector("img[src='/thumb/1.jpg']")).not.toBeNull();
    expect(view.container.querySelector("[data-slot='safe-image-fallback']")).toBeNull();
  });
  test("a failing thumbnail shows the placeholder for its kind", () => {
    for (const [kind, expected] of [["image", "picture"], ["video", "video"], ["audio", "music"]] as const) {
      const view = render(<NameCell item={item(kind, "/thumb/gone.jpg")} />);
      fireEvent.error(view.container.querySelector("img")!);
      expect(view.container.querySelector("img")).toBeNull();
      expect(view.container.querySelector(`[data-slot='safe-image-fallback'][data-kind='${expected}']`)).not.toBeNull();
      view.unmount();
    }
  });
  test("a document has no thumbnail and shows the file placeholder", () => {
    const view = render(<NameCell item={item("document", "")} />);
    expect(view.container.querySelector("img")).toBeNull();
    expect(view.container.querySelector("[data-slot='safe-image-fallback'][data-kind='file']")).not.toBeNull();
  });
});

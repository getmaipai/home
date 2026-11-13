import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import type { MediaHomeRow } from "@/lib/api";
import { tilePicture } from "@/shell/pages/dashboard/HomeShelves";
import { MediaShelf } from "@maipai/ui/src/primitives/MediaShelf";

afterEach(cleanup);

const row = (over: Partial<MediaHomeRow>): MediaHomeRow => ({ id: "r", app: "video", kind: "video", title: "T", subtitle: null, artwork_url: null, href: "/x", percent: null, at: "2026-11-07T00:00:00Z", ...over });
const iconOf = (picture: ReturnType<typeof tilePicture>) => {
  const view = render(picture);
  return view.container.querySelector("[data-slot=safe-image-fallback] svg")?.getAttribute("class") ?? "";
};

describe("a Home shelf tile with no picture (AUDIT-UI-01)", () => {
  test("a conversation shows a chat bubble, not the film strip of the videos app it rides under", () => {
    expect(iconOf(tilePicture(row({ kind: "chat" })))).toContain("message-circle");
  });
  test("a clip shows a film and a song shows a note", () => {
    expect(iconOf(tilePicture(row({ kind: "video", app: "video" })))).toContain("film");
    cleanup();
    expect(iconOf(tilePicture(row({ kind: "song", app: "audio" })))).toContain("music");
  });
  test("the missing art is seeded and leaves the shelf overlay to draw the title", () => {
    const view = render(tilePicture(row({ title: "Lantern Road" })));
    expect(view.container.querySelector('[data-slot="safe-image-fallback"]')?.getAttribute("data-tinted")).toBe("");
    expect(view.queryByText("Lantern Road")).toBeNull();
  });
});

test("the kit exposes pro square tiles for Home shelves", () => {
  const view = render(<MediaShelf items={[row({})]} getKey={(item) => item.id} getLabel={(item) => item.title} renderItem={() => <span>art</span>} heading="Continue" variant="plain" tileSize="pro" />);
  expect(view.container.querySelector('[data-slot="media-shelf"]')?.textContent).toContain("art");
  expect(view.container.querySelector(".aspect-square")).not.toBeNull();
});

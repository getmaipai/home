import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import type { MediaHomeRow } from "@/lib/api";
import { tilePicture } from "@/shell/pages/dashboard/HomeShelves";

afterEach(cleanup);

const row = (over: Partial<MediaHomeRow>): MediaHomeRow => ({ id: "r", app: "videos", kind: "video", title: "T", subtitle: null, artwork_url: null, href: "/x", percent: null, at: "2026-11-07T00:00:00Z", ...over });
const iconOf = (picture: ReturnType<typeof tilePicture>) => {
  const view = render(picture);
  return view.container.querySelector("[data-slot=safe-image-fallback] svg")?.getAttribute("class") ?? "";
};

describe("a Home shelf tile with no picture (AUDIT-UI-01)", () => {
  test("a conversation shows a chat bubble, not the film strip of the videos app it rides under", () => {
    expect(iconOf(tilePicture(row({ kind: "chat" })))).toContain("message-circle");
  });
  test("a clip shows a film and a song shows a note", () => {
    expect(iconOf(tilePicture(row({ kind: "video", app: "videos" })))).toContain("film");
    cleanup();
    expect(iconOf(tilePicture(row({ kind: "song", app: "music" })))).toContain("music");
  });
});

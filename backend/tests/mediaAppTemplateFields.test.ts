import { expect, test } from "bun:test";
import { safeTemplateFields } from "@/lib/media/appHost";

test("media page template fields never stay null when a shelf reads them", () => {
  expect(safeTemplateFields([
    { id: "file-one", title: "Made clip", channel: null },
    { id: "media-two", title: "Folder clip", channel: "Home videos" },
    { id: "media-three", title: "Untitled", channel: undefined },
  ])).toEqual([
    { id: "file-one", title: "Made clip", channel: "" },
    { id: "media-two", title: "Folder clip", channel: "Home videos" },
    { id: "media-three", title: "Untitled", channel: "" },
  ]);
});

import { describe, expect, test } from "bun:test";
import { contextTitleFor } from "./PackageAppPage";

describe("the app title inside a sidebar app (NEWS-ARTICLE-PANE-01)", () => {
  test("the chosen row names where the person is: a topic, a source, Saved", () => {
    expect(contextTitleFor("Science", "Channel")).toBe("Science");
    expect(contextTitleFor("BBC", "Channel")).toBe("BBC");
    expect(contextTitleFor("Saved", "Saved")).toBe("Saved");
  });
  test("with no chosen row the page's own title stands, unless it only names a kind of page", () => {
    expect(contextTitleFor(undefined, "Following")).toBe("Following");
    expect(contextTitleFor(undefined, "Search")).toBe("Search");
    expect(contextTitleFor(undefined, "Story")).toBeUndefined();
    expect(contextTitleFor(undefined, "Channel")).toBeUndefined();
    expect(contextTitleFor(undefined, undefined)).toBeUndefined();
  });
});

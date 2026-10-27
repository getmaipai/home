import { describe, expect, test } from "bun:test";
import { companionImageUrl } from "@/apps/chat/companionImage";

describe("companionImageUrl", () => {
  test("a portrait key wins over the still", () => {
    expect(companionImageUrl("hc-one/v3", "/still.png")).toBe("/api/companions/portraits/hc-one/v3");
  });
  test("without a portrait the still is used, and with neither there is no image", () => {
    expect(companionImageUrl(null, "/still.png")).toBe("/still.png");
    expect(companionImageUrl(undefined, undefined)).toBeUndefined();
  });
  test("a malformed portrait key falls back to the still instead of throwing", () => {
    expect(companionImageUrl("not-a-key", "/still.png")).toBe("/still.png");
    expect(companionImageUrl("a/b/c", undefined)).toBeUndefined();
  });
});

import { expect, test } from "bun:test";
import { feedImageAddress, isSiteArt } from "@/lib/shelf/imageAddress";

test("numeric entities in a feed address decode, so the query is not cut to a fragment", () => {
  expect(feedImageAddress("https://platform.example.com/a.jpg?quality=90&#038;strip=all")).toBe("https://platform.example.com/a.jpg?quality=90&strip=all");
});

test("site icons, logos and small topic badges are not a story's picture", () => {
  expect(isSiteArt("https://a.example.com/sd/twitter_icon_large.png")).toBe(true);
  expect(isSiteArt("https://a.example.com/sd/topics/gnu_64.png")).toBe(true);
  expect(isSiteArt("https://a.example.com/images/site-logo.svg")).toBe(true);
  expect(isSiteArt("https://ichef.example.com/ace/standard/976/cpsprodpb/7506/live/63f2d5e0.jpg")).toBe(false);
});

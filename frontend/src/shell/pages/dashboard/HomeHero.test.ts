import { describe, expect, test } from "bun:test";
import { chooseHomeHero } from "./HomeHero";
import type { MediaHomeRow } from "@/lib/api";

const made = (id: string): MediaHomeRow => ({ id, app: "video", kind: "video", title: id, subtitle: null, artwork_url: `/art/${id}`, href: `/media/${id}`, percent: null, at: "2026-11-11T12:00:00Z" });

describe("Home hero choice", () => {
  test("uses newest made item before companion, companion before nothing", () => {
    expect(chooseHomeHero([made("latest")], { id: "friend", name: "Friend", portrait: "friend/v1" })?.kind).toBe("made");
    expect(chooseHomeHero([], { id: "friend", name: "Friend" })).toMatchObject({ kind: "companion", title: "Friend" });
    expect(chooseHomeHero([], null)).toBeNull();
  });
  test("a child gets the companion portrait even when made media exists", () => {
    expect(chooseHomeHero([made("latest")], { id: "friend", name: "Friend", portrait: "friend/v1" }, true)).toMatchObject({ kind: "companion", title: "Friend", art: "/api/companions/portraits/friend/v1" });
  });
});

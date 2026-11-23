import { afterEach, expect, spyOn, test } from "bun:test";
import { api } from "@/lib/api";
import { searchWithCoreApps } from "@/shell/phoneMenuLinks";

afterEach(() => { spyOn(api, "search").mockRestore?.(); });

const groups = [
  { kind: "conversation", heading: "Chats", results: [{ kind: "conversation", id: "c1", title: "Chat with Rivet", href: "/chat?conversation=c1" }] },
  { kind: "memory", heading: "Memories", results: [{ kind: "memory", id: "m1", title: "Likes tea", href: "/memories" }] },
  { kind: "person", heading: "People", results: [{ kind: "person", id: "p1", title: "Marlow", href: "/people/p1" }] },
];

test("the header search lists chats and memories when Incognito is off", async () => {
  spyOn(api, "search").mockResolvedValue(groups as never);
  const found = await searchWithCoreApps("rivet", []);
  expect(found.map((group) => group.kind)).toEqual(["conversation", "memory", "person"]);
});

test("the header search never surfaces stored chats or memories while Incognito is on", async () => {
  spyOn(api, "search").mockResolvedValue(groups as never);
  const found = await searchWithCoreApps("rivet", [], true);
  expect(found.map((group) => group.kind)).toEqual(["person"]);
});

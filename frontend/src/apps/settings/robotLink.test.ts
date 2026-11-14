import { expect, test } from "bun:test";
import { linkLine, linkStateLine } from "@/apps/settings/robotLink";

test("says in plain words how the robot is connected", () => {
  expect(linkLine({ online: true, link_path: "home" })).toBe("Connected at home");
  expect(linkLine({ online: true, link_path: "away" })).toBe("Connected away from home (through your laptop)");
  expect(linkLine({ online: true, link_path: "other" })).toBe("Connected over the internet");
  expect(linkLine({ online: true, link_path: null })).toBeNull();
  expect(linkLine(null)).toBeNull();
});

test("an offline robot says since when, from the check-in or the device's last seen", () => {
  expect(linkLine({ online: false, lastSeen: "2026-11-14T19:10:00Z" })).toMatch(/^Offline since /);
  expect(linkLine({ online: false }, "2026-11-14T19:10:00Z")).toMatch(/^Offline since /);
  expect(linkLine({ online: false })).toBe("Offline");
});

test("the unit's own link state is explained, and a normal connection says nothing", () => {
  expect(linkStateLine("ws_retry", 3)).toBe("The robot is reconnecting to the hub (try 3)");
  expect(linkStateLine("ws_down")).toBe("The robot is reconnecting to the hub");
  expect(linkStateLine("ws_fallback")).toBe("The robot is trying the laptop relay");
  expect(linkStateLine("ws_refused")).toContain("refused");
  expect(linkStateLine("ws_up")).toBeNull();
  expect(linkStateLine(null)).toBeNull();
});

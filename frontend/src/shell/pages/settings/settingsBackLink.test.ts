import { afterEach, describe, expect, test } from "bun:test";
import { activeAppHref, lastAppRoute, rememberLastAppRoute } from "./settingsBackLink";

afterEach(() => window.sessionStorage.clear());

describe("settings Back to app route", () => {
  test("remembers the latest app route including query and hash", () => {
    rememberLastAppRoute("/people/p1?tab=memory#recent");
    rememberLastAppRoute("/settings/chat/general");
    expect(lastAppRoute()).toBe("/people/p1?tab=memory#recent");
  });

  test("falls back to chat when no app route has been remembered", () => {
    expect(lastAppRoute()).toBe("/chat");
  });

  test("keeps one app selected across settings routes", () => {
    expect(activeAppHref("/settings/chat/general")).toBe("/chat");
    expect(activeAppHref("/status")).toBe("/");
    rememberLastAppRoute("/people/person-sage?tab=memories");
    expect(activeAppHref("/settings/account/profile")).toBe("/people");
    expect(activeAppHref("/settings/home/general")).toBe("/people");
  });
});

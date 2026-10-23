import { afterEach, describe, expect, test } from "bun:test";
import { activeAppHref, lastAppRoute, rememberLastAppRoute } from "./settingsBackLink";

afterEach(() => window.sessionStorage.clear());

describe("settings Back to app route", () => {
  test("remembers the latest app route including query and hash", () => {
    rememberLastAppRoute("/people/p1?tab=memory#recent");
    rememberLastAppRoute("/settings/chat?tab=general");
    expect(lastAppRoute()).toBe("/people/p1?tab=memory#recent");
  });

  test("falls back to chat when no app route has been remembered", () => {
    expect(lastAppRoute()).toBe("/chat");
  });

  test("keeps one app selected across settings routes", () => {
    expect(activeAppHref("/settings/chat?tab=general")).toBe("/chat");
    expect(activeAppHref("/status")).toBe("/");
    rememberLastAppRoute("/people/person-sage?tab=memories");
    expect(activeAppHref("/settings/profile?tab=profile")).toBe("/people");
    expect(activeAppHref("/settings/household?tab=general")).toBe("/people");
  });
});

import { activeAppHref as activeAppHrefForApps } from "./settingsBackLink";
test("LEFTNAV-APPS-01: a package app and its sections select their own rail icon, not Home", () => {
  expect(activeAppHrefForApps("/apps/weather")).toBe("/apps/weather");
  expect(activeAppHrefForApps("/apps/weather/forecast")).toBe("/apps/weather");
  expect(activeAppHrefForApps("/applications")).toBe("/");
});

import { backLabelFor } from "./settingsBackLink";
test("COLUMN-UNIFY-01: the settings back link names the app the person came from", () => {
  expect(backLabelFor("/chat")).toBe("Chat");
  expect(backLabelFor("/chat?conversation=c1")).toBe("Chat");
  expect(backLabelFor("/apps/news/story", { news: "News" })).toBe("News");
  expect(backLabelFor("/apps/unknown")).toBe("Back");
  expect(backLabelFor("/files?section=all")).toBe("Library");
  expect(backLabelFor("/")).toBe("Home");
  expect(backLabelFor("/status")).toBe("Back");
});

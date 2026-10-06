import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { buildTabIdentity } from "@/shell/tabIdentity";
import { useTabItem } from "@/shell/tabIdentity";

describe("tab identity privacy", () => {
  test("temporary chat title never exposes the thread title", () => {
    const identity = buildTabIdentity({
      pageName: "Chat",
      chatTitle: "secret plans",
      temporary: true,
      ageBand: "adult",
      locked: false,
      status: { level: "online", text: "All good" },
    });
    expect(identity.title).toBe("Private chat - MaiPai Home");
    expect(identity.title).not.toContain("secret plans");
  });

  test("child chat titles and status are hidden", () => {
    expect(buildTabIdentity({ pageName: "Chat", chatTitle: "secret plans", ageBand: "child", status: { level: "offline", text: "Something is down" } }).title)
      .toBe("Chat - MaiPai Home");
  });

  test("locked session uses the bare hub title", () => {
    expect(buildTabIdentity({ pageName: "Chat", chatTitle: "secret plans", locked: true }).title).toBe("MaiPai Home");
  });

  test("status prefixes use the existing status summary wording", () => {
    expect(buildTabIdentity({ pageName: "New chat", status: { level: "degraded", text: "Chat paused" } }).title)
      .toBe("Paused - New chat - MaiPai Home");
    expect(buildTabIdentity({ pageName: "Settings", status: { level: "degraded", text: "Degraded" } }).title)
      .toBe("Attention - Settings - MaiPai Home");
    expect(buildTabIdentity({ pageName: "Settings", status: { level: "offline", text: "Something is down" } }).title)
      .toBe("Down - Settings - MaiPai Home");
  });

  test("item text is normalized and capped at 40 characters", () => {
    expect(buildTabIdentity({ pageName: "A\u0000   page with an item name that is much longer than forty characters" }).title)
      .toBe("A page with an item name that is much l… - MaiPai Home");
  });
});

test("a shell-less page keeps Incognito private from the session cache", () => {
  function StandalonePage() {
    useTabItem("Enroll person");
    return null;
  }
  const oldTitle = document.title;
  sessionStorage.setItem("maipai.incognito", "1");
  const view = render(createElement(MemoryRouter, null, createElement(StandalonePage)));
  expect(document.title).toBe("Private chat - MaiPai Home");
  view.unmount();
  sessionStorage.removeItem("maipai.incognito");
  expect(document.title).toBe(oldTitle);
});

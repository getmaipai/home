import { beforeEach, describe, expect, test } from "bun:test";
import { listStatusApps } from "@/lib/appNeeds";
import { setHouseholdSettingValue } from "@/lib/settings";
import { resetDb } from "./reset-db";

beforeEach(() => resetDb());

describe("status app service needs", () => {
  test("Chat does not claim SearXNG when the integration is not configured", () => {
    const chat = listStatusApps().find((app) => app.id === "chat")!;
    expect(chat.needs.some((need) => need.kind === "service" && need.id === "searxng")).toBe(false);
  });

  test("Chat includes SearXNG once web search is configured", () => {
    setHouseholdSettingValue("search.searxng_url", "http://127.0.0.1:8888");
    const chat = listStatusApps().find((app) => app.id === "chat")!;
    expect(chat.needs.filter((need) => need.kind === "service" && need.id === "searxng")).toHaveLength(1);
  });
});

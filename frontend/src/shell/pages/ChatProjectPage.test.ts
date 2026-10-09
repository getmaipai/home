import { describe, expect, test } from "bun:test";
import type { ConversationSummary } from "@/lib/api";
import { projectConversationRows, projectSourcesVisible } from "./ChatProjectPage";

const row = (id: string, overrides: Partial<ConversationSummary> = {}) => ({
  id,
  surface: "chat",
  folder_id: "project-a",
  archived: false,
  title: id,
  created_at: "2026-10-01T00:00:00.000Z",
  last_turn_at: null,
  preview: null,
  ...overrides,
}) as ConversationSummary;

describe("PROJECTS-UI-04 project page data", () => {
  test("shows only active chats in this project, newest first", () => {
    const rows = projectConversationRows([
      row("older", { last_turn_at: "2026-10-02T00:00:00.000Z" }),
      row("newest", { last_turn_at: "2026-10-06T00:00:00.000Z" }),
      row("other-project", { folder_id: "project-b" }),
      row("archived", { archived: true }),
      row("artifact", { surface: "artifact" }),
    ], "project-a");
    expect(rows.map((item) => item.id)).toEqual(["newest", "older"]);
  });

  test("keeps Sources hidden for children until project files are enabled", () => {
    expect(projectSourcesVisible("child")).toBe(false);
    expect(projectSourcesVisible("child", true)).toBe(true);
    expect(projectSourcesVisible("admin")).toBe(true);
  });
});

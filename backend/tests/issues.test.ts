import { describe, expect, test, beforeEach } from "bun:test";
import { resetDb } from "./reset-db";
import {
  raiseIssue,
  resolveIssue,
  listIssues,
  fixIssue,
  dismissIssue,
  registerFixHandler,
  __resetFixHandlersForTests,
} from "@/lib/issues";
import { listPending } from "@/lib/notifications";
import { db } from "@/db";
import { people } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { PersonRow } from "@/types";

beforeEach(() => {
  resetDb();
  __resetFixHandlersForTests();
});

async function owner(): Promise<PersonRow> {
  const { TestClient } = await import("./client");
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  return db.select().from(people).where(eq(people.displayName, "Sage")).get()! as PersonRow;
}

describe("raiseIssue()", () => {
  test("creates a new open issue, wire-shaped like the spec (snake_case)", async () => {
    const issue = await raiseIssue({
      source: "backup",
      key: "no_offsite_target",
      severity: "warning",
      title: "No offsite backup target",
      detail: "Backups are only saved on this machine.",
    });
    expect(issue.resolved_at).toBeNull();
    expect(issue.dismissed_at).toBeNull();
    expect(issue.severity).toBe("warning");
    expect(listIssues()).toHaveLength(1);
  });

  test("raising the same (source, key) again updates the existing row instead of duplicating it", async () => {
    const first = await raiseIssue({ source: "backup", key: "no_offsite_target", severity: "warning", title: "A", detail: "a" });
    const second = await raiseIssue({ source: "backup", key: "no_offsite_target", severity: "error", title: "B", detail: "b" });
    expect(second.id).toBe(first.id);
    expect(second.title).toBe("B");
    expect(second.severity).toBe("error");
    expect(listIssues()).toHaveLength(1);
  });

  test("preserves the original created_at across a refresh", async () => {
    const first = await raiseIssue({ source: "backup", key: "k", severity: "warning", title: "A", detail: "a" });
    const second = await raiseIssue({ source: "backup", key: "k", severity: "warning", title: "A2", detail: "a2" });
    expect(second.created_at).toBe(first.created_at);
  });

  test("resolving then raising the same (source, key) again reopens the same row", async () => {
    const first = await raiseIssue({ source: "engine", key: "oom", severity: "error", title: "A", detail: "a" });
    resolveIssue("engine", "oom");
    expect(listIssues()).toHaveLength(0);
    const reopened = await raiseIssue({ source: "engine", key: "oom", severity: "error", title: "A", detail: "a" });
    expect(reopened.id).toBe(first.id);
    expect(reopened.resolved_at).toBeNull();
    expect(listIssues()).toHaveLength(1);
    expect(listIssues({ includeResolved: true })).toHaveLength(1);
  });

  test("an error severity fires the repairs.new notification to adults, once, on the open transition", async () => {
    const person = await owner();
    await raiseIssue({ source: "engine", key: "oom", severity: "error", title: "Model crashed", detail: "d" });
    expect(listPending(person)).toHaveLength(1);
    expect(listPending(person)[0]!.text).toBe("Model crashed");

    // Re-raising the same still-open error must not notify again.
    await raiseIssue({ source: "engine", key: "oom", severity: "error", title: "Model crashed", detail: "d2" });
    expect(listPending(person)).toHaveLength(1);
  });

  test("info and warning severities never notify", async () => {
    const person = await owner();
    await raiseIssue({ source: "backup", key: "k", severity: "warning", title: "T", detail: "d" });
    expect(listPending(person)).toHaveLength(0);
  });

  // The bug a 2026-09-06 code review found: dismissing a still-broken
  // issue used to reuse resolved_at, so the source's own next routine
  // recheck (raiseIssue() called again, unconditionally, because the
  // problem is still there) reopened it and re-notified - defeating the
  // dismiss a person had just performed.
  describe("a dismissed-but-not-resolved issue", () => {
    test("stays dismissed across a repeated raise (the source rechecking and finding it still broken)", async () => {
      const issue = await raiseIssue({ source: "backup", key: "no_offsite", severity: "warning", title: "T", detail: "d" });
      dismissIssue(issue.id);
      expect(listIssues()).toHaveLength(0);

      const rechecked = await raiseIssue({ source: "backup", key: "no_offsite", severity: "warning", title: "T", detail: "d" });
      expect(rechecked.dismissed_at).not.toBeNull();
      expect(listIssues()).toHaveLength(0);
    });

    test("does not re-notify on a repeated raise while dismissed, even for error severity", async () => {
      const person = await owner();
      const issue = await raiseIssue({ source: "engine", key: "oom", severity: "error", title: "Model crashed", detail: "d" });
      expect(listPending(person)).toHaveLength(1);
      dismissIssue(issue.id);

      await raiseIssue({ source: "engine", key: "oom", severity: "error", title: "Model crashed", detail: "d" });
      expect(listPending(person)).toHaveLength(1);
    });

    test("clears once the source calls resolveIssue() for real, and a later raise is treated as fresh", async () => {
      const issue = await raiseIssue({ source: "backup", key: "no_offsite", severity: "warning", title: "T", detail: "d" });
      dismissIssue(issue.id);
      resolveIssue("backup", "no_offsite");

      const reopened = await raiseIssue({ source: "backup", key: "no_offsite", severity: "warning", title: "T", detail: "d" });
      expect(reopened.dismissed_at).toBeNull();
      expect(listIssues()).toHaveLength(1);
    });
  });
});

describe("resolveIssue()", () => {
  test("is a no-op when nothing was raised under that (source, key)", () => {
    expect(() => resolveIssue("nobody", "nothing")).not.toThrow();
  });

  test("is a no-op when already resolved", async () => {
    await raiseIssue({ source: "backup", key: "k", severity: "info", title: "T", detail: "d" });
    resolveIssue("backup", "k");
    resolveIssue("backup", "k");
    expect(listIssues({ includeResolved: true })).toHaveLength(1);
    expect(listIssues({ includeResolved: true })[0]!.resolved_at).not.toBeNull();
  });
});

describe("listIssues()", () => {
  test("excludes resolved rows by default", async () => {
    await raiseIssue({ source: "a", key: "1", severity: "info", title: "open", detail: "d" });
    await raiseIssue({ source: "a", key: "2", severity: "info", title: "closed", detail: "d" });
    resolveIssue("a", "2");
    const open = listIssues();
    expect(open).toHaveLength(1);
    expect(open[0]!.title).toBe("open");
    expect(listIssues({ includeResolved: true })).toHaveLength(2);
  });

  test("excludes dismissed rows by default too", async () => {
    const issue = await raiseIssue({ source: "a", key: "1", severity: "info", title: "T", detail: "d" });
    dismissIssue(issue.id);
    expect(listIssues()).toHaveLength(0);
    expect(listIssues({ includeResolved: true })).toHaveLength(1);
  });
});

describe("fixIssue()", () => {
  test("404s for an unknown id", async () => {
    const result = await fixIssue("issue-nope");
    expect(result.ok).toBe(false);
  });

  test("400s when the issue has no fix", async () => {
    const issue = await raiseIssue({ source: "a", key: "1", severity: "info", title: "T", detail: "d" });
    const result = await fixIssue(issue.id);
    expect(result.ok).toBe(false);
  });

  test("400s when the fix action has no registered handler", async () => {
    const issue = await raiseIssue({
      source: "a",
      key: "1",
      severity: "info",
      title: "T",
      detail: "d",
      fix: { label: "Do it", action: "no_such_action" },
    });
    const result = await fixIssue(issue.id);
    expect(result.ok).toBe(false);
  });

  test("runs the registered handler and resolves the issue on success", async () => {
    let ran = false;
    registerFixHandler("restart_thing", () => {
      ran = true;
    });
    const issue = await raiseIssue({
      source: "a",
      key: "1",
      severity: "error",
      title: "T",
      detail: "d",
      fix: { label: "Restart", action: "restart_thing" },
    });
    const result = await fixIssue(issue.id);
    expect(result.ok).toBe(true);
    expect(ran).toBe(true);
    expect(listIssues()).toHaveLength(0);
  });

  test("leaves the issue open when the handler throws", async () => {
    registerFixHandler("always_fails", () => {
      throw new Error("nope");
    });
    const issue = await raiseIssue({
      source: "a",
      key: "1",
      severity: "error",
      title: "T",
      detail: "d",
      fix: { label: "Try", action: "always_fails" },
    });
    await expect(fixIssue(issue.id)).rejects.toThrow();
    expect(listIssues()).toHaveLength(1);
  });
});

describe("dismissIssue()", () => {
  test("hides the issue from the default list without marking it resolved", async () => {
    const issue = await raiseIssue({ source: "a", key: "1", severity: "info", title: "T", detail: "d" });
    const result = dismissIssue(issue.id);
    expect(result.ok).toBe(true);
    expect(listIssues()).toHaveLength(0);
    const full = listIssues({ includeResolved: true });
    expect(full[0]!.resolved_at).toBeNull();
    expect(full[0]!.dismissed_at).not.toBeNull();
  });

  test("404s for an unknown id", () => {
    const result = dismissIssue("issue-nope");
    expect(result.ok).toBe(false);
  });
});

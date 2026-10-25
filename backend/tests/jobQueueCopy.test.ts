import { describe, expect, test } from "bun:test";
import { JOB_QUEUE_COPY, jobQueueCopy, type JobQueueReason, type JobQueueState } from "@/lib/jobQueueCopy";

describe("job queue copy", () => {
  test("every table entry has adult and child wording without prohibited punctuation", () => {
    for (const [reason, lines] of Object.entries(JOB_QUEUE_COPY)) {
      expect(lines.adult, reason).toBeString();
      expect(lines.child, reason).toBeString();
      expect(lines.adult.length, reason).toBeGreaterThan(0);
      expect(lines.child.length, reason).toBeGreaterThan(0);
      expect(lines.adult, reason).not.toMatch(/[—!]/);
      expect(lines.child, reason).not.toMatch(/[—!]/);
    }
    const neverFit: JobQueueReason = { kind: "never_fit", job: "video", neededGb: 44, availableGb: 32 };
    for (const audience of ["adult", "child"] as const) expect(jobQueueCopy("never_fit", neverFit, null, null, audience)).not.toMatch(/[—!]/);
  });

  test("number one reads next and other positions include the number", () => {
    expect(jobQueueCopy("queued", "queue", 1, null, "adult")).toBe("You are next.");
    expect(jobQueueCopy("queued", "queue", 3, null, "adult")).toBe("You are number 3 in line.");
    expect(jobQueueCopy("queued", "queue", 3, null, "child")).toBe("You are number 3. 2 more, then yours.");
  });

  test("estimates appear only when supplied and are rounded approximately", () => {
    expect(jobQueueCopy("queued", "queue", 2, null, "adult")).toBe("You are number 2 in line.");
    expect(jobQueueCopy("queued", "queue", 2, 91, "adult")).toBe("You are number 2 in line (about 2 minutes).");
    expect(jobQueueCopy("waiting_memory", "making_room", null, 30, "adult")).toContain("about 30 seconds");
    expect(jobQueueCopy("waiting_memory", "making_room", null, null, "adult")).not.toContain("about");
  });

  test("never-fit lines name both memory values", () => {
    const reason: JobQueueReason = { kind: "never_fit", job: "video", neededGb: 44, availableGb: 32 };
    expect(jobQueueCopy("never_fit", reason, null, null, "adult")).toContain("44 GB");
    expect(jobQueueCopy("never_fit", reason, null, null, "adult")).toContain("32 GB");
  });

  test("the table covers each supported state and reason", () => {
    const cases: Array<[JobQueueState, JobQueueReason]> = [
      ["queued", "queue"], ["queued", "higher_class"], ["queued", "other_person_first"], ["queued", "moved_up"],
      ["queued", "waiting_long"], ["queued", "behind_chat"], ["waiting_memory", "making_room"],
      ["waiting_memory", "memory_elsewhere"], ["waiting_memory", "requeued_memory"], ["started", "started"],
      ["paused_chat", "paused_chat"], ["held_coding", "coding_mode"],
      ["never_fit", { kind: "never_fit", job: "picture", neededGb: 20, availableGb: 10 }],
    ];
    for (const [state, reason] of cases) for (const audience of ["adult", "child"] as const) {
      expect(jobQueueCopy(state, reason, 2, null, audience).length).toBeGreaterThan(0);
    }
  });
});

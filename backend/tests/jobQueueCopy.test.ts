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
      ["queued", "queue"], ["queued", "higher_class"], ["queued", "other_person_first"], ["queued", "class_first"], ["queued", "aging_first"], ["queued", "fair_share_first"], ["queued", "boost_first"], ["queued", "moved_up"],
      ["queued", "waiting_long"], ["queued", "behind_chat"], ["waiting_memory", "making_room"],
      ["queued", "tier_ask"], ["queued", "tier_no_room"],
      ["waiting_memory", "memory_elsewhere"], ["waiting_memory", "requeued_memory"], ["started", "started"],
      ["paused_chat", "paused_chat"], ["held_coding", "coding_mode"],
      ["queued", "bigger_job_ahead"], ["queued", "max_window"], ["queued", "max_drain"], ["started", "still_running"],
      ["never_fit", { kind: "never_fit", job: "picture", neededGb: 20, availableGb: 10 }],
    ];
    for (const [state, reason] of cases) for (const audience of ["adult", "child"] as const) {
      expect(jobQueueCopy(state, reason, 2, null, audience).length).toBeGreaterThan(0);
    }
  });

  test("score explanation copy includes position and never names a person", () => {
    const reasons = ["class_first", "aging_first", "fair_share_first", "boost_first"] as const;
    for (const reason of reasons) for (const audience of ["adult", "child"] as const) {
      const copy = jobQueueCopy("queued", reason, 3, null, audience);
      expect(copy).toContain(audience === "adult" ? "You are number 3 now." : "You are number 3 now.");
      expect(copy).not.toContain("Known Person");
      expect(copy).not.toContain("Heavy Name");
    }
    expect(JOB_QUEUE_COPY.class_first.adult).toBe("A faster kind of job goes first (pictures, then videos, then music).");
  });

  test("tier wait copy uses position and optional estimates for adults and children", () => {
    expect(jobQueueCopy("queued", "bigger_job_ahead", 2, 360, "adult")).toBe("A bigger job is running. Yours is number 2 (about 6 minutes).");
    expect(jobQueueCopy("queued", "bigger_job_ahead", 2, null, "adult")).toBe("A bigger job is running. Yours is number 2.");
    expect(jobQueueCopy("queued", "bigger_job_ahead", 2, 360, "child")).toBe("A big job is running. You are number 2.");
    expect(jobQueueCopy("queued", "max_window", 1, 720, "adult")).toBe("Home is running a Max job and will be back to normal in about 12 minutes. Yours starts after it.");
    expect(jobQueueCopy("queued", "max_window", 1, null, "adult")).toBe("Home is running a Max job and will be back to normal. Yours starts after it.");
    expect(jobQueueCopy("queued", "max_window", 1, 720, "child")).toBe("Home is busy with a big job. Yours starts after it.");
    expect(jobQueueCopy("queued", "max_drain", 1, 60, "adult")).toBe("Max starts when the jobs ahead finish (about 1 minutes). New jobs wait behind it.");
    expect(jobQueueCopy("queued", "max_drain", 1, null, "adult")).toBe("Max starts when the jobs ahead finish. New jobs wait behind it.");
    expect(jobQueueCopy("queued", "max_drain", 1, null, "child")).toBe("Home is busy with a big job. Yours starts after it.");
    expect(jobQueueCopy("started", "still_running", null, 120, "adult")).toBe("Still running, about 2 minutes more.");
    expect(jobQueueCopy("started", "still_running", null, null, "adult")).toBe("Still running.");
    expect(jobQueueCopy("started", "still_running", null, null, "child")).toBe("Still running. It will be done soon.");
  });
});

test("tier admission copy is exact for adults and children", () => {
  expect(jobQueueCopy("queued", "tier_ask", null, null, "adult")).toBe("Not enough room for the tier you picked. Waiting for your answer on this card.");
  expect(jobQueueCopy("queued", "tier_ask", null, null, "child")).toBe("Waiting for a grown-up to say yes.");
  expect(jobQueueCopy("queued", "tier_no_room", null, null, "adult")).toBe("Waiting for room for a bigger job.");
  expect(jobQueueCopy("queued", "tier_no_room", null, null, "child")).toBe("Waiting for room.");
});

test("a video waiting for memory with nothing ahead says why, never \"You are next\"", async () => {
  const { phaseLabel } = await import("@/routes/videos");
  const waiting = { state: "running", phase: "waiting for memory", position: 1, riseReason: undefined, estimateSeconds: 1 } as never;
  const adult = phaseLabel(waiting, "adult");
  expect(adult).toBe(JOB_QUEUE_COPY.memory_elsewhere.adult);
  expect(adult).not.toContain("You are next");
  expect(phaseLabel(waiting, "child")).toBe(JOB_QUEUE_COPY.memory_elsewhere.child);
});

test("quiet window and reduced chat lines", () => {
  expect(jobQueueCopy("queued", "quiet_wait", null, null, "adult")).toBe("Waiting for a quiet moment in chat.");
  expect(jobQueueCopy("queued", "quiet_wait", null, null, "child")).toBe("Waiting for a quiet moment.");
  expect(jobQueueCopy("queued", "cooldown_wait", null, null, "child")).toBe("Your job starts in a few minutes.");
  expect(jobQueueCopy("queued", "reduced_chat", null, 720, "adult")).toContain("about 12 minutes");
  expect(jobQueueCopy("queued", "reduced_chat", null, null, "adult")).not.toContain("N");
  expect(jobQueueCopy("queued", "reduced_chat", null, null, "child")).toBe("Chat is a little simpler for a few minutes.");
});

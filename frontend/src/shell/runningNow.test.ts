import { describe, expect, test } from "bun:test";
import { runningNowAnnouncement, runningNowView, type RunningNowViewer } from "@/shell/runningNow";
import type { HomeJobView } from "@/lib/api";

const NOW = Date.parse("2026-10-06T12:00:00.000Z");
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();
const admin: RunningNowViewer = { id: "sage", band: "adult", admin: true };
const adult: RunningNowViewer = { id: "marlow", band: "adult", admin: false };
const child: RunningNowViewer = { id: "nova", band: "child", admin: false };
const teen: RunningNowViewer = { id: "ember", band: "teen", admin: false };

const job = (over: Partial<HomeJobView>): HomeJobView => ({ id: "j", kind: "image", state: "running", startedBy: "sage", forPerson: "sage", title: "Making a picture of a red fox", createdAt: ago(30), updatedAt: ago(5), actions: [], ...over });

describe("runningNowView", () => {
  test("jobs sort into running, waiting and done by their state", () => {
    const view = runningNowView({
      jobs: [
        job({ id: "a", state: "running", actions: ["stop"] }),
        job({ id: "b", state: "queued", title: "Making a short video" }),
        job({ id: "c", state: "done", title: "Made a picture of a fox" }),
        job({ id: "d", kind: "approval", state: "waiting_for_you", forPerson: "nova", startedBy: "nova", title: 'Nova asked to install "Chess"', actions: ["approve", "deny"] }),
      ],
      viewer: admin,
      now: NOW,
    });
    expect(view.running.map((r) => r.id)).toEqual(["a", "b"]);
    expect(view.running[1]?.status).toBe("Waiting to start");
    expect(view.waiting.map((r) => r.id)).toEqual(["d"]);
    expect(view.waiting[0]?.actions).toEqual(["approve", "deny"]);
    expect(view.done.map((r) => r.id)).toEqual(["c"]);
    expect(view.count).toBe(3);
  });

  test("elapsed time reads naturally, starting with Just started", () => {
    const at = (seconds: number) => runningNowView({ jobs: [job({ createdAt: ago(seconds) })], viewer: adult, now: NOW }).running[0]?.detail;
    expect(at(1)).toBe("Just started");
    expect(at(61)).toBe("Started 1 minute ago");
  });

  test("an admin reads whose job it is when it is not their own", () => {
    const view = runningNowView({ jobs: [job({ id: "n", forPerson: "nova", forPersonName: "Nova", title: "Drawing a dinosaur", createdAt: ago(20) })], viewer: admin, now: NOW });
    expect(view.running[0]?.detail).toBe("For Nova. Started 20 seconds ago");
  });

  test("only the actions the service names are offered", () => {
    const view = runningNowView({ jobs: [job({ id: "a", actions: [] })], viewer: adult, now: NOW });
    expect(view.running[0]?.actions).toEqual([]);
  });

  test("progress comes from a fraction, a percent or bytes, never invented", () => {
    const view = runningNowView({
      jobs: [
        job({ id: "f", progress: { fraction: 0.25 } }),
        job({ id: "p", progress: { percent: 40 } }),
        job({ id: "b", kind: "model_download", forPerson: null, startedBy: "system", title: "qwen3-8b-q4", progress: { completedBytes: 1, totalBytes: 4 } }),
        job({ id: "n", progress: {} }),
      ],
      viewer: admin,
      now: NOW,
    });
    expect(view.running.map((r) => r.progress)).toEqual([0.25, 0.4, 0.25, undefined]);
  });

  test("a model download reads in plain words; the model's name sits behind Details for an admin", () => {
    const view = runningNowView({ jobs: [job({ id: "m", kind: "model_download", forPerson: null, startedBy: "system", title: "qwen3-8b-q4" })], viewer: admin, now: NOW });
    expect(view.running[0]?.title).toBe("Downloading a model");
    expect(view.running[0]?.details).toContain("qwen3-8b-q4");
  });

  test("raw details are an admin's only", () => {
    const raw = job({ id: "r", raw: "stack job 123 exited 1", forPerson: "marlow", startedBy: "marlow" });
    expect(runningNowView({ jobs: [raw], viewer: admin, now: NOW }).running[0]?.details).toContain("stack job 123");
    expect(runningNowView({ jobs: [raw], viewer: adult, now: NOW }).running[0]?.details).toBeUndefined();
  });

  test("an estimate becomes words", () => {
    const view = runningNowView({ jobs: [job({ progress: { eta_seconds: 150 } })], viewer: adult, now: NOW });
    expect(view.running[0]?.detail).toBe("About 3 minutes left");
  });

  test("a zero ETA does not claim there is time left", () => {
    const view = runningNowView({ jobs: [job({ progress: { eta_seconds: 0 } })], viewer: adult, now: NOW });
    expect(view.running[0]?.detail).toBeUndefined();
  });

  test("steps read as step n of m", () => {
    const view = runningNowView({ jobs: [job({ progress: { step_index: 1, step_count: 4 } })], viewer: adult, now: NOW });
    expect(view.running[0]?.detail).toBe("Step 2 of 4");
  });

  test("a child's own ask reads Asked a parent, with no buttons and no worry", () => {
    const view = runningNowView({ jobs: [job({ id: "ask", kind: "approval", state: "waiting_for_you", forPerson: "nova", startedBy: "nova", title: 'Asked to install "Chess"', actions: [] })], viewer: child, now: NOW });
    expect(view.waiting[0]).toMatchObject({ title: "Asked a parent", status: "", actions: [] });
  });

  test("child, teen and adult approval rows keep their own copy and projected actions", () => {
    const childRow = runningNowView({ jobs: [job({ id: "child-ask", kind: "approval", state: "waiting_for_you", forPerson: "nova", startedBy: "nova", title: 'Asked to install "Chess"', actions: [] })], viewer: child, now: NOW }).waiting[0];
    const teenRow = runningNowView({ jobs: [job({ id: "teen-ask", kind: "approval", state: "waiting_for_you", forPerson: "ember", startedBy: "ember", title: 'Asked to install "Chess"', actions: [] })], viewer: teen, now: NOW }).waiting[0];
    const adultRow = runningNowView({ jobs: [job({ id: "child-ask", kind: "approval", state: "waiting_for_you", forPerson: "nova", startedBy: "nova", title: 'Nova asked to install "Chess"', actions: ["approve", "deny"] })], viewer: admin, now: NOW }).waiting[0];

    expect(childRow).toMatchObject({ title: "Asked a parent", status: "", actions: [] });
    expect(teenRow).toMatchObject({ title: 'Asked to install "Chess"', status: "Needs you", actions: [] });
    expect(adultRow).toMatchObject({ title: 'Nova asked to install "Chess"', actions: ["approve", "deny"] });
  });

  test("a child's job a grown-up stopped says so kindly", () => {
    const view = runningNowView({ jobs: [job({ id: "x", state: "cancelled", forPerson: "nova", startedBy: "nova", title: "Drawing a dinosaur", provenance: { actions: [{ action: "stop", by: "sage", admin: true }] } })], viewer: child, now: NOW });
    expect(view.done[0]).toMatchObject({ title: "Drawing a dinosaur", status: "Stopped", detail: "A grown-up stopped this." });
  });

  test("a failed job for a child is plain, never alarming", () => {
    const view = runningNowView({ jobs: [job({ id: "x", state: "failed", forPerson: "nova", startedBy: "nova", errorKind: "down" })], viewer: child, now: NOW });
    expect(view.done[0]).toMatchObject({ status: "Didn't work", detail: "That didn't work this time.", tone: "failed" });
  });

  test("a row about another adult carries no title, so it is left out", () => {
    const view = runningNowView({ jobs: [{ id: "z", kind: "image", forPerson: "marlow", durationSeconds: 40 }], viewer: admin, now: NOW });
    expect(view.running).toEqual([]);
    expect(view.count).toBe(0);
  });

  test("finished work older than a day leaves the done list, and it keeps at most five", () => {
    const done = Array.from({ length: 7 }, (_, i) => job({ id: `d${i}`, state: "done", updatedAt: ago(60 * (i + 1)) }));
    const old = job({ id: "old", state: "done", updatedAt: ago(2 * 86_400) });
    const view = runningNowView({ jobs: [...done, old], viewer: adult, now: NOW });
    expect(view.done.map((r) => r.id)).toEqual(["d0", "d1", "d2", "d3", "d4"]);
    // d0 to d6 finished 1 to 7 minutes ago: all recent; the day-old one is not.
    expect(view.recentDone).toBe(7);
  });

  test("a chat waiting on the viewer's answer is in the waiting list and opens that chat", () => {
    const view = runningNowView({ jobs: [job({ id: "ask:conv-9", kind: "chat_ask", state: "waiting_for_you", forPerson: "marlow", startedBy: "marlow", title: "Locking up", conversationId: "conv-9", actions: ["open"] })], viewer: adult, now: NOW });
    expect(view.waiting[0]).toMatchObject({ title: "Locking up", status: "Needs you", detail: "Waiting for your answer in this chat", actions: ["open"], href: "/chat?conversation=conv-9" });
    expect(view.count).toBe(1);
  });

  test("finished work with a conversation offers Open", () => {
    const view = runningNowView({ jobs: [job({ id: "o", state: "done", conversationId: "conv-1" })], viewer: adult, now: NOW });
    expect(view.done[0]).toMatchObject({ actions: ["open"], href: "/chat?conversation=conv-1" });
  });
});

describe("runningNowAnnouncement", () => {
  test("names the viewer's own work when it finishes, and never another person's", () => {
    const before = runningNowView({ jobs: [job({ id: "own", forPerson: "sage" }), job({ id: "nova", forPerson: "nova", title: "Drawing a dinosaur" })], viewer: admin, now: NOW });
    const otherDone = runningNowView({ jobs: [job({ id: "own", forPerson: "sage" }), job({ id: "nova", forPerson: "nova", title: "Drawing a dinosaur", state: "done" })], viewer: admin, now: NOW });
    expect(runningNowAnnouncement(before, otherDone)).toBeUndefined();
    const ownDone = runningNowView({ jobs: [job({ id: "own", forPerson: "sage", state: "done" })], viewer: admin, now: NOW });
    expect(runningNowAnnouncement(before, ownDone)).toBe("Making a picture of a red fox: Done.");
  });

  test("the hub's own housekeeping never reaches the card, a model download does", () => {
    const sweep = job({ id: "schedule:j1", kind: "routine", startedBy: "system", forPerson: null, title: "memory.judge", state: "running" });
    const download = job({ id: "model:1", kind: "model_download", startedBy: "system", forPerson: null, title: "qwen3-8b-q4", state: "running" });
    expect(runningNowView({ jobs: [sweep, download], viewer: admin, now: NOW }).running.map((r) => r.id)).toEqual(["model:1"]);
  });
});

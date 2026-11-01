// OWNER-RULING-2026-11-01: a person never reads about system resources. This scans the tables and builders that
// produce chat notices, job-card waiting lines and making-refusal lines (every audience) for a banned-word list, so
// a future message cannot bring "memory", "room", "GB", "big job" and the like back. Admin-only surfaces (Settings,
// Performance, Repairs, the admin Status line, FAILURE_ADVICE) are deliberately not scanned.
import { describe, expect, test } from "bun:test";
import { FAILURE_COPY, composerNotice, makingNotice, makingRefusalLine, failureLine, type ChatPauseCause, type MakingCause } from "@/lib/failureCopy";
import { JOB_QUEUE_COPY, jobQueueCopy } from "@/lib/jobQueueCopy";
import { askLine } from "@/lib/jobs/liveFit";
import { reducedChatNotice } from "@/lib/reducedChat";
import { transitionNotice } from "@/lib/chatTransitions";
import { plainEngineLine, plainMakingLine } from "@/lib/pictures/plainLine";

export const BANNED = /\bmemory\b|\bRAM\b|\bGB\b|\bgigabytes?\b|\broom\b|free(?:s|d)? up|putting away|put away|using it|the computer is|\bengine\b|big model|big job|bigger job|\bpressure\b|\bload(?:ing)?\b the model|\bmodels?\b|lower level|\btier\b|\bbigger\b|\blarger\b|better version|\bbig\b|\bbusy\b|\brestart(?:s|ed|ing)?\b|\bpaused?\b|\boffline\b|\bunavailable\b|working on something else/i;

const notices = (n: { adult: string; teen: string; child: string; more?: string } | null): string[] => (n ? [n.adult, n.teen, n.child, ...(n.more ? [n.more] : [])] : []);

describe("no resource words in what a person reads", () => {
  const lines: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(JOB_QUEUE_COPY)) lines.push([`JOB_QUEUE_COPY.${k}.adult`, v.adult], [`JOB_QUEUE_COPY.${k}.child`, v.child]);
  for (const [k, v] of Object.entries(FAILURE_COPY)) lines.push([`FAILURE_COPY.${k}.adult`, v.adult], [`FAILURE_COPY.${k}.minor`, v.minor]);
  for (const cause of ["restarting", "memory", "not_installed", "mode_change", "reduced_swap", "paused_by_admin", "offline", "gpu"] as ChatPauseCause[])
    notices(composerNotice("unavailable", cause)).forEach((t, i) => lines.push([`composerNotice.${cause}.${i}`, t]));
  for (const kind of ["image", "video"] as const)
    for (const cause of ["restarting", "memory", "not_installed", "mode_change", "offline", "gpu"] as MakingCause[]) {
      notices(makingNotice(kind, "unavailable", cause)).forEach((t, i) => lines.push([`makingNotice.${kind}.${cause}.${i}`, t]));
      lines.push([`makingRefusalLine.${kind}.${cause}`, makingRefusalLine(kind, cause)]);
    }
  for (const kind of ["image", "video"] as const) notices(makingNotice(kind, "starting")).forEach((t, i) => lines.push([`makingNotice.${kind}.starting.${i}`, t]));
  notices(reducedChatNotice(5)).forEach((t, i) => lines.push([`reducedChatNotice.${i}`, t]));
  for (const kind of ["enter_reduced", "leave_reduced", "max_load", "self_test", "mode_change"] as const) notices(transitionNotice(kind, 1000)).forEach((t, i) => lines.push([`transitionNotice.${kind}.${i}`, t]));
  for (const job of ["picture", "video", "song"] as const)
    for (const audience of ["adult", "child"] as const) lines.push([`never_fit.${job}.${audience}`, jobQueueCopy("never_fit", { kind: "never_fit", job, neededGb: 40, availableGb: 8 }, null, null, audience)]);
  lines.push(["fit ask line", askLine({ outcome: "ask", applied: {} as never, steps: [], lowered: [], leadTier: "boost", belowPick: true, needGb: 40, requestedNeedGb: 60, haveGb: 20, reason: "no_room_now", requested: { tier: "max" } as never } as never, "adult") ?? ""]);
  lines.push(["started with estimate", jobQueueCopy("started", "started", null, 30, "adult")]);
  lines.push(["making_room with estimate", jobQueueCopy("waiting_memory", "making_room", null, 30, "adult")]);
  lines.push(["plainEngineLine", plainEngineLine("Only 3.2 GB of memory available, reserve 4 GB")]);
  lines.push(["plainMakingLine", plainMakingLine("image", "no_memory", "x")]);
  for (const kind of Object.keys(FAILURE_COPY) as Array<keyof typeof FAILURE_COPY>) for (const minor of [true, false]) lines.push([`failureLine.${kind}.${minor}`, failureLine(kind, minor)]);

  test("the scan covers a real set of lines", () => { expect(lines.length).toBeGreaterThan(100); });
  for (const [name, text] of lines) {
    test(name, () => {
      // Max is a name the person picks, and "Waiting for its turn" style lines are the target; the engine word is allowed only in the voice lines, which are not scanned.
      expect(`${text} :: ${text.match(BANNED)?.[0] ?? ""}`.endsWith(":: ")).toBe(true);
      expect(text).not.toContain("—");
    });
  }
});

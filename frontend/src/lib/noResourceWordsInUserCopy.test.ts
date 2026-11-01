// OWNER-RULING-2026-11-01: a person never reads about system resources or the system's state. The backend twin
// (backend/tests/noResourceWordsInUserCopy.test.ts) scans the shared copy tables; this scans the client-side lines.
import { describe, expect, test } from "bun:test";
import { MAX_SELF_TEST_LINE, MAX_RUNNING_LONG_LINE, MAX_READY_LINE, MAX_BACK_LINE, maxProgressLine } from "@/apps/chat/maxChat";
import { MODE_LINES, MAX_DIALOG_TITLE, MAX_DIALOG_BODY, maxStartLine } from "@/apps/chat/composerModeLines";
import { waitPhrase } from "@/apps/chat/maxChat";
import { engineDownReason } from "@/apps/chat/useChatAvailability";
import { fitAskActions } from "@/lib/fitAsk";
import { ANSWER_STYLE_LINES } from "@/apps/chat/answerStyleLabel";

const BANNED = /\bmemory\b|\bRAM\b|\bGB\b|\broom\b|free(?:s|d)? up|putting away|the computer is|\bengine\b|big model|big job|bigger|larger|better version|\bbig\b|lower level|\btier\b|\bbusy\b|\brestart(?:s|ed|ing)?\b|\bpaused?\b|\boffline\b|\bunavailable\b/i;

describe("no resource or system-state words in client copy", () => {
  const lines: Array<[string, string | undefined]> = [
    ...Object.entries(ANSWER_STYLE_LINES).map(([k, v]): [string, string] => [`answer style line ${k}`, v]),
    ["MAX_DIALOG_TITLE", MAX_DIALOG_TITLE], ["MAX_DIALOG_BODY", MAX_DIALOG_BODY], ["max start line", maxStartLine(waitPhrase(60))], ["max start line seconds", maxStartLine(waitPhrase(30))], ...MODE_LINES.map((line, i): [string, string] => [`mode line ${i}`, line]), ["MAX_SELF_TEST_LINE", MAX_SELF_TEST_LINE], ["MAX_RUNNING_LONG_LINE", MAX_RUNNING_LONG_LINE],
    ["maxProgressLine switching", maxProgressLine("Switching to", 60, 1000)], ["MAX_READY_LINE", MAX_READY_LINE], ["MAX_BACK_LINE", MAX_BACK_LINE], ["maxProgressLine testing", maxProgressLine("Testing", 35, 1000)],
    ["engineDownReason unavailable", engineDownReason("unavailable")], ["engineDownReason starting", engineDownReason("starting")],
  ];
  for (const level of [{ picked: "Max", actual: "Boost" }, { picked: "Boost", actual: "Standard" }, {}]) {
    (fitAskActions({ job_id: "j", ...level }, () => undefined) ?? []).forEach((a, i) => lines.push([`fitAsk ${JSON.stringify(level)} ${i}`, String(a.label)]));
  }
  for (const [name, text] of lines) test(name, () => { expect(text).toBeString(); expect((text ?? "").match(BANNED)?.[0] ?? null).toBeNull(); });
  test("the fit-ask buttons use the level names", () => {
    const labels = (fitAskActions({ job_id: "j", picked: "Max", actual: "Standard" }, () => undefined) ?? []).map((a) => a.label);
    expect(labels).toEqual(["Make it now with Standard", "Wait for Max"]);
  });
});

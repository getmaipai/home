import { expect, test } from "bun:test";
import { FAILURE_COPY, VOICE_FAILURE_COPY, composerNotice, makingNotice, voiceFailureLine, type ChatPauseCause, type MakingCause } from "@/lib/failureCopy";

test("a minor sees the short grown-up line and an adult without Repairs access is not told to open Repairs", () => {
  expect(voiceFailureLine("listening_engine", { minor: true, canOpenRepairs: true })).toBe("I can't hear you right now. Please tell a grown-up.");
  expect(voiceFailureLine("listening_engine", { minor: false, canOpenRepairs: false })).toBe("Home can't hear you right now. Type your message instead, or ask an owner or admin to check it.");
});

test("no copy string in the new table contains an em dash", () => {
  expect(Object.values(VOICE_FAILURE_COPY).flatMap((copy) => Object.values(copy)).every((line) => !line.includes("—"))).toBe(true);
});

// Owner rule (2026-11-01, "No resource words for users"): a person who is not an admin never reads memory, RAM, sizes, room, engine,
// busy, bigger or better in a status line. They are told what to expect ("Waiting for its turn").
const RESOURCE_WORDS = /\b(memory|RAM|GB|MB|room|engine|engines|busy|bigger|better)\b/i;
test("no line a non-admin can see names a resource or the engine", () => {
  const lines: string[] = [];
  const causes: ChatPauseCause[] = ["restarting", "memory", "not_installed", "mode_change", "reduced_swap", "paused_by_admin", "offline", "gpu"];
  for (const availability of ["starting", "unavailable"] as const) {
    for (const cause of [null, ...causes]) {
      const n = composerNotice(availability, cause);
      if (n) lines.push(n.adult, n.teen, n.child, ...(n.more ? [n.more] : []));
    }
  }
  const making: Array<MakingCause | null> = [null, "restarting", "memory", "not_installed", "mode_change", "offline", "gpu"];
  for (const kind of ["image", "video"] as const) {
    for (const availability of ["starting", "unavailable"] as const) {
      for (const cause of making) {
        const n = makingNotice(kind, availability, cause);
        if (n) lines.push(n.adult, n.teen, n.child, ...(n.more ? [n.more] : []));
      }
    }
  }
  for (const copy of Object.values(FAILURE_COPY)) lines.push(copy.adult, copy.minor);
  for (const copy of Object.values(VOICE_FAILURE_COPY)) lines.push(copy.adult, copy.adultNoRepairs, copy.minor);
  expect(lines.length).toBeGreaterThan(60);
  expect(lines.filter((line) => RESOURCE_WORDS.test(line))).toEqual([]);
  expect(lines.filter((line) => line.includes("${"))).toEqual([]);
});

// I18N-F2 (design note i18n-2026-11-07 section 9 step 1): every line is a descriptor (id plus English default); the string tables the
// server, the robot and the tests read are derived from them, so the words are defined once.
import { FAILURE_ADVICE, TOOL_FAILURE_ADVICE, askFormFailureLine, askFormFailureMessage, descriptorForLine, failureLine, failureMessage, formatMessage, partialReplyNote, voiceFailureMessage } from "@/lib/failureCopy";

test("a line's descriptor and its string agree, and minor lines have minor ids", () => {
  expect(failureMessage("busy", false)).toEqual({ id: "failure.busy.adult", message: failureLine("busy", false) });
  expect(failureMessage("busy", true).id).toBe("failure.busy.minor");
  expect(failureMessage("engine_computer", false, true).id).toBe("failure.engine_computer.adultAway");
  expect(voiceFailureMessage("listening_engine", { minor: true, canOpenRepairs: true }).id).toBe("failure.voice.listening_engine.minor");
  expect(voiceFailureMessage("listening_engine", { minor: false, canOpenRepairs: false }).id).toBe("failure.voice.listening_engine.adultNoRepairs");
  expect(partialReplyNote("slow", false)).toContain("stopped answering");
});

test("a line is found again by its text, apart for minors and adults", () => {
  expect(descriptorForLine(failureLine("busy", true), true)?.id).toBe("failure.busy.minor");
  expect(descriptorForLine(failureLine("busy", false), false)?.id).toBe("failure.busy.adult");
  expect(descriptorForLine(failureLine("busy", false), true)).toBeUndefined();
  // Same words for every band: the band picks the id and a minor never reaches an adult id.
  const restarting = composerNotice("unavailable", "restarting")!;
  expect(restarting.adult).toBe(restarting.child);
  expect(descriptorForLine(restarting.child, true)?.id).toMatch(/\.(child|teen)$/);
  expect(descriptorForLine(restarting.adult, false)?.id).toMatch(/\.adult$/);
  expect(descriptorForLine("Something an admin typed.", false)).toBeUndefined();
});

test("ids are well formed and one id never carries two different messages", () => {
  const ids: string[] = [];
  const messages = new Map<string, string>();
  const walk = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    const line = value as { id?: unknown; message?: unknown };
    if (typeof line.id === "string" && typeof line.message === "string") { ids.push(line.id); expect(messages.get(line.id) ?? line.message).toBe(line.message); messages.set(line.id, line.message); return; }
    for (const child of Object.values(value)) walk(child);
  };
  for (const kind of ["busy", "memory", "stopped", "slow", "unreachable", "engine_computer", "context_too_large", "other"] as const) { walk(failureMessage(kind, true)); walk(failureMessage(kind, false)); }
  expect(ids.every((id) => /^failure\.[a-z_]+\.[A-Za-z_]+(\.[A-Za-z_]+)?$/.test(id))).toBe(true);
  expect(ids.length).toBe(16);
});

test("the advice tables keep their string shape and the ask-form line fills its field name", () => {
  expect(FAILURE_ADVICE.stopped).toEqual({ cause: "The chat engine was stopped, so the reply never started.", next_step: "Start the chat engine in Repairs.", repairs: true });
  expect(TOOL_FAILURE_ADVICE.timed_out.verb).toBe("timed out");
  expect(askFormFailureMessage("invalid_input", 'Bad value for "Name".')).toMatchObject({ id: "failure.ask_form.field", values: { label: "Name" } });
  expect(askFormFailureLine("invalid_input", 'Bad value for "Name".')).toBe('The answer for "Name" did not fit. Correct that field, then submit the form again.');
  expect(formatMessage({ id: "x", message: "Hi {who}, {missing}" }, { who: "Sage" })).toBe("Hi Sage, {missing}");
});

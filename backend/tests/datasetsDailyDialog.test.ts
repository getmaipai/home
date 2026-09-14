// Lane 12 item 4. Real DailyDialog raw text (found live against
// test.zip's own dialogues_test.txt/dialogues_act_test.txt/
// dialogues_emotion_test.txt, 2026-09-14: __eou__-separated turns,
// space-separated numeric labels, one dialogue per aligned line) -
// three short embedded lines, never the zip itself, so this test needs
// no unzip binary and no download.
import { describe, expect, test } from "bun:test";
import { parseDailyDialog } from "../scripts/bench/datasets/dailydialog";

const DIALOGUES = [
  "Hey , you wanna buy some weed ? __eou__ No thanks . __eou__ ",
  "How are you ? __eou__ I'm good , you ? __eou__ Great , thanks ! __eou__ ",
].join("\n");
const ACTS = ["3 4 ", "2 1 1 "].join("\n");
const EMOTIONS = ["0 0 ", "0 0 4 "].join("\n");

describe("parseDailyDialog", () => {
  test("one conversation per line, id carries the split and line index", () => {
    const conversations = parseDailyDialog(DIALOGUES, ACTS, EMOTIONS, "test");
    expect(conversations).toHaveLength(2);
    expect(conversations[0]!.id).toBe("dailydialog-test-0");
    expect(conversations[1]!.id).toBe("dailydialog-test-1");
    expect(conversations[0]!.source).toBe("dailydialog");
  });

  test("turns split on __eou__, trimmed, with speaker alternating A/B from A", () => {
    const conversations = parseDailyDialog(DIALOGUES, ACTS, EMOTIONS, "test");
    const turns = conversations[0]!.sessions[0]!.turns;
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({ speaker: "A", text: "Hey , you wanna buy some weed ?" });
    expect(turns[1]).toMatchObject({ speaker: "B", text: "No thanks ." });
  });

  test("act and emotion are read per turn, in DailyDialog's own numbering", () => {
    const conversations = parseDailyDialog(DIALOGUES, ACTS, EMOTIONS, "test");
    const turns = conversations[0]!.sessions[0]!.turns;
    // 3 = directive, 4 = commissive (dev.md section 12's own mapping).
    expect(turns[0]!.act).toBe(3);
    expect(turns[1]!.act).toBe(4);
    expect(turns[0]!.emotion).toBe(0);
  });

  test("the second line's three turns and three labels line up", () => {
    const conversations = parseDailyDialog(DIALOGUES, ACTS, EMOTIONS, "test");
    const turns = conversations[1]!.sessions[0]!.turns;
    expect(turns.map((t) => t.text)).toEqual(["How are you ?", "I'm good , you ?", "Great , thanks !"]);
    expect(turns.map((t) => t.act)).toEqual([2, 1, 1]);
    expect(turns.map((t) => t.emotion)).toEqual([0, 0, 4]);
  });

  test("mismatched turn and label counts on one line are refused, not silently misaligned", () => {
    expect(() => parseDailyDialog(DIALOGUES, "3 4 5 \n2 1 1 ", EMOTIONS, "test")).toThrow(/turns but \d+ acts/);
  });

  test("mismatched file line counts are refused outright", () => {
    expect(() => parseDailyDialog(DIALOGUES, "3 4 ", EMOTIONS, "test")).toThrow(/disagree on line count/);
  });
});

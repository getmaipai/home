import { afterEach, describe, expect, mock, test } from "bun:test";
import type { PersonBox } from "./people";
import { __resolvePeopleAnswerForTests, __setPersonPickerForTests, choosePeople } from "./people";

afterEach(() => __setPersonPickerForTests(undefined));

const people = [
  { id: 1, x: 0.08, y: 0.1, w: 0.32, h: 0.75, area: 0.24 },
  { id: 2, x: 0.58, y: 0.12, w: 0.3, h: 0.72, area: 0.22 },
] as PersonBox[];

describe("people picker", () => {
  test("remove the boy on the left picks the left box without asking the model", async () => {
    const picker = mock(async () => null);
    __setPersonPickerForTests(picker);
    expect(await choosePeople(people, new Uint8Array(), "remove the boy on the left")).toEqual([1]);
    expect(picker).not.toHaveBeenCalled();
  });

  test("left means the leftmost of three and a numbered position counts from that side", async () => {
    const three = [people[0]!, { id: 3, x: 0.36, y: 0.1, w: 0.22, h: 0.75, area: 0.17 }, people[1]!] as PersonBox[];
    const picker = mock(async () => null);
    __setPersonPickerForTests(picker);
    expect(await choosePeople(three, new Uint8Array(), "the one on the far right")).toEqual([2]);
    expect(await choosePeople(three, new Uint8Array(), "the second from the left")).toEqual([3]);
    expect(await choosePeople(three, new Uint8Array(), "the third from the right")).toEqual([1]);
    expect(picker).not.toHaveBeenCalled();
  });

  test("near-tied positions fall through to the model", async () => {
    const tied = [people[0]!, { id: 3, x: 0.12, y: 0.1, w: 0.32, h: 0.75, area: 0.24 }, people[1]!] as PersonBox[];
    const picker = mock(async () => [3]);
    __setPersonPickerForTests(picker);
    expect(await choosePeople(tied, new Uint8Array(), "the person on the left")).toEqual([3]);
    expect(picker).toHaveBeenCalledTimes(1);
  });

  test("a category without a position uses the model among all people", async () => {
    const picker = mock(async (_overlay: Uint8Array, candidates: PersonBox[]) => [candidates[1]!.id]);
    __setPersonPickerForTests(picker);
    expect(await choosePeople(people, new Uint8Array(), "the girl")).toEqual([2]);
    expect(picker).toHaveBeenCalledTimes(1);
    expect(picker.mock.calls[0]![1]).toEqual(people);
  });

  test("tolerantly parses fenced JSON and accepts valid ids when sure is false", async () => {
    expect(__resolvePeopleAnswerForTests("Result:\n```json\n{\"numbers\":[2],\"sure\":false}\n```", "the girl", [1, 2])).toEqual({ numbers: [2] });
    expect(__resolvePeopleAnswerForTests("Picked [1]", "boy", [1, 2])).toEqual({ numbers: [1] });
  });

  test("invalid picker answers map to non-content reason codes", async () => {
    expect(__resolvePeopleAnswerForTests("no idea", "the girl", [1, 2])).toEqual({ reason: "unparseable" });
    expect(__resolvePeopleAnswerForTests("", "the girl", [1, 2])).toEqual({ reason: "empty" });
    expect(__resolvePeopleAnswerForTests('{"numbers":[9],"sure":true}', "the girl", [1, 2])).toEqual({ reason: "ids_unknown" });
    expect(__resolvePeopleAnswerForTests('{"numbers":[1],"sure":false}', "the boy and girl", [1, 2])).toEqual({ reason: "not_sure" });
  });
});

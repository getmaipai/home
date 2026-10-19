import { afterEach, describe, expect, mock, test } from "bun:test";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import { StackError } from "@/lib/stack/errors";
import type { PersonBox } from "./people";
import { __resolvePeopleAnswerForTests, __setPeopleRetryPauseForTests, __setPersonPickerForTests, choosePeople, findPeople, PEOPLE_BUSY_LINE } from "./people";

afterEach(() => {
  __setPersonPickerForTests(undefined);
  __setPeopleRetryPauseForTests(4000);
  __resetStackEngineForTests();
});

const foundReply = {
  kind: "done",
  item: { people: [{ id: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.7, area: 0.21 }], b64_json: "AQ==" },
} as const;

function stubImageEdit(imageEdit: (...args: never[]) => unknown): void {
  __setStackClientForTests({ imageEdit } as never);
  __setPeopleRetryPauseForTests(0);
}

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

describe("picture tools retry", () => {
  test("findPeople retries a busy Stack error once and succeeds", async () => {
    const imageEdit = mock(async () => {
      if (imageEdit.mock.calls.length === 1) throw new StackError("unexpected", "busy", { status: 503 });
      return foundReply;
    });
    stubImageEdit(imageEdit as never);

    await expect(findPeople(new Uint8Array([1]), "image/png")).resolves.toMatchObject({ people: foundReply.item.people });
    expect(imageEdit).toHaveBeenCalledTimes(2);
  });

  test("two busy Stack errors reject with the busy code and line", async () => {
    const imageEdit = mock(async () => { throw new StackError("unexpected", "busy", { status: 503 }); });
    stubImageEdit(imageEdit as never);

    await expect(findPeople(new Uint8Array([1]), "image/png")).rejects.toMatchObject({ code: "busy", message: PEOPLE_BUSY_LINE });
    expect(imageEdit).toHaveBeenCalledTimes(2);
  });

  test("people_unavailable and no_people are not retried", async () => {
    const unavailable = mock(async () => { throw new StackError("unexpected", "not available", { status: 404, body: '{"code":"people_unavailable"}' }); });
    stubImageEdit(unavailable as never);
    await expect(findPeople(new Uint8Array([1]), "image/png")).rejects.toMatchObject({ code: "unavailable" });
    expect(unavailable).toHaveBeenCalledTimes(1);

    const none = mock(async () => ({ kind: "done", item: { people: [], b64_json: "AQ==" } }));
    stubImageEdit(none as never);
    await expect(findPeople(new Uint8Array([1]), "image/png")).rejects.toMatchObject({ code: "none" });
    expect(none).toHaveBeenCalledTimes(1);
  });

  test("an aborted signal prevents retry", async () => {
    const imageEdit = mock(async () => { throw new StackError("unexpected", "busy", { status: 503 }); });
    stubImageEdit(imageEdit as never);
    const controller = new AbortController();
    controller.abort();

    await expect(findPeople(new Uint8Array([1]), "image/png", controller.signal)).rejects.toMatchObject({ code: "busy" });
    expect(imageEdit).toHaveBeenCalledTimes(1);
  });

  test("a running reply retries once and resolves on done", async () => {
    const imageEdit = mock(async () => imageEdit.mock.calls.length === 1
      ? ({ kind: "running" } as never)
      : foundReply);
    stubImageEdit(imageEdit as never);

    await expect(findPeople(new Uint8Array([1]), "image/png")).resolves.toMatchObject({ people: foundReply.item.people });
    expect(imageEdit).toHaveBeenCalledTimes(2);
  });
});

import { describe, expect, test } from "bun:test";
import type { AiCard, AiChoice, AiJobId } from "../../../../shared/aiChoices";
import { OFF, buildRows, counts, fill, missingRows, project, stageFor } from "./aiGlanceRows";

function choice(id: string, over: Partial<AiChoice> = {}): AiChoice {
  return {
    id, job: id.split(".")[0], kind: "radio", label: id, description: "", name: id, rowIds: [], recommended: false, current: false,
    state: "installed", percent: null, failure: null, downloadBytes: 0, installedBytes: 1e9, ramBytes: 1.1e9, ramBasis: "estimate",
    stateText: "", blockedReason: null, action: "none", setting: null, chosenNotReady: false, details: [], ...over,
  } as AiChoice;
}

function card(id: string, choices: AiChoice[]): AiCard {
  return { id, title: id, summary: "", chip: "", choices, notReady: false, unavailable: null } as AiCard;
}

const cards = [
  card("chat", [
    choice("chat.standard", { recommended: true, current: true }),
    choice("chat.big", { state: "notInstalled", downloadBytes: 4e9, ramBytes: 5e9 }),
  ]),
  card("pictures", [choice("pictures.quick", { recommended: true }), choice("pictures.detailed", { current: true })]),
  card("wakeword", []),
  card("coding", [choice("coding.helper", { kind: "switch", recommended: true, current: false, setting: { key: "x", value: true } })]),
];
const none = new Set<AiJobId>();

describe("buildRows", () => {
  test("orders the jobs and derives the badges", () => {
    const rows = buildRows(cards, none, {});
    expect(rows.map((row) => row.job)).toEqual(["chat", "pictures", "wakeword", "coding"]);
    expect(rows.map((row) => row.badge)).toEqual(["recommended", "custom", "disabled", "disabled"]);
    expect(counts(rows)).toEqual({ custom: 1, recommended: 1, disabled: 2 });
    expect(rows.find((row) => row.job === "wakeword")?.offered).toBe(false);
  });

  test("the only model a job has reads recommended, not custom, when it is on", () => {
    const only = [card("music", [choice("music.make", { kind: "switch", recommended: false, current: true })])];
    expect(buildRows(only, none, {})[0]!.badge).toBe("recommended");
  });

  test("a job switched off reads disabled", () => {
    const rows = buildRows(cards, new Set<AiJobId>(["chat"]), {});
    expect(rows[0]!.badge).toBe("disabled");
  });

  test("a staged pick shows as custom and counts its download", () => {
    const rows = buildRows(cards, none, { chat: { choiceId: "chat.big", enabled: true } });
    expect(rows[0]!.badge).toBe("custom");
    expect(rows[0]!.staged).toBe(true);
    expect(project(rows).downloadBytes).toBe(4e9);
  });
});

describe("stageFor", () => {
  const row = buildRows(cards, none, {})[0]!;
  test("picking what is already live stages nothing", () => expect(stageFor(row, "chat.standard")).toBeNull());
  test("picking another model stages it", () => expect(stageFor(row, "chat.big")).toEqual({ choiceId: "chat.big", enabled: true }));
  test("Disable stages the switch off", () => expect(stageFor(row, OFF)).toEqual({ enabled: false }));
});

describe("project and missingRows", () => {
  test("memory sums the live and the shown models", () => {
    const rows = buildRows(cards, none, { chat: { choiceId: "chat.big", enabled: true } });
    const projection = project(rows);
    expect(projection.ramAfter - projection.ramNow).toBe(5e9 - 1.1e9);
  });

  test("missing is a chosen, on, not installed model", () => {
    const missing = [card("chat", [choice("chat.standard", { current: true, state: "notInstalled", downloadBytes: 3e9 })])];
    expect(missingRows(buildRows(missing, none, {})).map((row) => row.job)).toEqual(["chat"]);
    expect(missingRows(buildRows(missing, new Set<AiJobId>(["chat"]), {}))).toEqual([]);
  });
});

describe("fill", () => {
  test("replaces known tokens and leaves unknown ones", () => expect(fill("{a} and {b}", { a: 1 })).toBe("1 and {b}"));
});

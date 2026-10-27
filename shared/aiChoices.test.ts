// The pure card math of shared/aiChoices.ts, tested against the four real
// tiers in shared/diskPlan.json and small hand-built plans.

import { expect, test } from "bun:test";
import table from "./diskPlan.json";
import { aiCopy as copy } from "../backend/src/lib/aiCopy";
import { buildAiCards, recommendedPlan, type AiComponentLike, type AiSettingsInput } from "./aiChoices";
import { GIB, freeGb, needGb, sizeGb, type DiskPlan, type DiskRow, type DiskTotals } from "./diskPlanMath";

const TIERS = table.tiers as Record<DiskPlan["tier"], DiskPlan>;
const TIERS_LIST = ["p16", "p32", "p64", "p128"] as const;
const SETTINGS: AiSettingsInput = { pictureQuickModel: "ernie", pictureDetailedEnabled: true, videoQuality: "quick", musicEnabled: false };

const kindIsModel = (id: string): boolean => !id.startsWith("engine:") && id !== "home";
function row(id: string, overrides: Partial<DiskRow> = {}): DiskRow {
  return {
    id, label: `Part ${id}`, note: "", kind: "model", need: "optional", selectable: true,
    download_bytes: GIB, installed_bytes: GIB, peak_temp_bytes: 0,
    model_ids: kindIsModel(id) ? [`${id}-pin`] : [], engines: [], installed: false, basis: "estimate",
    ...overrides,
  };
}

function zeroTotals(): DiskTotals {
  return { download_bytes: 0, installed_bytes: 0, peak_temp_bytes: 0, needed_bytes: 0, required_free_bytes: 0 };
}

function planOf(rows: DiskRow[]): DiskPlan {
  return {
    tier: "p64", level: "recommended", margin_percent: 20, headroom_warn_bytes: 5 * GIB,
    rows, default: zeroTotals(), minimum: zeroTotals(), everything: zeroTotals(),
    measured_on: "2026-10-25", default_selected: [],
  };
}

function component(overrides: Partial<AiComponentLike> & { id: string }): AiComponentLike {
  return {
    label: overrides.id, state: "notInstalled", size_bytes: null, download_bytes: 0,
    requirement: "required", requirement_reason: null, percent: null, job: null,
    failure: null, can_install: true, can_uninstall: true, last_used_at: null, used_by: [],
    ...overrides,
  };
}

test("builds the eight job cards in order on every tier p16 to p128 from shared/diskPlan.json", () => {
  for (const tier of TIERS_LIST) {
    const plan = TIERS[tier];
    const result = buildAiCards({ copy, plan, components: null, settings: SETTINGS, freeBytes: null });
    expect(result.cards.map((card) => card.id)).toEqual(["chat", "pictures", "picturesdetailed", "videos", "music", "voice", "wakeword", "coding"]);
    for (const card of result.cards) {
      if (card.choices.length === 0) {
        expect(card.unavailable).not.toBeNull();
      } else {
        expect(card.unavailable).toBeNull();
      }
      for (const choice of card.choices) {
        expect(choice.label.length).toBeGreaterThan(0);
        expect(choice.description.length).toBeGreaterThan(0);
        expect(choice.name.length).toBeGreaterThan(0);
        expect(choice.stateText.length).toBeGreaterThan(0);
        expect(choice.rowIds.length).toBeGreaterThan(0);
      }
    }
    expect(result.alwaysOn.rowIds.length).toBeGreaterThan(0);
  }
});

test("exactly one recommended radio per radio card on every tier", () => {
  for (const tier of TIERS_LIST) {
    const { cards } = buildAiCards({ copy, plan: TIERS[tier], components: null, settings: SETTINGS, freeBytes: null });
    for (const card of cards) {
      const radios = card.choices.filter((choice) => choice.kind === "radio");
      if (radios.length === 0) continue;
      expect(radios.filter((choice) => choice.recommended).length).toBe(1);
    }
  }
});

test("pictures: Quick offers ERNIE and Klein as radios, and Klein alone when ERNIE is absent", () => {
  const withErnie = buildAiCards({ copy, plan: TIERS.p128, components: null, settings: SETTINGS, freeBytes: null });
  const picturesA = withErnie.cards.find((card) => card.id === "pictures")!;
  const ernie = picturesA.choices.find((choice) => choice.id === "pictures.ernie")!;
  const klein = picturesA.choices.find((choice) => choice.id === "pictures.klein")!;
  expect(ernie.rowIds[0]).toBe("pictures-ernie");
  expect(klein.rowIds[0]).toBe("pictures");
  expect(ernie.setting).toEqual({ key: "generation.picture_quick_model", value: "ernie" });
  expect(klein.setting).toEqual({ key: "generation.picture_quick_model", value: "klein" });
  expect(ernie.current).toBe(true);
  expect(klein.current).toBe(false);
  expect(picturesA.choices.some((choice) => choice.id === "pictures.edit")).toBe(true);

  const withoutErnie: DiskPlan = { ...TIERS.p128, rows: TIERS.p128.rows.filter((candidate) => candidate.id !== "pictures-ernie") };
  const picturesB = buildAiCards({ copy, plan: withoutErnie, components: null, settings: SETTINGS, freeBytes: null }).cards.find((card) => card.id === "pictures")!;
  expect(picturesB.choices.some((choice) => choice.id === "pictures.ernie")).toBe(false);
  expect(picturesB.choices.find((choice) => choice.id === "pictures.klein")!.current).toBe(true);
  expect(picturesB.choices.some((choice) => choice.id === "pictures.edit")).toBe(false);
});

test("pictures: the Quick model current follows generation.picture_quick_model", () => {
  const klein = buildAiCards({ copy, plan: TIERS.p128, components: null, settings: { ...SETTINGS, pictureQuickModel: "klein" }, freeBytes: null }).cards.find((card) => card.id === "pictures")!;
  expect(klein.choices.find((choice) => choice.id === "pictures.klein")!.current).toBe(true);
  expect(klein.choices.find((choice) => choice.id === "pictures.ernie")!.current).toBe(false);
});

test("Detailed pictures is its own switch row, on only when enabled and installed, with its own setting", () => {
  const card = (settings: AiSettingsInput, components: AiComponentLike[] | null) => buildAiCards({ copy, plan: TIERS.p128, components, settings, freeBytes: null }).cards.find((c) => c.id === "picturesdetailed")!;
  const on = card(SETTINGS, null).choices[0]!;
  expect(on.id).toBe("picturesdetailed.zimage");
  expect(on.kind).toBe("switch");
  expect(on.setting).toEqual({ key: "generation.picture_detailed.enabled", value: true });
  const installed = TIERS.p128.rows.find((candidate) => candidate.id === "pictures-zimage")!.model_ids.map((id) => component({ id, state: "installed" }));
  expect(card(SETTINGS, installed).choices[0]!.current).toBe(true);
  expect(card({ ...SETTINGS, pictureDetailedEnabled: false }, installed).choices[0]!.current).toBe(false);

  const noZImage: DiskPlan = { ...TIERS.p128, rows: TIERS.p128.rows.filter((candidate) => candidate.id !== "pictures-zimage") };
  const gone = buildAiCards({ copy, plan: noZImage, components: null, settings: SETTINGS, freeBytes: null }).cards.find((c) => c.id === "picturesdetailed")!;
  expect(gone.choices).toEqual([]);
});

test("wake word lists the stock detector as a switch that follows its files, and is not offered without the reading", () => {
  const card = (wakeword: { installed: boolean; bytes: number } | null) => buildAiCards({ copy, plan: TIERS.p128, components: null, settings: SETTINGS, freeBytes: null, wakeword }).cards.find((c) => c.id === "wakeword")!;
  const installed = card({ installed: true, bytes: 3_685_906 });
  expect(installed.choices.map((choice) => choice.id)).toEqual(["wakeword.detector"]);
  expect(installed.choices[0]!.kind).toBe("switch");
  expect(installed.choices[0]!.current).toBe(true);
  expect(installed.choices[0]!.state).toBe("installed");
  expect(installed.choices[0]!.setting).toBeNull();
  const missing = card({ installed: false, bytes: 3_685_906 });
  expect(missing.choices[0]!.current).toBe(false);
  expect(missing.choices[0]!.state).toBe("notInstalled");
  expect(missing.choices[0]!.downloadBytes).toBe(3_685_906);
  expect(card(null).choices).toEqual([]);
});

test("a chosen but not installed Detailed reads Chosen, not ready and notReady", () => {
  const plan = planOf([
    row("home", { kind: "home", need: "required", installed: true, installed_bytes: 2 * GIB, download_bytes: 0, peak_temp_bytes: 0 }),
    row("video", { need: "recommended", installed: true, download_bytes: 24 * GIB, installed_bytes: 24 * GIB, peak_temp_bytes: 4 * GIB, engines: ["engine:video"] }),
    row("video-detailed", { need: "optional", download_bytes: 74 * GIB, installed_bytes: 60 * GIB, peak_temp_bytes: 14 * GIB }),
    row("engine:video", { kind: "engine", need: "required", installed: true, download_bytes: 0, installed_bytes: 1 * GIB, peak_temp_bytes: 0 }),
  ]);
  const card = buildAiCards({ copy, plan, components: null, settings: { ...SETTINGS, videoQuality: "detailed" }, freeBytes: null }).cards.find((c) => c.id === "videos")!;
  const detailed = card.choices.find((choice) => choice.id === "videos.detailed")!;
  expect(detailed.current).toBe(true);
  expect(detailed.chosenNotReady).toBe(true);
  expect(card.chip).toBe("Chosen, not ready");
  expect(card.notReady).toBe(true);
  expect(detailed.stateText).toBe(`Not installed, ${sizeGb(74 * GIB)}`);
});

test("no description, stateText, chip or blockedReason contains a model name or MB", () => {
  const banned = /\b(FLUX|Klein|ERNIE|Z-Image|Wan|LTX|Qwen|Chatterbox|Pocket|MB)\b/i;
  for (const tier of TIERS_LIST) {
    const { cards } = buildAiCards({
      copy, plan: TIERS[tier], components: null,
      settings: { pictureQuickModel: "klein", pictureDetailedEnabled: true, videoQuality: "detailed", musicEnabled: true },
      freeBytes: 1 * GIB,
    });
    for (const card of cards) {
      expect(card.chip.length).toBeGreaterThan(0);
      expect(card.chip.match(banned)).toBeNull();
      expect(card.chip).not.toContain("\"");
      for (const choice of card.choices) {
        // A row is named by its model (the glance shows the name the person chose); the sentences around it stay plain.
        for (const word of [choice.description, choice.stateText, choice.blockedReason]) {
          if (word === null) continue;
          expect(word.match(banned), `${tier} ${card.id} ${choice.id}: ${word}`).toBeNull();
          expect(word, `${tier} ${card.id} ${choice.id}`).not.toContain("\"");
        }
      }
    }
  }
});

test("a choice that does not fit says the numbers", () => {
  const plan = planOf([
    row("home", { kind: "home", need: "required", installed: true, download_bytes: 0, installed_bytes: 2 * GIB, peak_temp_bytes: 0 }),
    row("video", { need: "recommended", download_bytes: 82 * GIB, installed_bytes: 60 * GIB, peak_temp_bytes: 10 * GIB }),
  ]);
  const card = buildAiCards({ copy, plan, components: null, settings: SETTINGS, freeBytes: 38 * GIB }).cards.find((c) => c.id === "videos")!;
  const quick = card.choices.find((choice) => choice.id === "videos.quick")!;
  const needBytes = Math.ceil(60 * GIB * 1.2) + 10 * GIB;
  expect(quick.blockedReason).toBe(`Needs about ${needGb(needBytes)} GB free. This computer has ${freeGb(38 * GIB)} GB free.`);
  expect(quick.action).toBe("none");
});

test("unsupported uses the component requirement_reason", () => {
  const plan = planOf([
    row("home", { kind: "home", need: "required", installed: true, download_bytes: 0, installed_bytes: 2 * GIB, peak_temp_bytes: 0 }),
    row("voice", { need: "required", installed: true, download_bytes: 0, installed_bytes: GIB, peak_temp_bytes: 0 }),
    row("voice-better", { need: "recommended", download_bytes: 3 * GIB, installed_bytes: 3 * GIB, peak_temp_bytes: 1 * GIB, model_ids: ["better-model"] }),
  ]);
  const card = buildAiCards({
    copy, plan,
    components: [component({ id: "better-model", requirement: "unsupported", requirement_reason: "This needs 32 GB of memory and this computer has 16 GB." })],
    settings: SETTINGS, freeBytes: 100 * GIB,
  }).cards.find((c) => c.id === "voice")!;
  const better = card.choices.find((choice) => choice.id === "voice.better")!;
  expect(better.blockedReason).toBe("This needs 32 GB of memory and this computer has 16 GB.");
  expect(better.action).toBe("none");
});

test("action: current none, installed-not-current use, missing get, installed switch remove", () => {
  const plan = planOf([
    row("home", { kind: "home", need: "required", installed: true, download_bytes: 0, installed_bytes: 2 * GIB, peak_temp_bytes: 0 }),
    row("video", { need: "recommended", download_bytes: 24 * GIB, installed_bytes: 24 * GIB, peak_temp_bytes: 4 * GIB }),
    row("video-detailed", { need: "optional", download_bytes: 74 * GIB, installed_bytes: 60 * GIB, peak_temp_bytes: 14 * GIB }),
    row("coding", { need: "recommended", download_bytes: 20 * GIB, installed_bytes: 20 * GIB, peak_temp_bytes: 2 * GIB }),
    row("voice", { need: "required", installed: true, download_bytes: GIB, installed_bytes: GIB, peak_temp_bytes: 0 }),
  ]);
  const components = [
    component({ id: "video-detailed", state: "installed" }),
    component({ id: "coding", state: "installed" }),
  ];
  const { cards } = buildAiCards({ copy, plan, components, settings: { ...SETTINGS, videoQuality: "quick" }, freeBytes: null });
  const videos = cards.find((card) => card.id === "videos")!;
  expect(videos.choices.find((choice) => choice.id === "videos.quick")!.action).toBe("get");
  expect(videos.choices.find((choice) => choice.id === "videos.detailed")!.action).toBe("use");
  const coding = cards.find((card) => card.id === "coding")!;
  expect(coding.choices.find((choice) => choice.id === "coding.helper")!.action).toBe("remove");
  const voice = cards.find((card) => card.id === "voice")!;
  expect(voice.choices.find((choice) => choice.id === "voice.standard")!.action).toBe("none");
});

test("alwaysOn excludes the chat model and Klein, counts each engine once", () => {
  for (const tier of TIERS_LIST) {
    const plan = TIERS[tier];
    const { alwaysOn } = buildAiCards({ copy, plan, components: null, settings: SETTINGS, freeBytes: null });
    for (const excluded of ["chat", "pictures", "pictures-ernie", "pictures-zimage", "video", "video-detailed", "coding", "music", "voice-better", "chat-mlx", "reads-pictures", "image-tools", "tool-look"]) {
      expect(alwaysOn.rowIds).not.toContain(excluded);
    }
    for (const expected of ["home", "stt", "voice", "embed", "search"]) {
      expect(alwaysOn.rowIds).toContain(expected);
    }
    if (plan.rows.some((candidate) => candidate.id === "judge")) expect(alwaysOn.rowIds).toContain("judge");
    for (const engineId of alwaysOn.rowIds.filter((id) => id.startsWith("engine:"))) {
      expect(alwaysOn.rowIds.filter((id) => id === engineId)).toHaveLength(1);
    }
    const expectedBytes = plan.rows.filter((candidate) => alwaysOn.rowIds.includes(candidate.id)).reduce((total, candidate) => total + candidate.installed_bytes, 0);
    expect(alwaysOn.bytes).toBe(expectedBytes);
  }
});

test("recommendedPlan changes Detailed to Quick, lists changes, never removes, skips what does not fit and says so, nothingToDo when already recommended and installed", () => {
  const base = [
    row("home", { kind: "home", need: "required", installed: true, download_bytes: 0, installed_bytes: 2 * GIB, peak_temp_bytes: 0 }),
    row("chat", { need: "required", installed: true, download_bytes: 0, installed_bytes: 8 * GIB, peak_temp_bytes: 0 }),
    row("embed", { need: "required", installed: true, download_bytes: 0, installed_bytes: Math.floor(0.5 * GIB), peak_temp_bytes: 0 }),
    row("stt", { need: "required", installed: true, download_bytes: 0, installed_bytes: Math.floor(0.5 * GIB), peak_temp_bytes: 0 }),
    row("voice", { need: "required", installed: true, download_bytes: 0, installed_bytes: GIB, peak_temp_bytes: 0 }),
    row("search", { need: "recommended", selectable: false, installed: true, download_bytes: 0, installed_bytes: Math.floor(0.5 * GIB), peak_temp_bytes: 0 }),
    row("pictures", { need: "required", selectable: false, download_bytes: 16 * GIB, installed_bytes: 16 * GIB, peak_temp_bytes: 1 * GIB }),
    row("pictures-ernie", { need: "recommended", download_bytes: 24 * GIB, installed_bytes: 24 * GIB, peak_temp_bytes: 2 * GIB, engines: ["engine:pictures"] }),
    row("video", { need: "recommended", download_bytes: 24 * GIB, installed_bytes: 24 * GIB, peak_temp_bytes: 4 * GIB, engines: ["engine:video"] }),
    row("video-detailed", { need: "optional", installed: true, download_bytes: 74 * GIB, installed_bytes: 60 * GIB, peak_temp_bytes: 14 * GIB }),
    row("music", { need: "optional", download_bytes: 11 * GIB, installed_bytes: 11 * GIB, peak_temp_bytes: 1 * GIB }),
    row("coding", { need: "recommended", download_bytes: 30 * GIB, installed_bytes: 30 * GIB, peak_temp_bytes: 2 * GIB }),
    row("engine:pictures", { kind: "engine", need: "required", download_bytes: 1 * GIB, installed_bytes: 1 * GIB, peak_temp_bytes: 0 }),
    row("engine:video", { kind: "engine", need: "required", download_bytes: 1 * GIB, installed_bytes: 1 * GIB, peak_temp_bytes: 0 }),
  ];
  const plan = planOf(base);
  const result = recommendedPlan({ copy, plan, components: null, settings: { ...SETTINGS, videoQuality: "detailed" }, freeBytes: 90 * GIB });

  expect(result.changes).toEqual([{ job: "videos", from: "Detailed", to: "Quick", setting: { key: "generation.video_quality", value: "quick" } }]);
  expect(result.installRowIds).toContain("pictures");
  expect(result.installRowIds).toContain("pictures-ernie");
  expect(result.installRowIds).toContain("video");
  expect(result.installRowIds).not.toContain("engine:pictures");
  expect(result.installRowIds.indexOf("pictures")).toBeLessThan(result.installRowIds.indexOf("pictures-ernie"));
  expect(result.skipped.map((item) => item.rowId)).toEqual(["coding"]);
  expect(result.skipped[0]?.reason).toContain("GB free");
  expect(result.fits).toBe("some");
  expect(result.text).toContain("room for 3 of the 4");
  expect(result.text).toContain("Coding helper");
  expect(result.text).toContain("will be skipped");
  expect(result.installRowIds).not.toContain("video-detailed");
  expect(result.skipped.map((item) => item.rowId)).not.toContain("video-detailed");

  const donePlan = planOf(base.map((candidate) => ({ ...candidate, installed: true })));
  const done = recommendedPlan({ copy, plan: donePlan, components: null, settings: SETTINGS, freeBytes: 90 * GIB });
  expect(done.nothingToDo).toBe(true);
  expect(done.changes).toEqual([]);
  expect(done.installRowIds).toEqual([]);
  expect(done.fits).toBe("all");
});

test("the plan, components and settings inputs are not mutated", () => {
  function deepFreeze(value: unknown): void {
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value)) for (const item of value) deepFreeze(item);
    else for (const key of Object.keys(value as Record<string, unknown>)) deepFreeze((value as Record<string, unknown>)[key]);
    Object.freeze(value);
  }
  const plan = structuredClone(TIERS.p128);
  deepFreeze(plan);
  const components: AiComponentLike[] = [component({ id: "some-model", state: "installed" })];
  deepFreeze(components);
  const settings: AiSettingsInput = { pictureQuickModel: "klein", pictureDetailedEnabled: true, videoQuality: "detailed", musicEnabled: true };
  deepFreeze(settings);
  const input = { copy, plan: plan as DiskPlan, components, settings, freeBytes: 90 * GIB };
  expect(() => {
    buildAiCards(input);
    recommendedPlan(input);
  }).not.toThrow();
});

test("every choice carries a marked RAM estimate, and wake word is not offered without its file reading", () => {
  const result = buildAiCards({ copy, plan: TIERS[TIERS_LIST[0]!], components: null, settings: SETTINGS, freeBytes: null });
  const wake = result.cards.find((card) => card.id === "wakeword")!;
  expect(wake.choices).toEqual([]);
  expect(wake.unavailable).not.toBeNull();
  for (const choice of result.cards.flatMap((card) => card.choices)) {
    expect(choice.ramBasis).toBe("estimate");
    expect(choice.ramBytes).toBeGreaterThanOrEqual(choice.installedBytes);
  }
});

test("chat: the optional uncensored model is a third radio beside Standard, never recommended, only when the hub reports it", () => {
  const chat = (uncensored: { installed: boolean; running: boolean; downloadBytes: number; installedBytes: number } | null) =>
    buildAiCards({ copy, plan: TIERS.p128, components: null, settings: SETTINGS, freeBytes: null, uncensored }).cards.find((c) => c.id === "chat")!;
  expect(chat(null).choices.some((choice) => choice.id === "chat.uncensored")).toBe(false);
  const off = chat({ installed: false, running: false, downloadBytes: 22 * GIB, installedBytes: 22 * GIB });
  const choice = off.choices.find((c) => c.id === "chat.uncensored")!;
  expect(choice).toMatchObject({ kind: "radio", current: false, recommended: false, state: "notInstalled", action: "get", label: "Uncensored chat AI" });
  expect(off.choices.find((c) => c.id === "chat.standard")!.current).toBe(true);
  expect(off.chip).toBe("Using Standard");
  const ready = chat({ installed: true, running: false, downloadBytes: 22 * GIB, installedBytes: 22 * GIB });
  expect(ready.choices.find((c) => c.id === "chat.uncensored")).toMatchObject({ state: "installed", action: "use" });
  const running = chat({ installed: true, running: true, downloadBytes: 22 * GIB, installedBytes: 22 * GIB });
  expect(running.choices.find((c) => c.id === "chat.uncensored")).toMatchObject({ current: true, action: "none" });
  expect(running.choices.find((c) => c.id === "chat.standard")!.current).toBe(false);
  expect(running.chip).toBe("Using Uncensored");
});

test("chat: a download of the uncensored model in flight reads Installing with its percent and offers no action", () => {
  const chat = buildAiCards({ copy, plan: TIERS.p128, components: null, settings: SETTINGS, freeBytes: null, uncensored: { installed: false, running: false, downloading: true, percent: 40, downloadBytes: 22 * GIB, installedBytes: 22 * GIB } }).cards.find((c) => c.id === "chat")!;
  expect(chat.choices.find((c) => c.id === "chat.uncensored")).toMatchObject({ state: "installing", percent: 40, action: "none", stateText: "Installing" });
});

// AIMODELS-UNUSED-01: the seven-point unused rule and its plain words.
import { expect, test } from "bun:test";
import table from "../../shared/diskPlan.json";
import type { DiskPlan, DiskRow } from "../../shared/diskPlanMath";
import { aiCopy } from "@/lib/aiCopy";
import { findUnused, whyKept, type UnusedComponent, type UnusedInput } from "@/lib/aiUnused";

function part(overrides: Partial<UnusedComponent> & { id: string }): UnusedComponent {
  return {
    label: overrides.id, state: "installed", size_bytes: 1000, download_bytes: 1000, requirement: "optional", requirement_reason: null, percent: null, job: null, failure: null, can_install: true, can_uninstall: true, last_used_at: null, used_by: [],
    kind: "model", depends_on: [], plan_need: null,
    ...overrides,
  };
}

function plan(rows: Array<Partial<DiskRow> & { id: string }>): DiskPlan {
  const zero = { download_bytes: 0, installed_bytes: 0, peak_temp_bytes: 0, needed_bytes: 0, required_free_bytes: 0 };
  return {
    tier: "p128", level: "recommended", margin_percent: 20, headroom_warn_bytes: 0,
    rows: rows.map((row): DiskRow => ({ label: row.id, note: "", kind: "model", need: "optional", selectable: true, download_bytes: 1, installed_bytes: 1, peak_temp_bytes: 0, model_ids: [], engines: [], installed: true, basis: "estimate", ...row })),
    default: zero, minimum: zero, everything: zero, measured_on: "2026-10-26", default_selected: [],
  };
}

function unusedInput(plan: DiskPlan, components: UnusedComponent[], settings?: { pictureQuality: "quick" | "detailed"; videoQuality: "quick" | "detailed"; musicEnabled: boolean }): UnusedInput {
  return { copy: aiCopy, plan, components, settings: settings ?? { pictureQuality: "quick", videoQuality: "quick", musicEnabled: false }, freeBytes: null };
}

test("lists Detailed pictures when Quick is chosen and no style needs it", () => {
  const p = plan([
    { id: "chat", need: "required", model_ids: ["chat-m"] },
    { id: "pictures-ernie", need: "recommended", model_ids: ["ernie-m"] },
    { id: "pictures-zimage", model_ids: ["zimage-m"] },
    { id: "music", model_ids: ["music-m"] },
  ]);
  const input = unusedInput(p, [
    part({ id: "chat-m" }),
    part({ id: "ernie-m" }),
    part({ id: "zimage-m", size_bytes: 3000, last_used_at: "2026-08-17T12:00:00Z" }),
    part({ id: "music-m", size_bytes: 2000, last_used_at: "2026-08-17T12:00:00Z" }),
  ]);
  const result = findUnused(input);
  expect(result.items.map((item) => item.id)).toEqual(["zimage-m", "music-m"]);
  expect(result.items[0]?.name).toBe("Detailed pictures");
  expect(result.items[0]?.reason).toBe("You use Quick pictures and no saved style needs this.");
  expect(result.items[0]?.lastUsedAt).toBe("2026-08-17T12:00:00Z");
  expect(result.items[1]?.name).toBe("Music");
  expect(result.items[1]?.reason).toBe("Not used since August.");
  expect(result.totalBytes).toBe(5000);
});

test("keeps Always on parts", () => {
  const p = plan([
    { id: "judge", model_ids: ["judge-m"] },
    { id: "embed", model_ids: ["embed-m"] },
    { id: "stt", model_ids: ["stt-m"] },
    { id: "voice", model_ids: ["voice-m"] },
    { id: "chat", model_ids: ["chat-m"] },
    { id: "search", model_ids: ["search-m"] },
    { id: "music", model_ids: ["music-m"] },
  ]);
  const input = unusedInput(p, [
    part({ id: "judge-m" }), part({ id: "embed-m" }), part({ id: "stt-m" }),
    part({ id: "voice-m" }), part({ id: "chat-m" }), part({ id: "search-m" }), part({ id: "music-m" }),
  ]);
  expect(findUnused(input).items.map((item) => item.id)).toEqual(["music-m"]);
  for (const id of ["judge-m", "embed-m", "stt-m", "search-m"]) expect(whyKept(input, id)).toBe("Home needs it.");
  expect(whyKept(input, "voice-m")).toBe("You use it now.");
  expect(whyKept(input, "chat-m")).toBe("You use it now.");
});

test("keeps the chosen choice and a switch that is on", () => {
  const p = plan([
    { id: "pictures-ernie", need: "recommended", model_ids: ["ernie-m"] },
    { id: "pictures-zimage", model_ids: ["zimage-m"] },
    { id: "tool-look", model_ids: ["look-m"] },
    { id: "music", model_ids: ["music-m"] },
  ]);
  const input = unusedInput(p, [part({ id: "ernie-m" }), part({ id: "zimage-m" }), part({ id: "look-m" }), part({ id: "music-m" })]);
  expect(findUnused(input).items.map((item) => item.id)).toEqual(["zimage-m", "music-m"]);
  expect(whyKept(input, "ernie-m")).toBe("You use it now.");
  expect(whyKept(input, "look-m")).toBe("You use it now.");
});

test("keeps Klein even when Quick is chosen", () => {
  const p = plan([
    { id: "pictures", model_ids: ["klein-m"] },
    { id: "pictures-ernie", need: "recommended", model_ids: ["ernie-m"] },
    { id: "pictures-zimage", model_ids: ["zimage-m"] },
  ]);
  const input = unusedInput(p, [part({ id: "klein-m" }), part({ id: "ernie-m" }), part({ id: "zimage-m" })]);
  const ids = findUnused(input).items.map((item) => item.id);
  expect(ids).toEqual(["zimage-m"]);
  expect(ids).not.toContain("klein-m");
  expect(whyKept(input, "klein-m")).toBe("You use it now.");
});

test("keeps a base model while a saved style depends on it", () => {
  const p = plan([{ id: "pictures-zimage", model_ids: ["zimage-m"] }]);
  const input = unusedInput(p, [
    part({ id: "zimage-m" }),
    part({ id: "style-m", kind: "lora", depends_on: ["zimage-m"] }),
  ]);
  expect(findUnused(input).items).toEqual([]);
  expect(whyKept(input, "zimage-m")).toBe("A saved style needs it.");
});

test("never lists a style", () => {
  const p = plan([{ id: "music", model_ids: ["music-m"] }]);
  const input = unusedInput(p, [
    part({ id: "music-m", size_bytes: 1000 }),
    part({ id: "style-m", kind: "lora", size_bytes: 500 }),
  ]);
  expect(findUnused(input).items.map((item) => item.id)).toEqual(["music-m"]);
});

test("keeps a part another kept part depends on", () => {
  const p = plan([
    { id: "voice-better", need: "recommended", model_ids: ["better-m"] },
    { id: "music", model_ids: ["music-m"] },
  ]);
  const input = unusedInput(p, [
    part({ id: "better-m", depends_on: ["extra-m"] }),
    part({ id: "extra-m" }),
    part({ id: "music-m" }),
  ]);
  const result = findUnused(input);
  expect(result.items.map((item) => item.id)).toEqual(["music-m"]);
  expect(result.items[0]?.reason).toBe("Not used yet.");
  expect(whyKept(input, "extra-m")).toBe("Another part needs it.");
  expect(whyKept(input, "better-m")).toBe("You use it now.");
});

test("keeps a part with a running job or live use", () => {
  const p = plan([
    { id: "pictures-zimage", model_ids: ["zimage-m"] },
    { id: "music", model_ids: ["music-m"] },
  ]);
  const input = unusedInput(p, [
    part({ id: "zimage-m", job: "picture:42" }),
    part({ id: "music-m", used_by: ["music"] }),
  ]);
  expect(findUnused(input).items).toEqual([]);
  expect(whyKept(input, "zimage-m")).toBe("It is in use right now.");
  expect(whyKept(input, "music-m")).toBe("It is in use right now.");
});

test("whyKept returns null for an unused part and the plain reason otherwise", () => {
  const p = plan([
    { id: "pictures-ernie", need: "recommended", model_ids: ["ernie-m"] },
    { id: "pictures-zimage", model_ids: ["zimage-m"] },
    { id: "music", model_ids: ["music-m"] },
  ]);
  const input = unusedInput(p, [
    part({ id: "ernie-m" }),
    part({ id: "zimage-m", last_used_at: null }),
    part({ id: "music-m", can_uninstall: false }),
  ]);
  expect(whyKept(input, "zimage-m")).toBeNull();
  expect(whyKept(input, "ernie-m")).toBe("You use it now.");
  expect(whyKept(input, "music-m")).toBe("It cannot be removed right now.");
  const result = findUnused(input);
  expect(result.items.map((item) => item.id)).toEqual(["zimage-m"]);
  expect(result.items[0]?.reason).toBe("You use Quick pictures and no saved style needs this.");
});

test("totalBytes is the sum, and nothing is listed when nothing is unused", () => {
  const busy = plan([
    { id: "pictures-ernie", need: "recommended", model_ids: ["ernie-m"] },
    { id: "chat", need: "required", model_ids: ["chat-m"] },
  ]);
  expect(findUnused(unusedInput(busy, [part({ id: "ernie-m", size_bytes: 4000 }), part({ id: "chat-m", size_bytes: 9000 })]))).toEqual({ items: [], totalBytes: 0 });

  const p = plan([
    { id: "pictures-ernie", need: "recommended", model_ids: ["ernie-m"] },
    { id: "pictures-zimage", model_ids: ["zimage-m"] },
    { id: "video-detailed", model_ids: ["ltx-m"] },
  ]);
  const result = findUnused(unusedInput(p, [
    part({ id: "ernie-m", size_bytes: 100 }),
    part({ id: "zimage-m", size_bytes: 3000 }),
    part({ id: "ltx-m", size_bytes: 7400 }),
  ]));
  expect(result.items.map((item) => item.id)).toEqual(["ltx-m", "zimage-m"]);
  expect(result.totalBytes).toBe(10400);
});

test("does not mutate its input", () => {
  const p = plan([
    { id: "pictures-ernie", need: "recommended", model_ids: ["ernie-m"] },
    { id: "pictures-zimage", model_ids: ["zimage-m"] },
  ]);
  const components = [part({ id: "ernie-m" }), part({ id: "zimage-m", last_used_at: "2026-08-17T12:00:00Z" })];
  const input = unusedInput(p, components);
  const { copy: _copy, ...rest } = input;
  const before = structuredClone(rest);
  findUnused(input);
  whyKept(input, "zimage-m");
  whyKept(input, "ernie-m");
  const { copy: _after, ...restAfter } = input;
  expect(restAfter).toEqual(before);
});

test("real p128 plan with everything installed and Quick chosen: Detailed pictures and Detailed videos are unused, Klein and Always on are not", () => {
  const p: DiskPlan = structuredClone((table as unknown as { tiers: Record<string, DiskPlan> }).tiers["p128"]!);
  const components: UnusedComponent[] = [];
  for (const row of p.rows) {
    if (row.model_ids.length > 0) {
      const share = Math.floor(row.installed_bytes / row.model_ids.length);
      for (const id of row.model_ids) components.push(part({ id, label: row.label, size_bytes: share, plan_need: row.need }));
    } else if (row.kind === "engine") {
      components.push(part({ id: row.id, label: row.label, size_bytes: row.installed_bytes, plan_need: row.need }));
    }
  }
  const input = unusedInput(p, components, { pictureQuality: "quick", videoQuality: "quick", musicEnabled: true });
  const result = findUnused(input);
  const zimage = p.rows.find((row) => row.id === "pictures-zimage")!;
  const ltx = p.rows.find((row) => row.id === "video-detailed")!;
  const klein = p.rows.find((row) => row.id === "pictures")!;
  const expectedIds = [...zimage.model_ids, ...ltx.model_ids];
  expect(result.items.map((item) => item.id).sort()).toEqual([...expectedIds].sort());
  expect(result.items.every((item) => item.name === "Detailed pictures" || item.name === "Detailed videos")).toBe(true);
  expect(result.items.every((item) => item.reason === "You use Quick pictures and no saved style needs this." || item.reason === "You use Quick videos and no saved style needs this.")).toBe(true);
  expect(result.totalBytes).toBe(result.items.reduce((total, item) => total + item.bytes, 0));
  for (const id of [...klein.model_ids, "judge", "embed", "stt", "search", "home"]) expect(result.items.map((item) => item.id)).not.toContain(id);
});

test("a part no card offers is named by what it does, never by its model name", () => {
  const p = plan([{ id: "chat", need: "required", model_ids: ["chat-m"] }]);
  const input = unusedInput(p, [part({ id: "chat-m" }), part({ id: "ornith-1-5-122b-mlx-4bit", label: "Ornith 1.5 122B", size_bytes: 70_000, group: "chat" }), part({ id: "mystery-model", label: "Mystery 9B", size_bytes: 10 })]);
  const items = findUnused(input).items;
  expect(items.map((item) => item.name)).toEqual(["Extra chat model", "Extra model"]);
  expect(JSON.stringify(items.map((item) => [item.name, item.reason]))).not.toMatch(/Ornith|Mystery|122b/);
});

test("whyKept refuses a saved style by id, so a cleanup can never remove one", () => {
  const p = plan([{ id: "chat", need: "required", model_ids: ["chat-m"] }]);
  const input = unusedInput(p, [part({ id: "chat-m" }), part({ id: "lora.picture.cinema", kind: "lora", size_bytes: 500 })]);
  expect(whyKept(input, "lora.picture.cinema")).toBe("A saved style is removed from its own page, not here.");
});

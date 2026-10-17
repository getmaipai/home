import { expect, test } from "bun:test";
import type { StackInstallPlan } from "@/lib/stack/client";
import { wordPlan } from "./installPlanWording";

const base: StackInstallPlan = { level: "moderate", tier: "p32", label: "L", memory_gb: 32, memory_source: "unified", models: [], total_bytes: 0, remaining_bytes: 0, free_disk_bytes: null, fits_disk: null };

test("each level gets its name and what it can do", () => {
  expect(wordPlan({ ...base, level: "recommended" }).gets).toContain("Make pictures");
  expect(wordPlan({ ...base, level: "minimal" }).gets).not.toContain("Make pictures");
  expect(wordPlan(base).headline).toStartWith("Moderate");
});

test("unknown memory asks the person; too small says go to two computers", () => {
  const ask = wordPlan({ ...base, level: null, tier: null, memory_source: "unknown", memory_gb: 0 });
  expect(ask.needsMemoryAnswer).toBe(true);
  const small = wordPlan({ ...base, level: null, tier: null, memory_gb: 8 });
  expect(small.level).toBe("below_minimum");
  expect(small.detail).toContain("two computers");
  expect(wordPlan(null).level).toBe("unknown");
});

test("a full disk is said in plain words", () => {
  const w = wordPlan({ ...base, remaining_bytes: 20e9, free_disk_bytes: 5e9, fits_disk: false, models: [{ id: "a", role: "chat", url: "u", sha256: "s", licence: "l", revision: "r", starter: true, installed: false }] });
  expect(w.diskLine).toContain("not enough free disk space");
});

test("a Mac that is too small is told its own memory total", () => {
  const small = wordPlan({ ...base, level: null, tier: null, memory_gb: 8, memory_source: "unified" });
  expect(small.detail).toContain("This Mac has 8 GB of memory in total.");
});

test("the memory question tells a Mac owner to pick the total memory", () => {
  const ask = wordPlan({ ...base, level: null, tier: null, memory_source: "unknown", memory_gb: 0 });
  expect(ask.detail).toContain("On a Mac, pick the Mac's total memory");
});

test("the plan line names voice when the plan carries speech in and out", () => {
  const model = (role: string) => ({ id: role, role, url: "u", sha256: "s", licence: "l", revision: "r", starter: false, installed: false });
  const withVoice = wordPlan({ ...base, models: [model("chat"), model("stt"), model("tts")] });
  expect(withVoice.gets).toContain("Voice: talk to Home");
  expect(wordPlan(base).gets).toContain("Voice: talk to Home");
  expect(wordPlan({ ...base, models: [model("chat"), model("stt")] }).gets).not.toContain("Voice: talk to Home");
});

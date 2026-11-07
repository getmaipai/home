// I18N-C1: one fixed language line for an adult's written turn in a locale with a table entry.
import { describe, expect, test } from "bun:test";
import type { TurnSignal } from "@maipai/spec/gen/ts/turn-signal.js";
import { contextToMessages } from "@/lib/turnMachine/messages";
import { LANGUAGE_LINES, languageLineFor } from "@/lib/turnMachine/languageLine";
import type { ContextItem } from "@/lib/turnMachine/contract";
import { fallbackSignal } from "@/lib/turnSignal";
import { planFor } from "@/lib/register";
import { buildStablePrefix } from "@/lib/turnShared";
import { DEFAULT_PERSONA } from "@/lib/persona";
import { turnWarmupPrompt } from "@/lib/turnMachine/warmup";
import { readFileSync } from "node:fs";
import { SUPPORTED_LOCALES } from "@/lib/supportedLocales";

const LINE = "The person's language is Spanish. Answer in Spanish unless they write in another language.";
const profile: ContextItem = { id: "profile-1", text: "Background about Sage.", source: "profile", subjects: [], disclosure: "child_ok" };

type Band = "adult" | "teen" | "child";
function build(band: Band, surfaceClass: "written" | "spoken" | "glance", locale: string | undefined, utterance = "hola") {
  const signal: TurnSignal = fallbackSignal(utterance, band, "identified_profile", "question");
  const plan = planFor({ signal, surface: "chat", surfaceClass, brevity: false, evidence: { choices: 0, sources: 0, deliverable: false }, companion: { directness: "diplomatic", engagement: "balanced", vocabulary: "advanced" }, band, deferred: false, disclosureWithheld: false });
  const out = contextToMessages([profile], utterance, DEFAULT_PERSONA, plan, signal, surfaceClass, [], false, "", undefined, languageLineFor(locale, surfaceClass, band));
  return String(out[0]?.content);
}

describe("I18N-C1 language line", () => {
  test("the table is closed: es only, English locales have no entry", () => {
    expect(LANGUAGE_LINES).toEqual({ es: LINE });
    for (const locale of SUPPORTED_LOCALES) if (locale !== "es") expect(LANGUAGE_LINES[locale]).toBeUndefined();
  });

  test("en-US and en-GB adult written prompts are byte-identical to the prompt without the feature", () => {
    const bare = `${buildStablePrefix(DEFAULT_PERSONA, "written")}\n\n${profile.text}`;
    expect(build("adult", "written", undefined)).toBe(bare);
    expect(build("adult", "written", "en-US")).toBe(bare);
    expect(build("adult", "written", "en-GB")).toBe(bare);
  });

  test("es adult written: the line closes the stable prefix, before the stable context lines", () => {
    const content = build("adult", "written", "es");
    expect(content).toBe(`${buildStablePrefix(DEFAULT_PERSONA, "written")}\n\n${LINE}\n\n${profile.text}`);
  });

  test("es line is byte-identical across two turns of one conversation", () => {
    expect(build("adult", "written", "es", "hola")).toBe(build("adult", "written", "es", "otra pregunta"));
  });

  test("the stable prefix's leading bytes equal the warm-up prompt", async () => {
    const warm = (await turnWarmupPrompt("written")).system;
    expect(build("adult", "written", "es").startsWith(warm)).toBe(true);
    expect(build("adult", "written", "en-US").startsWith(warm)).toBe(true);
  });

  test("no line for child, teen, spoken (robot or voice) or glance turns, in es", () => {
    for (const [band, sc] of [["child", "written"], ["teen", "written"], ["adult", "spoken"], ["teen", "spoken"], ["child", "spoken"], ["adult", "glance"]] as const) {
      expect(build(band, sc, "es")).not.toContain(LINE);
    }
    expect(languageLineFor("es", undefined, "adult")).toBe("");
    expect(languageLineFor("es", "written", "adult")).toBe(LINE);
    expect(languageLineFor("xx", "written", "adult")).toBe("");
    expect(languageLineFor("toString", "written", "adult")).toBe("");
  });

  test("the line says nothing about length, style, register, tools or search", () => {
    expect(LINE).not.toMatch(/short|long|brief|word|tone|formal|casual|tool|search|style/i);
  });

  test("every turn-machine call of contextToMessages passes the turn's language line", () => {
    for (const file of ["turnNext.ts", "nodes/context.ts", "nodes/model.ts"]) {
      const text = readFileSync(`${import.meta.dir}/../../src/lib/turnMachine/${file}`, "utf-8");
      const calls = text.match(/contextToMessages\([^\n]*\)/g) ?? [];
      for (const call of calls.filter((c) => c.includes("state.topicBlock"))) expect(call).toContain("state.robotName, state.languageLine");
    }
  });
});

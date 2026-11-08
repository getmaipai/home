import { describe, expect, test } from "bun:test";
import { createContentPolicyResolver, type ContentPolicy } from "@/lib/contentPolicy";
import { policyForConsumer } from "@/lib/contentPolicy/consumers";
import { evaluateReply } from "@/lib/safety";
import { gateFor } from "@/lib/news/childGate";
import { minorRowTrips } from "@/lib/retrieval/minorRowFloor";
import { StreamGate } from "@/lib/turnMachine/nodes/outputGate";
import corpusData from "./fixtures/contentPolicy/corpus.json";
import type { PersonRow } from "@/types";

const corpus = corpusData as Array<{ id: string; kind: "swearing" | "drugs" | "gambling" | "gore"; text: string }>;
const person = (role: string): PersonRow => ({ id: `consumer-${role}`, role } as PersonRow);
const enabled = (p: PersonRow, band: "child" | "teen" | "adult", filters: unknown = []) =>
  createContentPolicyResolver({ readFilters: () => filters }).contentPolicyFor({ actor: p, band, present: [], surface: "chat", surfaceClass: "written", spoken: false });

describe("content policy consumers", () => {
  test("off is pass-through, enabled flags read errors close toward protection", () => {
    const child = person("child");
    const off = policyForConsumer(child, "chat_output", "child", { household: () => false });
    expect(off.check(corpus[0]!.text)).toBeNull();
    const error = policyForConsumer(child, "chat_output", "child", { household: () => { throw new Error("settings"); } });
    expect(error.check(corpus[0]!.text)?.kind).toBe("swearing");
    const unset = policyForConsumer(child, "chat_output", "child", { household: () => undefined });
    expect(unset.policy).toBeNull();
    expect(unset.check(corpus[0]!.text)).toBeNull();
    const on = policyForConsumer(child, "chat_output", "child", { household: () => true });
    expect(on.check(corpus[0]!.text)?.kind).toBe("swearing");
    const searchUnset = policyForConsumer(child, "search", "child", { household: () => undefined });
    const searchError = policyForConsumer(child, "search", "child", { household: () => { throw new Error("settings"); } });
    expect(searchUnset.policy).toBeNull();
    expect(searchError.check(corpus[0]!.text)?.kind).toBe("swearing");
  });

  test("child, teen and adult defaults and adult added filters resolve per person", () => {
    expect(enabled(person("child"), "child").check(corpus[2]!.text, "transcript")?.kind).toBe("drugs");
    expect(enabled(person("teen"), "teen").check(corpus[2]!.text, "transcript")).toBeNull();
    expect(enabled(person("teen"), "teen").check(corpus[4]!.text, "transcript")?.kind).toBe("gore");
    expect(enabled(person("adult"), "adult").check(corpus[2]!.text, "transcript")).toBeNull();
    expect(enabled(person("adult"), "adult", ["drugs"]).check(corpus[2]!.text, "transcript")?.kind).toBe("drugs");
    // Rules 0 and 10: no adult gets a content filter from this consumer, even when the flag is on or the read fails.
    for (const role of ["adult", "owner", "admin"]) {
      expect(policyForConsumer(person(role), "chat_output", "adult", { household: () => { throw new Error("settings"); } }).policy).toBeNull();
      expect(policyForConsumer(person(role), "search", "adult", { household: () => true }).policy).toBeNull();
    }
    // Rules 0 and 10: no adult gets a content filter from this consumer, even when the flag is on or the read fails.
    for (const role of ["adult", "owner", "admin"]) {
      expect(policyForConsumer(person(role), "chat_output", "adult", { household: () => { throw new Error("settings"); } }).policy).toBeNull();
      expect(policyForConsumer(person(role), "search", "adult", { household: () => true }).policy).toBeNull();
    }
    for (const role of ["owner", "admin"]) {
      const p = policyForConsumer(person(role), "chat_output", "adult", { household: () => true });
      expect(p.policy).toBeNull();
    }
  });

  test("whole output checks answer and speech; policy matcher failure uses fixed fallback", () => {
    const child = person("child");
    const policy = enabled(child, "child");
    const hit = evaluateReply({ text: `A safe start. ${corpus[0]!.text}`, speech: corpus[0]!.text }, "child", policy);
    expect(hit.effective.action).toBe("refuse");
    expect(hit.textPolicyLine).toBe("I can't help with that content. Try something different.");
    const throwing: ContentPolicy = { filters: new Set<"minor_line">(), check() { throw new Error("matcher"); } };
    const failed = evaluateReply({ text: "Safe words." }, "adult", throwing);
    expect(failed.effective.action).toBe("refuse");
    expect(failed.textPolicyLine).toBe("I couldn't check that safely. Try something different.");
  });

  test("stream catches a fixture term split at every chunk offset", () => {
    const term = corpus[1]!.text;
    const policy = enabled(person("child"), "child");
    for (let split = 1; split < term.length; split++) {
      const released: string[] = [];
      const gate = new StreamGate("child", person("child"), "turn-policy-stream", (part) => released.push(part), () => {}, () => {}, { grain: "sentence", policy });
      gate.push(`Safe sentence. ${term.slice(0, split)}`);
      gate.push(`${term.slice(split)}.`);
      gate.finish();
      expect(gate.result().refused, `split ${split}`).toBeTruthy();
      expect(released.join("")).not.toContain(term);
      expect(gate.result().refusedPolicyLine).toBe("I can't help with that content. Try something different.");
    }
  });

  test("fixed policy refusal lines come from policy data", async () => {
    const { outputGateNode } = await import("@/lib/turnMachine/nodes/outputGate");
    const data = await import("@/lib/contentPolicy/data/kinds.v1.json");
    expect(data.lines.swearing).toBe("I can't help with that content. Try something different.");
    expect(outputGateNode).toBeDefined();
  });

  test("news sentence and retrieved row text use the same per-person check", () => {
    const child = person("child");
    const gate = gateFor("child", enabled(child, "child"));
    expect(gate.text(`Morning headlines are ready. ${corpus[2]!.text}.`)).not.toContain(corpus[2]!.text);
    expect(gate.passes(corpus[2]!.text)).toBe(false);
    expect(minorRowTrips({ title: "Reference", snippet: corpus[2]!.text }, enabled(child, "child"))).toBe(true);
  });

  test("all fixture terms are caught by the appropriate child policy", () => {
    const policy = enabled(person("child"), "child");
    for (const row of corpus) expect(policy.check(row.text, "transcript")?.kind).toBe(row.kind);
  });
});
